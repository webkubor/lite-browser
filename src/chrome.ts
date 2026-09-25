/**
 * chrome.ts —— Chrome 进程探测、启停与 Agent 身份感知调度
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionState, LaunchOptions, AgentSessionRecord } from './types.js';
import { SessionRegistry } from './registry.js';

const SESSION_FILE = '/tmp/lite-browser-session.json';
const DEFAULT_PORT = 9222;
export const PROFILES_DIR = join(homedir(), '.lite-browser', 'profiles');

export class ChromeManager {
  public port: number;
  private registry: SessionRegistry;

  constructor(port = DEFAULT_PORT) {
    this.port = port;
    this.registry = new SessionRegistry();
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
    const { headless = false, url = 'about:blank', userDataDir, profile, temp = false, agent: explicitAgent, reuse = false } = options;

    const agent = SessionRegistry.detectCurrentAgent(explicitAgent);

    // 智能凭据复用检查（免重复登录）
    if (reuse && url && url !== 'about:blank') {
      const domain = SessionRegistry.extractDomain(url);
      if (domain) {
        const reusable = this.registry.findByDomain(domain);
        if (reusable) {
          const isAlive = await this.registry.pingPort(reusable.port);
          if (isAlive) {
            console.log(`💡 [免登录复用] 命中已有登录态会话 (Agent: ${reusable.agent}, 端口: ${reusable.port}, 域名: ${domain})`);
            this.port = reusable.port;
            const pages = await this.getPages();
            let targetPage = pages.find((p: any) => p.type === 'page' && p.url.includes(domain));
            if (!targetPage) {
              targetPage = await this.newPage(url);
            }
            const reusedSession: SessionState = {
              agent,
              port: reusable.port,
              pid: reusable.pid,
              wsUrl: targetPage.webSocketDebuggerUrl,
              targetId: targetPage.id,
              url: targetPage.url,
              title: targetPage.title || '',
              profile: reusable.profile,
              loginDomains: Array.from(new Set([...(reusable.loginDomains || []), domain])),
              status: 'active',
              createdAt: reusable.createdAt,
              updatedAt: new Date().toISOString(),
            };
            writeFileSync(SESSION_FILE, JSON.stringify(reusedSession, null, 2));
            this.registry.save(reusedSession);
            return reusedSession;
          }
        }
      }
    }

    // 若未显式传入固定端口，且显式指定了 Agent 或当前为独立 Agent 环境，则从注册表按 Agent 隔离端口
    if (this.port === DEFAULT_PORT && (explicitAgent || agent !== 'default')) {
      this.port = await this.registry.allocatePort(agent);
    }

    let versionInfo = await this.checkPort();

    const profileName = profile || (temp ? undefined : (agent !== 'default' ? `agent-${agent}` : 'default'));
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

    let spawnedPid: number | undefined;

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
      spawnedPid = proc.pid;
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

    const domain = SessionRegistry.extractDomain(targetPage.url);
    const loginDomains = domain ? [domain] : [];

    const session: SessionState = {
      agent,
      port: this.port,
      pid: spawnedPid,
      wsUrl: targetPage.webSocketDebuggerUrl,
      targetId: targetPage.id,
      url: targetPage.url,
      title: targetPage.title || '',
      profile: profileName || 'default',
      loginDomains,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    this.registry.save(session);

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

  static getActiveSession(agentOrPort?: string | number): SessionState | null {
    const registry = new SessionRegistry();
    const effective = agentOrPort || SessionRegistry.detectCurrentAgent();
    if (effective) {
      if (typeof effective === 'number' || !isNaN(Number(effective))) {
        const found = registry.getByPort(Number(effective));
        if (found) return found;
      } else {
        const found = registry.getByAgent(String(effective));
        if (found) return found;
      }
    }

    // 默认从临时全局会话读取，若无则取注册表中最近的 active 会话
    if (existsSync(SESSION_FILE)) {
      try {
        return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
      } catch (_) {}
    }

    const all = registry.getAll().filter((s) => s.status === 'active');
    return all.length > 0 ? all[all.length - 1] : null;
  }

  static updateSessionUrl(url: string, title = ''): void {
    const session = ChromeManager.getActiveSession();
    if (session) {
      session.url = url;
      if (title) session.title = title;
      session.updatedAt = new Date().toISOString();

      const domain = SessionRegistry.extractDomain(url);
      if (domain && !session.loginDomains?.includes(domain)) {
        session.loginDomains = [...(session.loginDomains || []), domain];
      }

      try {
        writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
        new SessionRegistry().save(session);
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

  static clearSession(agentOrPort?: string | number): void {
    if (existsSync(SESSION_FILE)) {
      try { unlinkSync(SESSION_FILE); } catch (_) {}
    }
    if (agentOrPort) {
      new SessionRegistry().remove(agentOrPort);
    }
  }
}
