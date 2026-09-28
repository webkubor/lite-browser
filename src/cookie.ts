/**
 * cookie.ts —— Cookie 导出、导入与会话管理
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BrowserActions } from './actions.js';

export interface ExportCookieOptions {
  domain?: string;
  outFile?: string;
}

export class CookieManager {
  static async export(options: ExportCookieOptions = {}): Promise<{ count: number; cookies: any[]; file?: string }> {
    const browser = await BrowserActions.connectToSession();
    const cookies = await browser.getCookies();

    let filtered = cookies;
    if (options.domain) {
      filtered = cookies.filter((c: any) => c.domain && c.domain.includes(options.domain!));
    }

    if (options.outFile) {
      writeFileSync(options.outFile, JSON.stringify(filtered, null, 2));
    }

    return { count: filtered.length, cookies: filtered, file: options.outFile };
  }

  static async import(filePath: string): Promise<{ count: number }> {
    if (!existsSync(filePath)) {
      throw new Error(`找不到 Cookie 文件: ${filePath}`);
    }

    const raw = readFileSync(filePath, 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) {
      throw new Error('Cookie 文件格式错误，必须为 Cookie 对象数组');
    }

    const browser = await BrowserActions.connectToSession();
    await browser.setCookies(cookies);

    return { count: cookies.length };
  }

  static async clear(): Promise<void> {
    const browser = await BrowserActions.connectToSession();
    await browser.clearCookies();
  }

  /**
   * 从系统日常 Google Chrome 中安全解密并直接注入指定域名（或全量）的 Cookies
   */
  static async pullFromSystem(domain?: string): Promise<{ count: number; domain?: string }> {
    const { execSync } = await import('node:child_process');
    const crypto = await import('node:crypto');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { unlinkSync } = await import('node:fs');

    const chromeCookiePath = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');
    if (!existsSync(chromeCookiePath)) {
      throw new Error(`未找到系统 Chrome Cookies 文件: ${chromeCookiePath}`);
    }

    let password = '';
    try {
      password = execSync('security find-generic-password -w -s "Chrome Safe Storage"').toString().trim();
    } catch (_) {
      throw new Error('无法从 macOS Keychain 读取 "Chrome Safe Storage" 凭据');
    }

    const key = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, 0x20);

    const tmpDb = `/tmp/chrome_cookies_sync_${Date.now()}.db`;
    execSync(`cp "${chromeCookiePath}" "${tmpDb}"`);

    // domain 会被拼进 WHERE。Chrome 域名里本不该出现引号，但「不该出现」不是保证 ——
    // 一旦传进来的值带引号，query 会静默变成另一条 SQL，报出来的却是解密失败，
    // 把排查方向直接带偏（这正是 sync-x-cookies 连续 8 次误报的那类问题）。
    // 所以只放行 Chrome 域名真实用得到的字符，其余一律拒绝，而不是拼进去赌一把。
    const domainPattern = domain ? sanitizeDomainPattern(domain) : undefined;
    const whereClause = domainPattern ? `WHERE host_key LIKE '%${domainPattern}%'` : '';
    let raw = '';
    try {
      raw = execSync(`sqlite3 "${tmpDb}" "SELECT host_key || '|||' || name || '|||' || path || '|||' || is_secure || '|||' || is_httponly || '|||' || expires_utc || '|||' || hex(encrypted_value) FROM cookies ${whereClause};"`).toString();
    } finally {
      try { unlinkSync(tmpDb); } catch (_) {}
    }

    function decrypt(hexStr: string): string {
      if (!hexStr) return '';
      const buf = Buffer.from(hexStr, 'hex');
      if (buf.length <= 3) return '';
      const data = buf.slice(3); // strip 'v10'
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(true);
        const dec = Buffer.concat([decipher.update(data), decipher.final()]);
        return dec.length > 32 ? dec.slice(32).toString('utf8') : dec.toString('utf8');
      } catch (_) {
        return '';
      }
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    const cdpCookies: any[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    for (const line of lines) {
      const [hostKey, name, path, isSecure, isHttpOnly, expiresUtc, hexEnc] = line.split('|||');
      const val = decrypt(hexEnc);
      if (val) {
        // 不带 expires 的 cookie 经 CDP 注入后是**会话 cookie**：浏览器一关就没，
        // 于是「导入一次登录态」变成「每次重启 AI 浏览器都要重导一次」，
        // 用户的原始诉求（AI 拉起的页面别再登出）根本没被解决。
        // Chrome 的 expires_utc 是 1601-01-01 起的微秒，换算成 Unix 秒再设进去，
        // 才会落进 profile 的 cookie store 真正持久化。
        const expires = webkitToUnixSeconds(expiresUtc);
        // 已过期的照搬过来只会变成一堆死 cookie，白白污染目标 profile。
        if (expires !== undefined && expires <= nowSec) continue;

        cdpCookies.push({
          name,
          value: val,
          domain: hostKey,
          path: path || '/',
          secure: isSecure === '1',
          httpOnly: isHttpOnly === '1',
          // expires_utc = 0 是 Chrome 对「会话 cookie」的真实编码，保持不设 expires
          // 才是对的 —— 这类 cookie 本来就没有持久化语义，不该被我们硬造一个。
          ...(expires !== undefined ? { expires } : {}),
        });
      }
    }

    if (cdpCookies.length > 0) {
      const browser = await BrowserActions.connectToSession();
      await browser.setCookies(cdpCookies);
    }

    return { count: cdpCookies.length, domain };
  }
}

/** Chrome/WebKit 纪元（1601-01-01）到 Unix 纪元（1970-01-01）的秒差。 */
const WEBKIT_EPOCH_OFFSET_SEC = 11_644_473_600;

/**
 * 把 Chrome 的 `expires_utc`（1601 纪元微秒）换算成 CDP 要的 Unix 秒。
 *
 * 返回 `undefined` 表示「这条本来就是会话 cookie」（Chrome 用 0 编码），
 * 调用方据此**不设** expires —— 硬造一个过期时间反而改变了 cookie 的语义。
 */
export function webkitToUnixSeconds(expiresUtc: string | undefined): number | undefined {
  const micros = Number(expiresUtc);
  if (!Number.isFinite(micros) || micros <= 0) return undefined;
  const sec = Math.floor(micros / 1_000_000) - WEBKIT_EPOCH_OFFSET_SEC;
  return sec > 0 ? sec : undefined;
}

/**
 * 校验并放行可用于 host_key LIKE 的域名片段。
 *
 * 允许的是 Chrome host_key 真实出现过的形状：前导点、字母数字、连字符、点。
 * 出现别的字符（引号、分号、空格…）就明确拒绝并报出原值，而不是拼进 SQL 赌一把。
 */
export function sanitizeDomainPattern(domain: string): string {
  if (!/^[\w.-]+$/.test(domain)) {
    throw new Error(`域名片段含非法字符，拒绝拼进 SQL: ${JSON.stringify(domain)}（只允许字母数字、点、连字符、下划线）`);
  }
  return domain;
}

