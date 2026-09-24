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
}
