/**
 * actions.ts —— 浏览器原子动作执行器
 */

import { writeFileSync } from 'node:fs';
import { CdpClient } from './cdp.js';
import { ChromeManager } from './chrome.js';
import { INJECTED_DOM_SCRIPT, formatSnapshot } from './dom.js';
import { RecipeEngine } from './recipe.js';
import { SessionRegistry } from './registry.js';
import type { InteractiveElement, LaunchOptions, SnapshotResult } from './types.js';

export class BrowserActions {
  public client: CdpClient;
  public cachedElements: InteractiveElement[] = [];
  public agent?: string;

  constructor(client: CdpClient, agent?: string) {
    this.client = client;
    this.agent = agent;
  }

  static async launchOrConnect(options: LaunchOptions & { temp?: boolean } = {}): Promise<BrowserActions> {
    const mgr = new ChromeManager(options.port || 9222);
    const session = await mgr.getOrLaunch(options);
    const client = new CdpClient(session.wsUrl);
    await client.connect();
    const browser = new BrowserActions(client, session.agent || options.agent);
    if (options.url && options.url !== 'about:blank' && session.url !== options.url) {
      await browser.open(options.url);
    } else {
      await browser.applyTitleBadge();
    }
    return browser;
  }

  static async connectToSession(agentOrPort?: string | number): Promise<BrowserActions> {
    const session = ChromeManager.getActiveSession(agentOrPort);
    if (!session || !session.wsUrl) {
      throw new Error(`未找到活跃的浏览器会话${agentOrPort ? ` (Agent/Port: ${agentOrPort})` : ''}。请先执行 \`lite-browser open <url>\` 建立会话。`);
    }

    try {
      const client = new CdpClient(session.wsUrl);
      await client.connect();
      return new BrowserActions(client, session.agent);
    } catch (_) {
      // 若原 targetId 标签已关闭或重定向，从该端口当前存活的 pages 中自愈重连
      const mgr = new ChromeManager(session.port);
      const pages = await mgr.getPages().catch(() => []);
      const activePage = pages.find((p: any) => p.type === 'page' && p.webSocketDebuggerUrl);
      if (activePage) {
        session.wsUrl = activePage.webSocketDebuggerUrl;
        session.targetId = activePage.id;
        session.url = activePage.url;
        session.title = activePage.title;
        ChromeManager.updateSessionUrl(activePage.url, activePage.title);
        const client = new CdpClient(activePage.webSocketDebuggerUrl);
        await client.connect();
        return new BrowserActions(client, session.agent);
      }
      throw new Error(`浏览器会话已失效 (Port: ${session.port})。请重新执行 \`lite-browser open <url>\`。`);
    }
  }

  getBadgePrefix(): string {
    const customBadge = process.env.LITE_BROWSER_BADGE;
    if (customBadge) return customBadge.endsWith(' ') ? customBadge : customBadge + ' ';
    const effectiveAgent = this.agent || SessionRegistry.detectCurrentAgent();
    if (effectiveAgent && effectiveAgent !== 'default') {
      return `⚡ [lite:${effectiveAgent}] `;
    }
    return '⚡ [lite] ';
  }

  async applyTitleBadge(): Promise<void> {
    const badge = this.getBadgePrefix();
    const script = `(() => {
      const badge = ${JSON.stringify(badge)};
      function patch() {
        try {
          const proto = HTMLDocument.prototype.hasOwnProperty('title') ? HTMLDocument.prototype : Document.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'title');
          if (desc && desc.set && !desc.set.__lite_patched) {
            const origSet = desc.set;
            const newSet = function(val) {
              const str = String(val || '');
              const prefixed = str.startsWith('⚡ [lite') ? str : badge + str;
              return origSet.call(this, prefixed);
            };
            newSet.__lite_patched = true;
            desc.set = newSet;
            Object.defineProperty(proto, 'title', desc);
          }
        } catch (_) {}
        if (document.title && !document.title.startsWith('⚡ [lite')) {
          document.title = badge + document.title;
        }
      }
      patch();
      const target = document.querySelector('title');
      if (target && !target.__lite_observed) {
        target.__lite_observed = true;
        new MutationObserver(() => {
          if (document.title && !document.title.startsWith('⚡ [lite')) {
            document.title = badge + document.title;
          }
        }).observe(target, { childList: true, characterData: true, subtree: true });
      }
    })()`;

    try {
      await this.client.send('Page.enable');
      await this.client.send('Runtime.enable');
      await this.client.send('Page.addScriptToEvaluateOnNewDocument', { source: script });
      await this.client.send('Runtime.evaluate', { expression: script });
    } catch (_) {}
  }

  async open(url: string): Promise<{ ok: boolean; url: string }> {
    await this.client.send('Page.enable');
    await this.client.send('Runtime.enable');
    await this.client.send('DOM.enable');

    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('about:')) {
      targetUrl = 'https://' + targetUrl;
    }

