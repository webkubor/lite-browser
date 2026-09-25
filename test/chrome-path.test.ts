/**
 * 浏览器选择的契约测试。
 *
 * 钉两件事：
 * 1) `LITE_BROWSER_BROWSER` 能覆盖自动探测 —— 换 Brave / 换回 Chrome / CI 指到别处全靠它
 * 2) 自动探测时 **ego lite 优先于 Google Chrome**
 *
 * 第 2 条不是审美偏好，是可用性：两者都装时如果落回 Chrome，agent 拉起的窗口
 * 和用户自己的 Chrome 在 Dock 里图标完全一样，分不清哪个是 agent 在用。
 * 这条断言一旦红，说明顺序被人调回去了。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { ChromeManager } from '../src/chrome.js';

const ORIGINAL = process.env.LITE_BROWSER_BROWSER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LITE_BROWSER_BROWSER;
  else process.env.LITE_BROWSER_BROWSER = ORIGINAL;
});

describe('getChromePath', () => {
  it('LITE_BROWSER_BROWSER 指向存在的文件时直接采用', () => {
    process.env.LITE_BROWSER_BROWSER = '/bin/sh';
    expect(ChromeManager.getChromePath()).toBe('/bin/sh');
  });

  it('LITE_BROWSER_BROWSER 指向不存在的文件时报错，而不是静默回退', () => {
    process.env.LITE_BROWSER_BROWSER = '/nope/not-a-browser';
    expect(() => ChromeManager.getChromePath()).toThrow(/不存在/);
  });

  it('未设覆盖时，ego lite 优先于 Google Chrome（两者都装的情况下）', () => {
    delete process.env.LITE_BROWSER_BROWSER;
    const ego = '/Applications/ego lite.app/Contents/MacOS/ego lite';
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(ego) || !existsSync(chrome)) return; // 只在两者都装的机器上断言
    expect(ChromeManager.getChromePath()).toBe(ego);
  });
});
