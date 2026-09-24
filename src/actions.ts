/**
 * actions.ts —— 浏览器原子动作执行器
 */

import { writeFileSync } from 'node:fs';
import { CdpClient } from './cdp.js';
import { ChromeManager } from './chrome.js';
import { INJECTED_DOM_SCRIPT, formatSnapshot } from './dom.js';
import { RecipeEngine } from './recipe.js';
import type { InteractiveElement, SnapshotResult } from './types.js';

export class BrowserActions {
  public client: CdpClient;
  public cachedElements: InteractiveElement[] = [];

  constructor(client: CdpClient) {
    this.client = client;
  }

  static async connectToSession(): Promise<BrowserActions> {
    const session = ChromeManager.getActiveSession();
    if (!session || !session.wsUrl) {
      throw new Error('未找到活跃的浏览器会话。请先执行 `lite-browser open <url>` 建立会话。');
    }
    const client = new CdpClient(session.wsUrl);
    await client.connect();
    return new BrowserActions(client);
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

    RecipeEngine.recordAction({
      type: 'open',
      url: targetUrl,
    });

    return { ok: true, url: targetUrl };
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

    await this.client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement || document.querySelector(${JSON.stringify(clickRes.selector)});
        if (el) {
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
    });

    for (const char of text) {
      await this.client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
      });
      await this.client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
      });
    }

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

  async cdp(method: string, params: Record<string, any> = {}): Promise<any> {
    return await this.client.send(method, params);
  }

  close(): void {
    this.client.close();
    ChromeManager.clearSession();
  }
}