    const navPromise = this.client.waitFor('Page.loadEventFired', 15000).catch(() => {});
    await this.client.send('Page.navigate', { url: targetUrl });
    await navPromise;

    await this.applyTitleBadge();
    const currentTitle = await this.getTitle();

    ChromeManager.updateSessionUrl(targetUrl, currentTitle);

    RecipeEngine.recordAction({
      type: 'open',
      url: targetUrl,
    });

    return { ok: true, url: targetUrl };
  }

  async getTitle(): Promise<string> {
    await this.client.send('Runtime.enable');
    const pageInfo = await this.client.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    });
    return pageInfo.result?.value || '';
  }

  async getUrl(): Promise<string> {
    await this.client.send('Runtime.enable');
    const pageInfo = await this.client.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    return pageInfo.result?.value || '';
  }

  async snapshot(): Promise<SnapshotResult> {
    await this.client.send('Runtime.enable');
    const evalRes = await this.client.send('Runtime.evaluate', {
      expression: INJECTED_DOM_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
    });

    if (evalRes.exceptionDetails) {
      throw new Error(`DOM 抽取异常: ${evalRes.exceptionDetails.text}`);
    }

    const elements: InteractiveElement[] = evalRes.result.value || [];
    this.cachedElements = elements;

    const pageInfo = await this.client.send('Runtime.evaluate', {
      expression: '({ title: document.title, url: window.location.href })',
      returnByValue: true,
    });

    const { title, url } = pageInfo.result.value || {};
    const formatted = formatSnapshot(elements, url, title);

    return { elements, formatted, title, url };
  }

  async click(target: string): Promise<{ ok: boolean; target: string; x: number; y: number; selector: string }> {
    let x: number, y: number, selector: string, desc: string;

    if (target.startsWith('@')) {
      const { elements } = await this.snapshot();
      const found = elements.find((e) => e.id === target);
      if (!found) {
        throw new Error(`未在页面找到编号为 ${target} 的元素，请重新执行 snapshot 查看最新索引`);
      }
      x = found.x;
      y = found.y;
      selector = found.selector;
      desc = `[${found.tag}:${found.role}] "${found.text}"`;
    } else {
      selector = target;
      desc = target;
      const posRes = await this.client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`,
        returnByValue: true,
      });

      if (!posRes.result.value) {
        throw new Error(`未找到匹配选择器 "${selector}" 的可见元素`);
      }
      x = posRes.result.value.x;
      y = posRes.result.value.y;
    }

    await this.client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });

    await new Promise((r) => setTimeout(r, 50));

    await this.client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });

    if (selector) {
      await this.client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) try { el.click(); } catch (_) {}
        })()`,
      });
    }

    RecipeEngine.recordAction({
      type: 'click',
      target,
      selector,
      x,
      y,
      targetDescription: desc,
    });

    return { ok: true, target, x, y, selector };
  }

  async type(target: string, text: string): Promise<{ ok: boolean; target: string; text: string }> {
    const clickRes = await this.click(target);

    // 先清空已有内容，避免重复追加
    await this.client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement || document.querySelector(${JSON.stringify(clickRes.selector)});
        if (el) {
          if ('select' in el && typeof el.select === 'function') {
            el.select();
          } else {
            el.value = '';
          }
        }
      })()`,
    });

    // 使用 CDP 原生 Input.insertText 插入文本（解决逐字符模拟与 value 赋值双重输入的 BUG）
    await this.client.send('Input.insertText', { text });

    // 确保 Vue / React 等双向绑定受控组件感知到变更
    await this.client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement || document.querySelector(${JSON.stringify(clickRes.selector)});
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
    });

    RecipeEngine.recordAction({
      type: 'type',
      target,
      selector: clickRes.selector,
      text,
      targetDescription: clickRes.target,
    });

    return { ok: true, target, text };
  }

  async scroll(direction: 'up' | 'down' = 'down', amount = 400): Promise<{ ok: boolean; direction: string; amount: number }> {
    const delta = direction === 'up' ? -amount : amount;
    await this.client.send('Runtime.evaluate', {
      expression: `window.scrollBy({ top: ${delta}, behavior: 'smooth' })`,
    });

    await new Promise((r) => setTimeout(r, 400));

    RecipeEngine.recordAction({
      type: 'scroll',
      direction,
      amount,
    });

    return { ok: true, direction, amount };
  }

  async wait(seconds = 1): Promise<{ ok: boolean; seconds: number }> {
    await new Promise((r) => setTimeout(r, seconds * 1000));
    RecipeEngine.recordAction({
      type: 'wait',
      seconds,
    });
    return { ok: true, seconds };
  }

  async screenshot(filePath = '/tmp/lite-browser-screenshot.png'): Promise<{ ok: boolean; path: string; size: number }> {
    await this.client.send('Page.enable');
    const res = await this.client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });

    const buffer = Buffer.from(res.data, 'base64');
    writeFileSync(filePath, buffer);

    return { ok: true, path: filePath, size: buffer.length };
  }

  async eval(code: string): Promise<any> {
    const res = await this.client.send('Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`执行错误: ${desc}`);
    }

    return res.result.value;
  }

  async hover(target: string): Promise<{ ok: boolean; target: string; x: number; y: number; selector: string }> {
    let x: number, y: number, selector: string, desc: string;

    if (target.startsWith('@')) {
      const { elements } = await this.snapshot();
      const found = elements.find((e) => e.id === target);
      if (!found) {
        throw new Error(`未在页面找到编号为 ${target} 的元素`);
      }
      x = found.x;
      y = found.y;
      selector = found.selector;
      desc = `[${found.tag}:${found.role}] "${found.text}"`;
    } else {
      selector = target;
      desc = target;
      const posRes = await this.client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
        })()`,
        returnByValue: true,
      });

      if (!posRes.result.value) {
        throw new Error(`未找到匹配选择器 "${selector}" 的可见元素`);
      }
      x = posRes.result.value.x;
      y = posRes.result.value.y;
    }

    await this.client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });

    RecipeEngine.recordAction({
      type: 'hover',
      target,
      selector,
      x,
      y,
      targetDescription: desc,
    });

    return { ok: true, target, x, y, selector };
  }

  async press(key: string): Promise<{ ok: boolean; key: string }> {
    const keyMap: Record<string, { code: string; key: string; keyCode: number }> = {
      enter: { code: 'Enter', key: 'Enter', keyCode: 13 },
      tab: { code: 'Tab', key: 'Tab', keyCode: 9 },
      escape: { code: 'Escape', key: 'Escape', keyCode: 27 },
      backspace: { code: 'Backspace', key: 'Backspace', keyCode: 8 },
      arrowdown: { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 },
      arrowup: { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
      arrowleft: { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
      arrowright: { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },
      space: { code: 'Space', key: ' ', keyCode: 32 },
    };

    const normKey = key.toLowerCase();
    const info = keyMap[normKey] || { code: key, key, keyCode: 0 };

    await this.client.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      windowsVirtualKeyCode: info.keyCode,
      code: info.code,
      key: info.key,
      text: info.key.length === 1 ? info.key : undefined,
    });

    await this.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: info.keyCode,
      code: info.code,
      key: info.key,
    });

    RecipeEngine.recordAction({
      type: 'press',
      key,
    });

    return { ok: true, key };
  }

  async select(target: string, value: string): Promise<{ ok: boolean; target: string; value: string }> {
    let selector = target;
    if (target.startsWith('@')) {
      const { elements } = await this.snapshot();
      const found = elements.find((e) => e.id === target);
      if (!found) throw new Error(`未在页面找到编号为 ${target} 的元素`);
      selector = found.selector;
    }

    const res = await this.client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el || el.tagName !== 'SELECT') return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      returnByValue: true,
    });

    if (!res.result?.value) {
      throw new Error(`未能将下拉选择框 "${selector}" 的值设为 "${value}"`);
    }

    RecipeEngine.recordAction({
      type: 'select',
      target,
      selector,
      value,
    });

    return { ok: true, target, value };
  }

  async upload(target: string, files: string[]): Promise<{ ok: boolean; target: string; files: string[] }> {
    let selector = target;
    if (target.startsWith('@')) {
      const { elements } = await this.snapshot();
      const found = elements.find((e) => e.id === target);
      if (!found) throw new Error(`未在页面找到编号为 ${target} 的元素`);
      selector = found.selector;
    }

    await this.client.send('DOM.enable');
    const evalRes = await this.client.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false,
    });

    if (!evalRes.result?.objectId) {
      throw new Error(`未在页面中找到目标文件上传元素: "${selector}"`);
    }

    await this.client.send('DOM.setFileInputFiles', {
      files,
      objectId: evalRes.result.objectId,
    });

    RecipeEngine.recordAction({
      type: 'upload',
      target,
      selector,
      files,
    });

    return { ok: true, target, files };
  }

  async getCookies(urls?: string[]): Promise<any[]> {
    await this.client.send('Network.enable');
    const res = await this.client.send('Network.getCookies', urls ? { urls } : {});
    return res.cookies || [];
  }

  async setCookies(cookies: any[]): Promise<void> {
    await this.client.send('Network.enable');
    await this.client.send('Network.setCookies', { cookies });
  }

  async clearCookies(): Promise<void> {
    await this.client.send('Network.enable');
    await this.client.send('Network.clearBrowserCookies');
  }

  async cdp(method: string, params: Record<string, any> = {}): Promise<any> {
    return await this.client.send(method, params);
  }

  close(): void {
    this.client.close();
    ChromeManager.clearSession();
  }
}
