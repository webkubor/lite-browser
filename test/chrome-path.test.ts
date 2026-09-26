/**
 * 浏览器选择的契约测试。
 *
 * 这里钉三件事，都是「不测就会悄悄坏掉」的：
 *
 * 1) `LITE_BROWSER_BROWSER` 能覆盖自动探测 —— 换浏览器 / CI 指到别处全靠它
 * 2) 候选**顺序**里没有已退役的浏览器，且 Google Chrome 排第一
 * 3) 「文件在」不等于「它能跑」：只探测文件存在会让 lite-browser 拿着一个
 *    只剩空 `Contents/MacOS/` 的 app bundle 去启动
 *
 * 历史教训：这个文件原来第二条写的是「ego lite 优先于 Google Chrome」，而且断言前
 * 有 `if (!existsSync(ego) || !existsSync(chrome)) return` —— 在只装了一个浏览器的
 * 机器上它**什么都不检查就通过**。ego lite 退役、owner 卸载后，这条测试依然全绿，
 * 但工具已经找不到任何浏览器了。空跑的断言比没有断言更坏：它给的是假的安心。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChromeManager, browserCandidates, pickBrowser } from '../src/chrome.js';

const ORIGINAL = process.env.LITE_BROWSER_BROWSER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LITE_BROWSER_BROWSER;
  else process.env.LITE_BROWSER_BROWSER = ORIGINAL;
});

describe('LITE_BROWSER_BROWSER 覆盖', () => {
  it('指向可执行文件时直接采用', () => {
    process.env.LITE_BROWSER_BROWSER = '/bin/sh';
    expect(ChromeManager.getChromePath()).toBe('/bin/sh');
  });

  it('指向不存在的文件时报错，而不是静默回退', () => {
    process.env.LITE_BROWSER_BROWSER = '/nope/not-a-browser';
    expect(() => ChromeManager.getChromePath()).toThrow(/不存在或不可执行/);
  });

  it('指向一个存在但不可执行的文件时同样报错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lb-notexec-'));
    const f = join(dir, 'not-a-browser');
    writeFileSync(f, '#!/bin/sh\n');
    chmodSync(f, 0o644);
    process.env.LITE_BROWSER_BROWSER = f;
    try {
      expect(() => ChromeManager.getChromePath()).toThrow(/不存在或不可执行/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('候选浏览器顺序', () => {
  const candidates = browserCandidates('/nonexistent-home');
  const paths = candidates.map((c) => c.path);

  it('Google Chrome 排第一 —— 它是最常见的安装', () => {
    expect(candidates[0].label).toBe('Google Chrome');
    expect(candidates[0].path).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('已退役的 ego lite 不得出现在候选里', () => {
    expect(paths.some((p) => p.includes('ego lite'))).toBe(false);
  });

  it('Safari 不得出现在候选里 —— 它没有 CDP，放进来是误导', () => {
    expect(paths.some((p) => p.includes('Safari'))).toBe(false);
  });

  it('候选全部是 Chromium 内核且支持 --remote-debugging-port 的常见发行版', () => {
    const labels = new Set(candidates.map((c) => c.label));
    for (const expected of ['Google Chrome', 'Chromium', 'Brave', 'Microsoft Edge']) {
      expect(labels.has(expected)).toBe(true);
    }
  });

  it('Chrome for Testing（兜底）排在所有正式安装之后', () => {
    const first = paths.findIndex((p) => p.includes('ms-playwright'));
    if (first === -1) return;
    expect(paths.slice(0, first).some((p) => p.includes('Google Chrome.app'))).toBe(true);
    expect(paths.slice(first).every((p) => p.includes('ms-playwright'))).toBe(true);
  });
});

describe('pickBrowser', () => {
  const cands = [
    { label: 'A', path: '/a' },
    { label: 'B', path: '/b' },
  ];

  it('返回第一个可用的候选，顺序即优先级', () => {
    expect(pickBrowser(cands, (p) => p === '/b')?.label).toBe('B');
    expect(pickBrowser(cands, () => true)?.label).toBe('A');
  });

  it('一个都不可用时返回 undefined，而不是硬塞一个', () => {
    expect(pickBrowser(cands, () => false)).toBeUndefined();
  });
});

describe('真实环境的兜底契约', () => {
  it('要么返回一个真能执行的文件，要么报错并把找过的地方列全', () => {
    delete process.env.LITE_BROWSER_BROWSER;
    try {
      const p = ChromeManager.getChromePath();
      // 探测出来的路径必须真的存在 —— 不能是「bundle 在但 MacOS/ 是空的」
      expect(() => accessSync(p, constants.X_OK)).not.toThrow();
    } catch (err) {
      const msg = String((err as Error).message);
      expect(msg).toContain('已查找');
      // 报错必须点名真的找过的路径，而不是一个用户装不回来的名字
      expect(msg).toContain('/Applications/Google Chrome.app');
      expect(msg).not.toContain('ego lite');
      expect(msg).toContain('Safari 不可用');
    }
  });

  it('App bundle 存在但 Contents/MacOS 是空的 → 不认它', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lb-emptybundle-'));
    const macos = join(dir, 'Fake.app/Contents/MacOS');
    mkdirSync(macos, { recursive: true }); // 目录在，可执行文件不在
    const cand = [{ label: 'Fake', path: join(macos, 'Fake') }];
    try {
      expect(pickBrowser(cand)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
