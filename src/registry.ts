/**
 * registry.ts —— Agent 身份感知、多租户端口分配与凭据复用注册中心
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionRecord } from './types.js';

const CONFIG_DIR = join(homedir(), '.lite-browser');
const REGISTRY_FILE = join(CONFIG_DIR, 'session-registry.json');
const BASE_PORT = 9222;

export class SessionRegistry {
  constructor() {
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  /**
   * 自动探测当前调用者身份
   */
  static detectCurrentAgent(explicit?: string): string {
    if (explicit && explicit.trim()) {
      return explicit.trim().toLowerCase();
    }

    const env = process.env;
    if (env.LITE_BROWSER_AGENT) return env.LITE_BROWSER_AGENT.toLowerCase();
    if (env.AGENT_NAME) return env.AGENT_NAME.toLowerCase();
    if (env.ANTIGRAVITY_AGENT || env.GEMINI_CLI) return 'gemini';
    if (env.CLAUDE_CODE || env.CLAUDE_AGENT || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
    if (env.CODEX_CLI || env.CODEX) return 'codex';
    if (env.HERMES_AGENT || env.HERMES) return 'hermes';

    return 'default';
  }

  /**
   * 提取 URL 的主域名
   */
  static extractDomain(urlStr: string): string | null {
    try {
      const u = new URL(urlStr);
      return u.hostname;
    } catch (_) {
      return null;
    }
  }

  /**
   * 获取所有会话记录（含旧格式迁移）。
   *
   * 旧版本把「导航到过该域名」直接写进 loginDomains，于是「已记录登录域」
   * 只能证明访问过、不能证明登录过。迁移时把这类旧值降级进 visitedDomains，
   * verifiedDomains 从空开始 —— 宁可真登录一次，也不谎报免登录复用。
   */
  getAll(): AgentSessionRecord[] {
    this.ensureDir();
    if (!existsSync(REGISTRY_FILE)) return [];
    try {
      const raw = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      return raw.map((r: AgentSessionRecord) => ({
        ...r,
        verifiedDomains: r.verifiedDomains ?? [],
        visitedDomains: r.visitedDomains ?? (r.loginDomains ? [...r.loginDomains] : []),
        loginDomains: r.verifiedDomains ?? [],
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * 保存单条会话记录
   */
  save(record: AgentSessionRecord): void {
    this.ensureDir();
    const all = this.getAll();
    const normalized: AgentSessionRecord = {
      ...record,
      verifiedDomains: record.verifiedDomains ?? [],
      visitedDomains: record.visitedDomains ?? [],
      // 镜像写回旧字段，保持外部消费方兼容
      loginDomains: record.verifiedDomains ?? [],
    };
    const index = all.findIndex((r) => r.agent.toLowerCase() === normalized.agent.toLowerCase());
    if (index >= 0) {
      all[index] = {
        ...all[index],
        ...normalized,
        updatedAt: new Date().toISOString(),
      };
    } else {
      all.push(normalized);
    }
    writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
  }

  /**
   * 根据 Agent 身份获取会话
   */
  getByAgent(agent: string): AgentSessionRecord | null {
    const all = this.getAll();
    return all.find((r) => r.agent.toLowerCase() === agent.toLowerCase() && r.status === 'active') || null;
  }

  /**
   * 根据端口获取会话
   */
  getByPort(port: number): AgentSessionRecord | null {
    const all = this.getAll();
    return all.find((r) => r.port === port && r.status === 'active') || null;
  }

  /**
   * 按域名寻找可复用的会话（免重复登录）。
   *
   * 只认 verifiedDomains —— 也就是经过探针或人工确认的登录态。曾经参与匹配的
   * `r.url.includes(domain)` 已移除：那只是在说「这个会话当前开在这个域名上」，
   * 和「这个会话登录了该域名」是两回事。
   */
  findByDomain(domainOrUrl: string): AgentSessionRecord | null {
    const domain = SessionRegistry.extractDomain(domainOrUrl) || domainOrUrl;
    const all = this.getAll();
    return (
      all.find(
        (r) =>
          r.status === 'active' &&
          r.verifiedDomains?.some((d) => domain.includes(d) || d.includes(domain))
      ) || null
    );
  }

  /**
   * 仅导航到过该域名（不构成登录证据）。命中即返回 true 表示新登记。
   */
  registerVisitedDomain(port: number, domainOrUrl: string): boolean {
    const domain = SessionRegistry.extractDomain(domainOrUrl) || domainOrUrl;
    if (!domain || domain === 'about:blank' || domain === 'localhost') return false;
    const all = this.getAll();
    const record = all.find((r) => r.port === port);
    if (!record) return false;
    if (!record.visitedDomains) record.visitedDomains = [];
    if (record.visitedDomains.includes(domain)) return false;
    record.visitedDomains.push(domain);
    record.updatedAt = new Date().toISOString();
    writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
    return true;
  }

  /**
   * 为 Agent 分配或复用专属端口
   */
  async allocatePort(agent: string): Promise<number> {
    const existing = this.getByAgent(agent);
    if (existing) {
      const alive = await this.pingPort(existing.port);
      if (alive) return existing.port;
    }

    const all = this.getAll();
    const occupiedPorts = new Set(all.filter((r) => r.status === 'active').map((r) => r.port));

    // 从 9222 开始探测未被占用的端口
    for (let p = BASE_PORT; p < BASE_PORT + 20; p++) {
      const alive = await this.pingPort(p);
      if (!occupiedPorts.has(p) && !alive) {
        return p;
      }
      if (alive && !occupiedPorts.has(p)) {
        // 说明有存量 Chrome，可直接接管
        return p;
      }
    }

    return BASE_PORT;
  }

  /**
   * 探测端口连通性
   */
  async pingPort(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * 登记「已确认登录」的域名（verified）。只有探针判定 authenticated 或人工
   * 显式 `session mark-login` 时才允许调用。
   */
  registerLoginDomain(port: number, domainOrUrl: string): void {
    const domain = SessionRegistry.extractDomain(domainOrUrl) || domainOrUrl;
    const all = this.getAll();
    const record = all.find((r) => r.port === port);
    if (record) {
      if (!record.verifiedDomains) record.verifiedDomains = [];
      if (!record.verifiedDomains.includes(domain)) {
        record.verifiedDomains.push(domain);
      }
      if (!record.visitedDomains) record.visitedDomains = [];
      if (!record.visitedDomains.includes(domain)) {
        record.visitedDomains.push(domain);
      }
      record.loginDomains = [...record.verifiedDomains];
      record.updatedAt = new Date().toISOString();
      writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
    }
  }

  /**
   * 写入交接状态（相位机）。这是「人现在该做什么」的唯一落盘点。
   */
  updateHandoff(port: number, handoff: AgentSessionRecord['handoff']): void {
    const all = this.getAll();
    const record = all.find((r) => r.port === port);
    if (!record) return;
    record.handoff = handoff;
    record.lastSeen = new Date().toISOString();
    record.updatedAt = record.lastSeen;
    writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
  }

  /**
   * 刷新心跳，证明该会话的进程还活着（不只是端口还在监听）。
   */
  heartbeat(port: number): void {
    const all = this.getAll();
    const record = all.find((r) => r.port === port);
    if (!record) return;
    record.lastSeen = new Date().toISOString();
    record.updatedAt = record.lastSeen;
    writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
  }

  /**
   * 唯一的活跃会话。用于「未显式指定 agent/port」时的**无歧义**兜底：
   * 只有恰好一个时才能安全推断，多个并存必须由调用方显式指定。
   */
  getSoleActive(): AgentSessionRecord | null {
    const actives = this.getAll().filter((r) => r.status === 'active');
    return actives.length === 1 ? actives[0] : null;
  }

  /**
   * 清理已死亡的失效会话
   */
  async cleanDeadSessions(): Promise<{ cleaned: number; active: number }> {
    const all = this.getAll();
    let cleaned = 0;
    let active = 0;

    for (const r of all) {
      const isAlive = await this.pingPort(r.port);
      if (!isAlive) {
        r.status = 'closed';
        cleaned++;
      } else {
        r.status = 'active';
        active++;
      }
    }

    writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
    return { cleaned, active };
  }

  /**
   * 移除或关闭会话记录
   */
  remove(agentOrPort: string | number): void {
    const all = this.getAll();
    const filtered = all.filter((r) => {
      if (typeof agentOrPort === 'number' || !isNaN(Number(agentOrPort))) {
        return r.port !== Number(agentOrPort);
      }
      return r.agent.toLowerCase() !== String(agentOrPort).toLowerCase();
    });
    writeFileSync(REGISTRY_FILE, JSON.stringify(filtered, null, 2));
  }
}
