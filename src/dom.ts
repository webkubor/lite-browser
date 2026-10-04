/**
 * dom.ts —— DOM 交互元素抽取、精简编号、活体缓存与定位脚本
 * 深度结合 jev-ultrafast 极速引擎：
 *  1. WeakMap + Map 活体节点缓存与生命周期维护
 *  2. 原生 checkVisibility() 彻底消除 getComputedStyle 导致的重绘/布局抖动
 *  3. 完备的 Accessible Name 计算（aria-labelledby / label / placeholder / alt）
 *  4. 毫秒级直接目标解析与遮挡预检 (elementFromPoint)
 *  5. rAF 自适应微沉降 (Adaptive Micro-Settle)
 */

import type { InteractiveElement } from './types.js';

export const INJECTED_DOM_SCRIPT = `(() => {
  // 1. 初始化或复用全局活体缓存
  const cache = window.__lite_fast__ = window.__lite_fast__ || {
    ids: new WeakMap(),
    nodes: new Map(),
    elements: new Map(),
    next: 1,
    version: 1,
  };

  cache.elements.clear();
  // 保持与历史 __lite_elements__ 的向下兼容引用
  window.__lite_elements__ = cache.elements;

  // 清理脱离文档树的陈旧节点
  for (const [id, e] of cache.nodes) {
    if (!e.isConnected) cache.nodes.delete(id);
  }

  const identity = (e) => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e);
    cache.nodes.set(id, e);
    return id;
  };

  const safe = (e) => !['password', 'hidden'].includes(e.type);

  // 2. 原生高效可见性判定（避免触发全页面 Reflow）
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"],[inert]')) return false;

    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;
    const maxViewportY = Math.max(window.innerHeight * 2.5, 1200);
    if (rect.bottom < -300 || rect.top > maxViewportY) return false;
    return true;
  };

  // 3. 完备的可访问性名称与文本提取
  const getCleanName = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);

    const referenced = (e.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map(id => getCleanName(document.getElementById(id), seen)).filter(Boolean).join(' ');
    if (referenced) return referenced.replace(/\\s+/g, ' ').trim().slice(0, 80);

    const ariaLabel = e.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.replace(/\\s+/g, ' ').trim().slice(0, 80);

    if (e.labels && e.labels.length) {
      const lText = [...e.labels].map(l => getCleanName(l, seen)).filter(Boolean).join(' ');
      if (lText) return lText.replace(/\\s+/g, ' ').trim().slice(0, 80);
    }

    if (['button', 'submit', 'reset'].includes(e.type) && e.value) {
      return String(e.value).replace(/\\s+/g, ' ').trim().slice(0, 80);
    }

    const alt = e.getAttribute('alt');
    if (alt) return alt.replace(/\\s+/g, ' ').trim().slice(0, 80);

    if (e.tagName !== 'INPUT') {
      const direct = [...e.childNodes]
        .map(n => n.nodeType === 3 ? n.textContent : (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' ? getCleanName(n, seen) : ''))
        .join(' ').replace(/\\s+/g, ' ').trim();
      if (direct) return direct.slice(0, 80);
    }

    const placeholder = e.getAttribute('placeholder');
    if (placeholder) return placeholder.replace(/\\s+/g, ' ').trim().slice(0, 80);

    const title = e.getAttribute('title');
    if (title) return title.replace(/\\s+/g, ' ').trim().slice(0, 80);

    const val = e.value;
    if (typeof val === 'string' && val) return val.replace(/\\s+/g, ' ').trim().slice(0, 80);

    return '';
  };

  const getStableSelector = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('data-testid')) return '[data-testid="' + CSS.escape(el.getAttribute('data-testid')) + '"]';
    if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.getAttribute('name')) + '"]';
    if (el.getAttribute('aria-label')) return '[' + 'aria-label="' + CSS.escape(el.getAttribute('aria-label')) + '"]';

    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).filter(c => !c.includes(':') && c.length > 2 && c.length < 30).slice(0, 2);
      if (cls.length > 0) sel += '.' + cls.map(c => CSS.escape(c)).join('.');
    }
    return sel;
  };

  const roles = [
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemradio',
    'option', 'combobox', 'textbox', 'searchbox', 'spinbutton'
  ];
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    roles.map(r => '[role="' + r + '"]').join(',') + ',[tabindex]:not([tabindex="-1"]),[onclick],[class*="btn"],[class*="item"]';

  const candidates = document.querySelectorAll(selector);
  const results = [];
  let counter = 1;

  for (const el of candidates) {
    if (!safe(el) || !isVisible(el) || el.matches(':disabled') || el.closest('[aria-disabled="true"]')) continue;

    const isNative = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName);
    const hasRole = el.hasAttribute('role') || el.hasAttribute('onclick') || el.hasAttribute('tabindex') || el.isContentEditable;
    const isPointer = el.style && el.style.cursor === 'pointer';
    if (!isNative && !hasRole && !isPointer) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width > 900 && rect.height > 700) continue;

    const text = getCleanName(el);
    if (!text && !isNative) continue;

    const id = '@' + counter++;
    const tag = el.tagName.toLowerCase();
    const explicitRole = el.getAttribute('role');
    const role = explicitRole || (['checkbox', 'radio'].includes(el.type) ? el.type : (el.type || tag));
    const stableSel = getStableSelector(el);
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    const item = {
      id,
      tag,
      role,
      text,
      selector: stableSel,
      x,
      y,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    identity(el);
    cache.elements.set(id, { ...item, el });
    results.push(item);
  }

  cache.pageKey = () => [
    performance.timeOrigin,
    location.href,
    scrollX,
    scrollY,
    innerWidth,
    innerHeight,
    results.length,
  ];

  return {
    url: window.location.href,
    title: document.title,
    elements: results,
    pageKey: cache.pageKey(),
  };
})()`;

