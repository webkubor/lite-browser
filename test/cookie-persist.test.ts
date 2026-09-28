import { describe, it, expect } from 'bun:test';
import { webkitToUnixSeconds, sanitizeDomainPattern } from '../src/cookie.js';

/**
 * 「导入一次登录态」必须是真的一次。
 *
 * CDP 注入的 cookie 不带 expires 就是**会话 cookie** —— 浏览器一关就没。
 * 于是 pull-system 表面成功、实际每次重启 AI 浏览器都要重导一次，
 * 用户的原始诉求（AI 拉起的页面别再登出）根本没被解决。
 */
describe('cookie pull-system 持久化', () => {
  it('把 Chrome 的 WebKit 微秒换算成 Unix 秒', () => {
    // 2026-09-28 前后的一次到期时间，换算后应落在合理区间
    const micros = (1_789_000_000 + 11_644_473_600) * 1_000_000;
    expect(webkitToUnixSeconds(String(micros))).toBe(1_789_000_000);
  });

  it('expires_utc = 0（会话 cookie）→ 不给 expires，而不是硬造一个', () => {
    expect(webkitToUnixSeconds('0')).toBeUndefined();
    expect(webkitToUnixSeconds('')).toBeUndefined();
    expect(webkitToUnixSeconds(undefined)).toBeUndefined();
  });

  it('非数字/负数一律当无效，不产出垃圾时间戳', () => {
    expect(webkitToUnixSeconds('abc')).toBeUndefined();
    expect(webkitToUnixSeconds('-1')).toBeUndefined();
  });

  describe('域名片段不被拼进 SQL', () => {
    it('放行 Chrome host_key 的真实形状', () => {
      expect(sanitizeDomainPattern('x.com')).toBe('x.com');
      expect(sanitizeDomainPattern('.x.com')).toBe('.x.com');
      expect(sanitizeDomainPattern('console-test.modelgo.com')).toBe('console-test.modelgo.com');
    });

    it('带引号的域名明确拒绝，而不是拼进去赌一把', () => {
      // 一旦拼进去，query 会静默变成另一条 SQL，报出来的却是「解密失败」，
      // 把排查方向直接带偏 —— 正是 sync-x-cookies 连续 8 次误报的那类问题。
      expect(() => sanitizeDomainPattern("x.com' OR '1'='1")).toThrow(/非法字符/);
      expect(() => sanitizeDomainPattern('x.com; DROP TABLE cookies')).toThrow(/非法字符/);
    });

    it('报错信息带上原值，便于定位是谁传错了', () => {
      expect(() => sanitizeDomainPattern('bad value')).toThrow(/bad value/);
    });
  });
});
