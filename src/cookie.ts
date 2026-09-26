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

    const whereClause = domain ? `WHERE host_key LIKE '%${domain}%'` : '';
    let raw = '';
    try {
      raw = execSync(`sqlite3 "${tmpDb}" "SELECT host_key || '|||' || name || '|||' || path || '|||' || is_secure || '|||' || is_httponly || '|||' || hex(encrypted_value) FROM cookies ${whereClause};"`).toString();
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
    for (const line of lines) {
      const [hostKey, name, path, isSecure, isHttpOnly, hexEnc] = line.split('|||');
      const val = decrypt(hexEnc);
      if (val) {
        cdpCookies.push({
          name,
          value: val,
          domain: hostKey,
          path: path || '/',
          secure: isSecure === '1',
          httpOnly: isHttpOnly === '1',
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

