/**
 * chrome.ts —— Chrome 进程探测、启停与 CDP Endpoint 解析
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionState, LaunchOptions } from './types.js';

const SESSION_FILE = '/tmp/lite-browser-session.json';
const DEFAULT_PORT = 9222;
export const PROFILES_DIR = join(homedir(), '.lite-browser', 'profiles');

export class ChromeManager {
  public port: number;

  constructor(port = DEFAULT_PORT) {
    this.port = port;
  }

  static getChromePath(): string {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];

    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    throw new Error('未在系统找到 Google Chrome / Chromium，请确认已安装。');
  }

  async checkPort(): Promise<any | null> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return null;
  }

  async getOrLaunch(options: LaunchOptions & { temp?: boolean } = {}): Promise<SessionState> {
    const { headless = false, url = 'about:blank', userDataDir, profile, temp = false } = options;

    let versionInfo = await this.checkPort();

    const profileName = profile || (temp ? undefined : 'default');
    let effectiveUserDataDir = userDataDir;

    if (!effectiveUserDataDir) {
      if (temp) {
        effectiveUserDataDir = `/tmp/lite-browser-profile-${this.port}`;
      } else {
        effectiveUserDataDir = join(PROFILES_DIR, profileName || 'default');
      }
    }

    if (!existsSync(effectiveUserDataDir)) {
      try {
        mkdirSync(effectiveUserDataDir, { recursive: true });
      } catch (_) {}
    }

    if (!versionInfo) {
      const chromePath = ChromeManager.getChromePath();
      const args = [
        `--remote-debugging-port=${this.port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
      ];

      if (headless) {
        args.push('--headless=new', '--disable-gpu');
      }

      args.push(`--user-data-dir=${effectiveUserDataDir}`);
      args.push(url);

      const proc = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();

      const startTime = Date.now();
      while (Date.now() - startTime < 8000) {
        await new Promise((r) => setTimeout(r, 200));
        versionInfo = await this.checkPort();
        if (versionInfo) break;
      }

      if (!versionInfo) {
        throw new Error(`启动 Chrome 失败或端口 ${this.port} 未能在预期时间内响应`);
      }
    }

    const pages = await this.getPages();
    let targetPage = pages.find((p: any) => p.type === 'page');

    if (!targetPage) {
      targetPage = await this.newPage(url);
    }

    const session: SessionState = {
      port: this.port,
      wsUrl: targetPage.webSocketDebuggerUrl,
      targetId: targetPage.id,
      url: targetPage.url,
      profile: profileName,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));

    return session;
  }

  async getPages(): Promise<any[]> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    if (!res.ok) throw new Error(`获取页面列表失败: HTTP ${res.status}`);
    return await res.json();
  }

  async newPage(url = 'about:blank'): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!res.ok) throw new Error(`新建标签页失败: HTTP ${res.status}`);
    return await res.json();
  }

  static getActiveSession(): SessionState | null {
    if (!existsSync(SESSION_FILE)) return null;
    try {
      return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  static updateSessionUrl(url: string): void {
    const session = ChromeManager.getActiveSession();
    if (session) {
      session.url = url;
      session.updatedAt = new Date().toISOString();
      try {
        writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
      } catch (_) {}
    }
  }

  static listProfiles(): string[] {
    if (!existsSync(PROFILES_DIR)) return [];
    try {
      return readdirSync(PROFILES_DIR);
    } catch (_) {
      return [];
    }
  }

  static clearSession(): void {
    if (existsSync(SESSION_FILE)) {
      try { unlinkSync(SESSION_FILE); } catch (_) {}
    }
  }
}
