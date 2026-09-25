import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SessionRegistry } from '../src/registry.js';
import type { AgentSessionRecord } from '../src/types.js';

describe('SessionRegistry & Multi-Agent Identity Isolation', () => {
  const registry = new SessionRegistry();
  const testFile = join(homedir(), '.lite-browser', 'session-registry.json');
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
      loginDomains: ['mock-domain-a.com'],
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
      loginDomains: ['mock-domain-b.com'],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.save(recordA);
    registry.save(recordB);

    const queriedA = registry.getByAgent('gemini-tester');
    expect(queriedA).not.toBeNull();
    expect(queriedA?.port).toBe(9888);
    expect(queriedA?.loginDomains).toContain('mock-domain-a.com');

    const queriedB = registry.getByAgent('claude-tester');
    expect(queriedB).not.toBeNull();
    expect(queriedB?.port).toBe(9889);
    expect(queriedB?.loginDomains).toContain('mock-domain-b.com');
  });

  it('should find sessions with reusable domain login state', () => {
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

  it('should append login domains via registerLoginDomain', () => {
    registry.registerLoginDomain(9888, 'https://mock-extra-domain.im');
    const updated = registry.getByPort(9888);
    expect(updated?.loginDomains).toContain('mock-extra-domain.im');
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