/**
 * 极速目标解析脚本：直接通过在内存活体引用进行 1ms 毫秒级探测
 * 兼备动态几何校准与 elementFromPoint 实时遮挡核验
 */
export const FAST_RESOLVE_TARGET_SCRIPT = `((target) => {
  const cache = window.__lite_fast__ || { elements: window.__lite_elements__ };
  const elements = cache.elements instanceof Map ? cache.elements : (window.__lite_elements__ instanceof Map ? window.__lite_elements__ : null);

  let item = null;
  const isId = typeof target === 'string' && target.startsWith('@');
  if (isId && elements) {
    item = elements.get(target);
  }

  let el = item ? item.el : null;
  if (!el && typeof target === 'string' && !isId) {
    try {
      el = document.querySelector(target);
    } catch (_) {}
  }

  if (!el || !el.isConnected) {
    return { ok: false, reason: 'stale' };
  }

  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      return { ok: false, reason: 'invisible' };
    }
  } else {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return { ok: false, reason: 'invisible' };
    }
  }

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { ok: false, reason: 'zero_box' };
  }

  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
    return { ok: false, reason: 'offscreen', x, y };
  }

  const topEl = document.elementFromPoint(x, y);
  const occluded = topEl && !el.contains(topEl) && !topEl.contains(el);

  return {
    ok: true,
    x,
    y,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    selector: item ? item.selector : (el.id ? '#' + el.id : el.tagName.toLowerCase()),
    tag: item ? item.tag : el.tagName.toLowerCase(),
    role: item ? item.role : (el.getAttribute('role') || el.type || el.tagName.toLowerCase()),
    text: item ? item.text : (el.innerText || el.textContent || '').trim().slice(0, 80),
    occluded: !!occluded,
  };
})`;

/**
 * 自适应微沉降脚本 (Adaptive Micro-Settle)
 * 2 个渲染帧 (~32ms) 替代无脑 sleep；针对 combobox 动态等待选项就绪（上限 200ms）
 */
export const ADAPTIVE_SETTLE_SCRIPT = `((options = {}) => new Promise((resolve) => {
  const isCombobox = !!options.combobox;
  const timeoutMs = isCombobox ? 200 : 50;
  let frames = 0;
  let stopped = false;

  const timer = setTimeout(() => {
    stopped = true;
    resolve({ settled: true, reason: 'timeout' });
  }, timeoutMs);

  const check = () => {
    if (stopped) return;
    frames++;
    if (isCombobox) {
      const optionsFound = document.querySelectorAll('[role="option"], .suggestion-item, .dropdown-menu li');
      if (optionsFound.length > 0 && frames >= 2) {
        clearTimeout(timer);
        stopped = true;
        return resolve({ settled: true, reason: 'combobox_options' });
      }
    }
    if (frames >= 2) {
      clearTimeout(timer);
      stopped = true;
      return resolve({ settled: true, reason: 'raf' });
    }
    requestAnimationFrame(check);
  };

  requestAnimationFrame(check);
}))`;

export function formatSnapshot(elements: InteractiveElement[], url: string, title: string): string {
  const lines = [
    `🌐 页面: ${title || '无标题'} (${url})`,
    `📋 可交互元素 (${elements.length} 项):`,
    '────────────────────────────────────────────────────────',
  ];

  for (const item of elements) {
    const textPart = item.text ? `"${item.text}"` : '<无文本>';
    lines.push(`  ${item.id.padEnd(5)} [${item.tag}:${item.role}] ${textPart.padEnd(35)} (x:${item.x}, y:${item.y})`);
  }

  lines.push('────────────────────────────────────────────────────────');
  return lines.join('\n');
}
