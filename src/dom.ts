/**
 * dom.ts —— DOM 交互元素抽取、精简编号与定位脚本
 */

import type { InteractiveElement } from './types.js';

export const INJECTED_DOM_SCRIPT = `(() => {
  window.__lite_elements__ = new Map();
  let counter = 1;

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;
    const maxViewportY = Math.max(window.innerHeight * 2.5, 1200);
    if (rect.bottom < -300 || rect.top > maxViewportY) return false;
    return true;
  };

  const getCleanText = (el) => {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 80);
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

  const candidates = document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"]), [class*="btn"], [class*="tag"], [class*="item"]'
  );

  const results = [];

  for (const el of candidates) {
    if (!isVisible(el)) continue;

    const style = window.getComputedStyle(el);
    const isNative = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const hasRole = el.hasAttribute('role') || el.hasAttribute('onclick') || el.hasAttribute('tabindex');
    const isPointer = style.cursor === 'pointer';
    if (!isNative && !hasRole && !isPointer) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width > 800 && rect.height > 600) continue;

    const text = getCleanText(el);
    if (!text && !isNative) continue;

    if ((el.tagName === 'A' || el.tagName === 'BUTTON') && el.parentElement && (el.parentElement.closest('a') || el.parentElement.closest('button'))) {
      // 避免父子嵌套重复收集
    }

    const id = '@' + counter++;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || el.type || tag;
    const selector = getStableSelector(el);
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    window.__lite_elements__.set(id, { el, selector, x, y, tag, role, text });

    results.push({
      id,
      tag,
      role,
      text,
      selector,
      x,
      y,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  return results;
})()`;

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
