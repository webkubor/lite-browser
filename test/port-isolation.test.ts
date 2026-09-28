import { describe, it, expect } from 'bun:test';
import { DEFAULT_PORT, BASE_PORT, RESERVED_HUMAN_PORT } from '../src/constants.js';

/**
 * 端口隔离的契约：AI 会话永远不落到 9222。
 *
 * 这不是「风格偏好」—— 9222 是人类自己开 --remote-debugging-port 时的第一反应，
 * 历史上 AI 会话就分配在 9222，于是「AI 接管了用户真实浏览器、带真实登录态」是
 * 默认可能而非意外。这里把那条边界钉死成测试，防止改端口时无声回退。
 */
describe('端口隔离：9222 留给人类', () => {
  it('AI 分配区间不包含保留给人类的 9222', () => {
    expect(RESERVED_HUMAN_PORT).toBe(9222);
    expect(BASE_PORT).not.toBe(RESERVED_HUMAN_PORT);
  });

  it('分配区间 [BASE_PORT, BASE_PORT+20) 整体高于 9222', () => {
    expect(BASE_PORT).toBeGreaterThan(RESERVED_HUMAN_PORT);
  });

  it('裸调用（无 --agent）也落在 AI 区间，不会掉回 9222 去接管人类浏览器', () => {
    // chrome.ts: new ChromeManager(port = DEFAULT_PORT) —— 兜底值必须已经在安全侧，
    // 否则「忘了传 --agent」就会精准落到用户的浏览器上。
    expect(DEFAULT_PORT).toBe(BASE_PORT);
    expect(DEFAULT_PORT).toBeGreaterThan(RESERVED_HUMAN_PORT);
  });

  it('端口是单一真源：registry 与 chrome 共用同一常量，不会各算各的', () => {
    // 三处硬编码散落时，改一处漏一处 → 注册表分配 9229、ChromeManager 落 9222，
    // 结果是静默接管错实例而不是报错。共用常量后这条差异不可能再出现。
    expect(BASE_PORT).toBe(DEFAULT_PORT);
  });
});
