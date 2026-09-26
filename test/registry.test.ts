import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionRegistry } from '../src/registry.js';
import { STATE_ROOT } from '../src/paths.js';
import type { AgentSessionRecord } from '../src/types.js';

describe('SessionRegistry & Multi-Agent Identity Isolation', () => {
  const registry = new SessionRegistry();
  // 必须跟着 STATE_ROOT 走（测试由 test/setup.ts 指向临时目录）。
  // 曾经硬编码 homedir()，于是测试直接改写用户真实注册表 —— 跑一次测试，
  // `lite-browser session list` 就开始显示假 Agent。
  const testFile = join(STATE_ROOT, 'session-registry.json');
  let originalContent = '';

  beforeEach(() => {
    if (existsSync(testFile)) {
      originalContent = JSON.parse(JSON.stringify(registry.getAll()));
    }
  });

  afterAll(() => {
    if (originalContent) {
      writeFileSync(testFile, JSON.stringify(originalContent, null, 2));
    }
  });

  it('should detect caller agent identity correctly', () => {
    // 1. 显式指定最高优先级
    expect(SessionRegistry.detectCurrentAgent('Claude-Code')).toBe('claude-code');
    expect(SessionRegistry.detectCurrentAgent('GEMINI')).toBe('gemini');

    // 2. 环境变量感知
    const prevEnv = process.env.LITE_BROWSER_AGENT;
    process.env.LITE_BROWSER_AGENT = 'my-custom-agent';
    expect(SessionRegistry.detectCurrentAgent()).toBe('my-custom-agent');
    if (prevEnv) {
      process.env.LITE_BROWSER_AGENT = prevEnv;
    } else {
      delete process.env.LITE_BROWSER_AGENT;
    }

    // 3. Antigravity / Gemini 感知
    const prevAg = process.env.ANTIGRAVITY_AGENT;
    process.env.ANTIGRAVITY_AGENT = '1';
    expect(SessionRegistry.detectCurrentAgent()).toBe('gemini');
    if (prevAg) {
      process.env.ANTIGRAVITY_AGENT = prevAg;
    } else {
      delete process.env.ANTIGRAVITY_AGENT;
    }
  });

  it('should extract domains cleanly from URLs', () => {
    expect(SessionRegistry.extractDomain('https://juejin.cn/editor/drafts/123')).toBe('juejin.cn');
    expect(SessionRegistry.extractDomain('http://xiaohongshu.com/creator')).toBe('xiaohongshu.com');
    expect(SessionRegistry.extractDomain('https://sub.domain.co.uk/path?q=1')).toBe('sub.domain.co.uk');
    expect(SessionRegistry.extractDomain('invalid-url')).toBeNull();
  });

  it('should save, query, and isolate sessions by agent', () => {
    const recordA: AgentSessionRecord = {
      agent: 'gemini-tester',
      port: 9888,
      pid: 1111,
      profile: 'agent-gemini-tester',
      url: 'https://mock-domain-a.com/creator',
      title: '创作者中心',
      targetId: 'target-1',
      wsUrl: 'ws://127.0.0.1:9888/devtools/page/1',
      verifiedDomains: ['mock-domain-a.com'],
      visitedDomains: ['mock-domain-a.com', 'mock-visited-only.com'],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const recordB: AgentSessionRecord = {
      agent: 'claude-tester',
      port: 9889,
      pid: 2222,
      profile: 'agent-claude-tester',
      url: 'https://mock-domain-b.com',
      title: 'GitHub',
      targetId: 'target-2',
      wsUrl: 'ws://127.0.0.1:9889/devtools/page/2',
      verifiedDomains: ['mock-domain-b.com'],
      visitedDomains: ['mock-domain-b.com'],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.save(recordA);
    registry.save(recordB);

    const queriedA = registry.getByAgent('gemini-tester');
    expect(queriedA).not.toBeNull();
    expect(queriedA?.port).toBe(9888);
    expect(queriedA?.verifiedDomains).toContain('mock-domain-a.com');
    expect(queriedA?.visitedDomains).toContain('mock-visited-only.com');
    // 兼容镜像：旧字段仍然写回 verified 集合
    expect(queriedA?.loginDomains).toContain('mock-domain-a.com');
    expect(queriedA?.loginDomains).not.toContain('mock-visited-only.com');

    const queriedB = registry.getByAgent('claude-tester');
    expect(queriedB).not.toBeNull();
    expect(queriedB?.port).toBe(9889);
    expect(queriedB?.verifiedDomains).toContain('mock-domain-b.com');
  });

  it('should find sessions with reusable domain login state (verified only)', () => {
    const found = registry.findByDomain('mock-domain-a.com');
    expect(found).not.toBeNull();
    expect(found?.agent).toBe('gemini-tester');
    expect(found?.port).toBe(9888);

    const foundByFullUrl = registry.findByDomain('https://mock-domain-a.com/post/123456');
    expect(foundByFullUrl).not.toBeNull();
    expect(foundByFullUrl?.agent).toBe('gemini-tester');

    const notFound = registry.findByDomain('unknown-domain-xyz.com');
    expect(notFound).toBeNull();
  });

  /**
   * 回归测试：这正是「--reuse 谎报免登录复用」的根因。
   * 仅仅导航到过某域名，不足以宣称拥有该域名的登录态。
   */
  it('should NOT reuse a domain that was merely visited, never verified', () => {
    const visitedOnly: AgentSessionRecord = {
      agent: 'visited-only-tester',
      port: 9890,
      profile: 'agent-visited-only',
      url: 'https://mock-visited-only.com/home',
      title: '只是个浏览记录',
      targetId: 'target-3',
      wsUrl: 'ws://127.0.0.1:9890/devtools/page/3',
      verifiedDomains: [],
      visitedDomains: ['mock-visited-only.com'],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    registry.save(visitedOnly);

    expect(registry.findByDomain('mock-visited-only.com')).toBeNull();

    // 人工/探针确认之后才可复用
    registry.registerLoginDomain(9890, 'mock-visited-only.com');
    expect(registry.findByDomain('mock-visited-only.com')?.agent).toBe('visited-only-tester');

    registry.remove(9890);
  });

  it('should treat legacy loginDomains as visited-only after migration', () => {
    // 旧版本把导航域名写进 loginDomains，迁移时必须降级为 visited：
    // 否则老数据会继续骗人说「登录态可复用」。
    const legacy = {
      agent: 'legacy-tester',
      port: 9891,
      profile: 'agent-legacy',
      url: 'https://mock-legacy.com',
      title: 'legacy',
      targetId: 'target-4',
      wsUrl: 'ws://127.0.0.1:9891/devtools/page/4',
      loginDomains: ['mock-legacy.com'],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const all = registry.getAll();
    all.push(legacy as any);
    writeFileSync(testFile, JSON.stringify(all, null, 2));

    const migrated = registry.getByAgent('legacy-tester');
    expect(migrated?.visitedDomains).toContain('mock-legacy.com');
    expect(migrated?.verifiedDomains).toEqual([]);
    expect(registry.findByDomain('mock-legacy.com')).toBeNull();

    registry.remove(9891);
  });

  it('should append login domains via registerLoginDomain', () => {
    registry.registerLoginDomain(9888, 'https://mock-extra-domain.im');
    const updated = registry.getByPort(9888);
    expect(updated?.verifiedDomains).toContain('mock-extra-domain.im');
    expect(updated?.loginDomains).toContain('mock-extra-domain.im');
  });

  it('should distinguish sole active session from ambiguous multi-session state', () => {
    const before = registry.getAll();
    // 造一个只有一条活跃记录的世界
    const single = before.filter((r) => r.agent === 'gemini-tester');
    writeFileSync(testFile, JSON.stringify(single, null, 2));
    expect(registry.getSoleActive()?.agent).toBe('gemini-tester');

    // 两条活跃记录时不得擅自推断
    const two = before.filter((r) => r.agent === 'gemini-tester' || r.agent === 'claude-tester');
    writeFileSync(testFile, JSON.stringify(two, null, 2));
    expect(registry.getSoleActive()).toBeNull();

    writeFileSync(testFile, JSON.stringify(before, null, 2));
  });

  it('should persist handoff state so any later command can read the phase', () => {
    registry.updateHandoff(9888, {
      phase: 'awaiting_human',
      since: new Date().toISOString(),
      needs: '请扫码登录',
      blocker: '页面呈现登录墙',
      nextAction: 'lite-browser await-human --timeout 300',
    });

    const record = registry.getByPort(9888);
    expect(record?.handoff?.phase).toBe('awaiting_human');
    expect(record?.handoff?.needs).toBe('请扫码登录');
    expect(record?.lastSeen).toBeTruthy();
  });

  it('should remove sessions by agent name or port', () => {
    registry.remove('claude-tester');
    expect(registry.getByAgent('claude-tester')).toBeNull();

    registry.remove(9888);
    expect(registry.getByPort(9888)).toBeNull();
  });

  it('should generate distinctive lightning title badge', () => {
    const { BrowserActions } = require('../src/actions.js');
    const fakeClient = {} as any;

    const actionDefault = new BrowserActions(fakeClient, 'default');
    expect(actionDefault.getBadgePrefix()).toBe('⚡ [lite] ');

    const actionGemini = new BrowserActions(fakeClient, 'gemini');
    expect(actionGemini.getBadgePrefix()).toBe('⚡ [lite:gemini] ');

    const actionClaude = new BrowserActions(fakeClient, 'claude-code');
    expect(actionClaude.getBadgePrefix()).toBe('⚡ [lite:claude-code] ');

    // 测试环境变量自定义
    const prevBadge = process.env.LITE_BROWSER_BADGE;
    process.env.LITE_BROWSER_BADGE = '⚡ [custom]';
    expect(actionGemini.getBadgePrefix()).toBe('⚡ [custom] ');
    if (prevBadge) {
      process.env.LITE_BROWSER_BADGE = prevBadge;
    } else {
      delete process.env.LITE_BROWSER_BADGE;
    }
  });
});

