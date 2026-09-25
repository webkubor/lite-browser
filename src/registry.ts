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
   * 获取所有会话记录
   */
  getAll(): AgentSessionRecord[] {
    this.ensureDir();
    if (!existsSync(REGISTRY_FILE)) return [];
    try {
      return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
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
    const index = all.findIndex((r) => r.agent.toLowerCase() === record.agent.toLowerCase());
    if (index >= 0) {
      all[index] = {
        ...all[index],
        ...record,
        updatedAt: new Date().toISOString(),
      };
    } else {
      all.push(record);
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
   * 根据目标域名寻找已有可用登录态的会话（免重复登录）
   */
  findByDomain(domainOrUrl: string): AgentSessionRecord | null {
    const domain = SessionRegistry.extractDomain(domainOrUrl) || domainOrUrl;
    const all = this.getAll();

    // 优先寻找 status === 'active' 且显式标记拥有该域名登录态的会话
    const matched = all.find(
      (r) =>
        r.status === 'active' &&
        (r.loginDomains?.some((d) => domain.includes(d) || d.includes(domain)) ||
          r.url?.includes(domain))
    );

    return matched || null;
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
   * 记录该会话成功访问/登录了某个平台域名
   */
  registerLoginDomain(port: number, domainOrUrl: string): void {
    const domain = SessionRegistry.extractDomain(domainOrUrl) || domainOrUrl;
    const all = this.getAll();
    const record = all.find((r) => r.port === port);
    if (record) {
      if (!record.loginDomains) record.loginDomains = [];
      if (!record.loginDomains.includes(domain)) {
        record.loginDomains.push(domain);
        record.updatedAt = new Date().toISOString();
        writeFileSync(REGISTRY_FILE, JSON.stringify(all, null, 2));
      }
    }
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
      if (typeof agentOrPort === 'number') return r.port !== agentOrPort;
      return r.agent.toLowerCase() !== agentOrPort.toLowerCase();
    });
    writeFileSync(REGISTRY_FILE, JSON.stringify(filtered, null, 2));
  }
}
