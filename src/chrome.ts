/**
 * chrome.ts —— Chrome 进程探测、启停与 Agent 身份感知调度
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionState, LaunchOptions, AgentSessionRecord, HandoffState, SessionPhase } from './types.js';
import { SessionRegistry } from './registry.js';
import { CdpClient } from './cdp.js';
import { AUTH_PROBE_SCRIPT } from './handoff.js';

const DEFAULT_PORT = 9222;
export const PROFILES_DIR = join(homedir(), '.lite-browser', 'profiles');

/**
 * 会话指针目录：**一 Agent 一文件**。
 *
 * 曾经是全局单文件 `/tmp/lite-browser-session.json`，所有 Agent 共用。多 Agent
 * 并行时后开的会话会覆盖前一个的指针，「当前会话是谁」这个前提本身就不成立 ——
 * 这正是「不知道现在处在什么状态」最底层的原因。
 */
const SESSIONS_DIR = join(homedir(), '.lite-browser', 'sessions');
const LEGACY_SESSION_FILE = '/tmp/lite-browser-session.json';

function sessionFileFor(agent: string): string {
  const safe = String(agent || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(SESSIONS_DIR, `${safe}.json`);
}

export class ChromeManager {
  public port: number;
  private registry: SessionRegistry;

  constructor(port = DEFAULT_PORT) {
    this.port = port;
    this.registry = new SessionRegistry();
  }

  /**
   * 挑一个 Chromium 系浏览器来驱动。
   *
   * **ego lite 排在 Google Chrome 前面**，这是刻意的：lite-browser 拉起的实例会在
   * Dock 里多出一个图标，而它和用户自己那个 Chrome **图标一模一样**，分不清哪个窗口
   * 是 agent 在用、哪个是人在用（owner 2026-09-25 的原话：「我现在本地开好几个
   * Chrome，那个 Chrome 图标都一模一样的」）。
   *
   * 试过给 Chrome 做换图标的 .app 包装，两种都不行：`exec` 转发后进程归属跟着真
   * Chrome 的 bundle 走，Dock 图标不变；软链式副本会让 Chrome Helper 加载 Framework
   * 时被 sandbox 拦死（`dlopen ... file system sandbox blocked open()`）。要真换图标
   * 只能整包复制 600MB 再重签名，不值当。
   *
   * 换个浏览器就白拿这件事：ego lite 本机已装（Chromium 152 内核，实测
   * `--remote-debugging-port` 完全可用），图标是黑白椭圆，和 Chrome 的彩色圆一眼区分，
   * 且 agent 的浏览数据与用户自己的 Chrome 彻底隔离。零新增体积。
   *
   * 要强制指定浏览器（换 Brave / 换回 Chrome / CI 里指到别处）：设环境变量
   * `LITE_BROWSER_BROWSER=<可执行文件绝对路径>`。
   */
  static getChromePath(): string {
    const override = process.env.LITE_BROWSER_BROWSER;
    if (override) {
      if (!existsSync(override)) {
        throw new Error(`LITE_BROWSER_BROWSER 指向的文件不存在：${override}`);
      }
      return override;
    }

    const paths = [
      '/Applications/ego lite.app/Contents/MacOS/ego lite',
      `${homedir()}/Applications/ego lite.app/Contents/MacOS/ego lite`,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];

    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    throw new Error('未在系统找到 ego lite / Google Chrome / Chromium，请确认已安装。');
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

    // 智能凭据复用检查（免重复登录）—— 必须经过活体探针确认，不再凭域名猜
    if (reuse && url && url !== 'about:blank') {
      const domain = SessionRegistry.extractDomain(url);
      if (domain) {
        const reusable = this.registry.findByDomain(domain);
        if (reusable) {
          const isAlive = await this.registry.pingPort(reusable.port);
          if (isAlive) {
            this.port = reusable.port;
            const pages = await this.getPages();
            let targetPage = pages.find((p: any) => p.type === 'page' && p.url.includes(domain));
            if (!targetPage) {
              targetPage = await this.newPage(url);
            }

            const verdict = await ChromeManager.probeReusableLogin(targetPage, domain);
            const reusedSession: SessionState = {
              agent,
              port: reusable.port,
              pid: reusable.pid,
              wsUrl: targetPage.webSocketDebuggerUrl,
              targetId: targetPage.id,
              url: targetPage.url,
              title: targetPage.title || '',
              profile: reusable.profile,
              verifiedDomains: verdict.authenticated
                ? Array.from(new Set([...(reusable.verifiedDomains || []), domain]))
                : [...(reusable.verifiedDomains || [])],
              visitedDomains: Array.from(new Set([...(reusable.visitedDomains || []), domain])),
              handoff: verdict.authenticated
                ? { phase: 'acting', since: new Date().toISOString() }
                : {
                    phase: 'awaiting_human',
                    since: new Date().toISOString(),
                    needs: `请在弹出的窗口中手动完成 ${domain} 的登录`,
                    blocker: verdict.message,
                    nextAction: 'lite-browser await-human --timeout 300',
                  },
              status: 'active',
              createdAt: reusable.createdAt,
              lastSeen: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            if (reusedSession.verifiedDomains?.length) {
              this.registry.save(reusedSession);
            } else {
              this.registry.save({ ...reusedSession, verifiedDomains: reusedSession.verifiedDomains });
            }
            ChromeManager.writeSessionFile(reusedSession);
            console.log(verdict.message);
            return reusedSession;
          }
        } else {
          console.log(`ℹ️ [免登录复用] 未找到 ${domain} 的**已确认**登录态会话（仅有浏览记录不算）。本次将正常打开。`);
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

    const session: SessionState = {
      agent,
      port: this.port,
      pid: spawnedPid,
      wsUrl: targetPage.webSocketDebuggerUrl,
      targetId: targetPage.id,
      url: targetPage.url,
      title: targetPage.title || '',
      profile: profileName || 'default',
      // 导航到的域名只进 visited，登录与否由 actions 里的探针决定
      verifiedDomains: [],
      visitedDomains: domain ? [domain] : [],
      handoff: { phase: 'idle', since: new Date().toISOString() },
      status: 'active',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ChromeManager.writeSessionFile(session);
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

  /**
   * 对候选复用会话做**活体登录态探针**。
   *
   * 这是「免登录复用」不再说谎的关键：过去只要该会话导航过这个域名就宣称
   * 命中登录态，于是 Agent 打印「已复用」然后在中途步骤炸掉，错误信息与登录
   * 毫无关系，人也无从判断。这里只有页面证据说 authenticated 才算数。
   */
  static async probeReusableLogin(
    page: any,
    domain: string
  ): Promise<{ ok: boolean; authenticated: boolean; message: string }> {
    if (!page?.webSocketDebuggerUrl) {
      return { ok: false, authenticated: false, message: `ℹ️ [免登录复用] ${domain} 的候选会话缺少可调试页面，跳过复用。` };
    }
    let client: CdpClient | null = null;
    try {
      client = new CdpClient(page.webSocketDebuggerUrl);
      await client.connect(5000);
      await client.send('Runtime.enable');
      const res = await client.send('Runtime.evaluate', {
        expression: AUTH_PROBE_SCRIPT,
        returnByValue: true,
      });
      const probe = res.result?.value;
      if (!probe) {
        return { ok: true, authenticated: false, message: `ℹ️ [免登录复用] 已接管 ${domain} 会话窗口，但登录态无法确认（探针无返回）。` };
      }
      if (probe.state === 'authenticated') {
        return {
          ok: true,
          authenticated: true,
          message: `✅ [免登录复用] 已确认 ${domain} 登录态有效（证据: ${(probe.signals || []).join(', ') || '无'}），免重复登录生效。`,
        };
      }
      if (probe.loginWall) {
        return {
          ok: true,
          authenticated: false,
          message: `⚠️  [免登录复用] 未复用登录态：${domain} 页面检测到登录墙（证据: ${(probe.signals || []).join(', ')}）。已接管窗口，需要你手动登录。`,
        };
      }
      return {
        ok: true,
        authenticated: false,
        message: `ℹ️ [免登录复用] 已接管 ${domain} 会话窗口，但登录态证据不足，未登记为 verified。若后续遇到登录页请人工介入。`,
      };
    } catch (err: any) {
      return { ok: false, authenticated: false, message: `⚠️  [免登录复用] 探针执行失败（${err.message}），本次不复用该会话。` };
    } finally {
      try { client?.close(); } catch (_) {}
    }
  }

  static getActiveSession(agentOrPort?: string | number): SessionState | null {
    const registry = new SessionRegistry();
    const effective = agentOrPort || SessionRegistry.detectCurrentAgent();

    if (effective) {
      if (typeof effective === 'number' || !isNaN(Number(effective))) {
        const found = registry.getByPort(Number(effective));
        if (found) return found;
      } else {
        // 该 Agent 的私有会话指针是权威来源，其次才是注册表
        const own = ChromeManager.readSessionFile(String(effective));
        if (own) {
          const alive = registry.getAll().find((r) => r.port === own.port && r.status === 'active');
          if (alive) return alive;
        }
        const found = registry.getByAgent(String(effective));
        if (found) return found;
      }
    }

    // 无歧义兜底：全系统恰好只有一个活跃会话时才敢推断。
    // 过去这里会直接取 `all[all.length - 1]`，于是 A 的点击完全可能落在 B 的
    // 页面上 —— 多 Agent 并行时这是静默的错误，比报错危险得多。
    // 旧版遗留的全局指针 /tmp/lite-browser-session.json 不再参与推断（它正是
    // 那个会被后来者覆盖的共享文件），只由 clearSession 负责清理。
    return registry.getSoleActive();
  }

  /** 读取指定 Agent 的私有会话指针 */
  private static readSessionFile(agent: string): SessionState | null {
    const file = sessionFileFor(agent);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  private static writeSessionFile(session: SessionState): void {
    try {
      if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
      writeFileSync(sessionFileFor(session.agent), JSON.stringify(session, null, 2));
    } catch (_) {}
  }

  private static readLegacySessionFile(): SessionState | null {
    if (!existsSync(LEGACY_SESSION_FILE)) return null;
    try {
      return JSON.parse(readFileSync(LEGACY_SESSION_FILE, 'utf-8'));
    } catch (_) {
      return null;
    }
  }

  static updateSessionUrl(url: string, title = '', agentOrPort?: string | number): void {
    const session = ChromeManager.getActiveSession(agentOrPort);
    if (!session) return;
    session.url = url;
    if (title) session.title = title;
    session.lastSeen = new Date().toISOString();
    session.updatedAt = session.lastSeen;

    const registry = new SessionRegistry();
    // 导航只登记 visited —— 访问过某域名不等于登录了它。旧实现在这里写
    // loginDomains，正是「--reuse 谎报免登录复用」的源头。
    const domain = SessionRegistry.extractDomain(url);
    if (domain) {
      if (!session.visitedDomains) session.visitedDomains = [];
      if (!session.visitedDomains.includes(domain)) session.visitedDomains.push(domain);
      registry.registerVisitedDomain(session.port, domain);
    }

    try {
      ChromeManager.writeSessionFile(session);
      registry.save(session);
    } catch (_) {}
  }

  /**
   * 落入一个交接相位。人类需要的三个信息（needs / blocker / nextAction）
   * 与相位一起持久化，任何后续命令都能读到，而不依赖进程内状态。
   */
  static setHandoff(handoff: HandoffState, agentOrPort?: string | number): void {
    const session = ChromeManager.getActiveSession(agentOrPort);
    if (!session) return;
    session.handoff = handoff;
    session.lastSeen = new Date().toISOString();
    session.updatedAt = session.lastSeen;
    try {
      ChromeManager.writeSessionFile(session);
      new SessionRegistry().updateHandoff(session.port, handoff);
    } catch (_) {}
  }

  static getPhase(agentOrPort?: string | number): SessionPhase | null {
    const session = ChromeManager.getActiveSession(agentOrPort);
    return session?.handoff?.phase ?? null;
  }

  /** 登记已确认的登录域（verified） */
  static markVerifiedDomain(domain: string, agentOrPort?: string | number): void {
    const session = ChromeManager.getActiveSession(agentOrPort);
    if (!session) return;
    const registry = new SessionRegistry();
    registry.registerLoginDomain(session.port, domain);
    const refreshed = registry.getByPort(session.port);
    if (refreshed) ChromeManager.writeSessionFile({ ...session, ...refreshed } as SessionState);
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
    const session = ChromeManager.getActiveSession(agentOrPort);
    if (session) {
      try { unlinkSync(sessionFileFor(session.agent)); } catch (_) {}
    }
    // 顺带清掉旧版遗留的全局指针，避免它继续误导会话推断
    if (existsSync(LEGACY_SESSION_FILE)) {
      try { unlinkSync(LEGACY_SESSION_FILE); } catch (_) {}
    }
    if (agentOrPort) {
      new SessionRegistry().remove(agentOrPort);
    }
  }
}
