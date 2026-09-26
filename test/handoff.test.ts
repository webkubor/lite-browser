/**
 * handoff.test.ts —— 交接协议的契约测试
 *
 * 钉的是「人能不能看懂现在在等谁」这件事本身：
 *   1. 登录墙探针的打分逻辑（宁可 unknown，也不谎报 authenticated）
 *   2. 相位状态机的迁移规则
 *   3. 交接卡片必须同时给出「需要你做什么」和「恢复命令」——缺一个就不算交接
 */

import { describe, it, expect } from 'bun:test';
import {
  AUTH_PROBE_SCRIPT,
  EXIT_AWAITING_HUMAN,
  EXIT_AWAIT_TIMEOUT,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  buildHandoff,
  formatElapsed,
  loginHandoffPrompt,
  phaseAfterProbe,
  renderHandoffCard,
  renderStatusLine,
} from '../src/handoff.js';
import type { AuthProbe, SessionStatus } from '../src/types.js';

// ───────────────────────── 探针执行环境（最小假 DOM） ─────────────────────────

interface ProbeFixture {
  url?: string;
  host?: string;
  innerText?: string;
  passwordInputs?: number;
  qrcodeElements?: number;
  avatarElements?: number;
  cookie?: string;
}

function runProbe(fixture: ProbeFixture): AuthProbe {
  const makeEls = (n: number, cls = '') => {
    const arr: any[] = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        getAttribute: (k: string) => (k === 'src' ? 'https://x/qrcode.png' : ''),
        className: cls,
        id: '',
      });
    }
    return arr;
  };

  const document = {
    body: { innerText: fixture.innerText ?? '' },
    cookie: fixture.cookie ?? '',
    querySelectorAll: (selector: string) => {
      if (selector.includes('input[type=password]')) return makeEls(fixture.passwordInputs ?? 0);
      if (selector.includes('qrcode')) return makeEls(fixture.qrcodeElements ?? 0, 'qrcode-img');
      if (selector.includes('avatar')) return makeEls(fixture.avatarElements ?? 0, 'avatar');
      return [];
    },
  };

  const location = {
    href: fixture.url ?? 'https://example.com/',
    hostname: fixture.host ?? 'example.com',
  };

  // 先编译：模板字符串里的正则转义一旦写错，这里就会抛 SyntaxError
  const fn = new Function('location', 'document', `return ${AUTH_PROBE_SCRIPT}`);
  return fn(location, document) as AuthProbe;
}

describe('登录墙探针 (AUTH_PROBE_SCRIPT)', () => {
  it('脚本必须是合法 JS 且能返回结构化结果', () => {
    const res = runProbe({});
    expect(res.state).toBe('unknown');
    expect(res.loginWall).toBe(false);
    expect(Array.isArray(res.signals)).toBe(true);
    expect(res.domain).toBe('example.com');
  });

  it('密码输入框 + 登录路径 => 判定为登录墙', () => {
    const res = runProbe({
      url: 'https://juejin.cn/login?redirect=%2Feditor',
      passwordInputs: 1,
    });
    expect(res.loginWall).toBe(true);
    expect(res.state).toBe('anonymous');
    expect(res.score).toBeGreaterThanOrEqual(3);
    expect(res.signals).toContain('url-login-path');
    expect(res.signals.some((s) => s.startsWith('password-input'))).toBe(true);
  });

  it('扫码登录文案 + 二维码 => 判定为登录墙', () => {
    const res = runProbe({
      innerText: '扫码登录 微信扫码安全登录',
      qrcodeElements: 1,
    });
    expect(res.state).toBe('anonymous');
    expect(res.loginWall).toBe(true);
  });

  /**
   * 关键回归：导航栏里的裸「登录」按钮到处都是，不能因此把正常页面
   * 误判成登录墙 —— 那会逼人类做无谓的介入。
   */
  it('仅出现裸「登录」二字时不得误判为登录墙', () => {
    const res = runProbe({ innerText: '首页 沸点 课程 登录 注册 写文章' });
    expect(res.loginWall).toBe(false);
    expect(res.state).toBe('unknown');
  });

  it('退出登录文案等强负向信号应抵消弱正向信号', () => {
    const res = runProbe({
      innerText: '退出登录 我的主页 个人中心',
      avatarElements: 1,
      cookie: 'sessionid=abc123',
    });
    expect(res.loginWall).toBe(false);
    expect(res.state).toBe('authenticated');
    expect(res.signals).toContain('-logout-copy');
  });

  it('中间态不得被当成已登录（宁可 unknown）', () => {
    const res = runProbe({ innerText: '欢迎来到掘金' });
    expect(res.state).toBe('unknown');
  });
});

describe('相位状态机', () => {
  const wall: AuthProbe = {
    state: 'anonymous',
    score: 5,
    loginWall: true,
    domain: 'juejin.cn',
    url: 'https://juejin.cn/login',
    signals: ['url-login-path'],
    probeAt: new Date().toISOString(),
  };
  const authed: AuthProbe = { ...wall, state: 'authenticated', score: -4, loginWall: false };
  const unknown: AuthProbe = { ...wall, state: 'unknown', score: 1, loginWall: false };

  it('登录墙 => awaiting_human', () => {
    expect(phaseAfterProbe(wall, 'acting')).toBe('awaiting_human');
  });

  it('等待中检测到登录完成 => 回到 acting', () => {
    expect(phaseAfterProbe(authed, 'awaiting_human')).toBe('acting');
  });

  it('证据不足时保持原相位，不擅自跳变', () => {
    expect(phaseAfterProbe(unknown, 'acting')).toBe('acting');
    expect(phaseAfterProbe(unknown, 'completed')).toBe('completed');
  });

  it('同一相位内 since 保持不变，跨相位才重置', () => {
    const oldSince = '2020-01-01T00:00:00.000Z';
    const first = { phase: 'acting' as const, since: oldSince };

    // 同相位：延续原来的 since，否则「已停留多久」永远显示 0
    const again = buildHandoff('acting', first);
    expect(again.since).toBe(oldSince);

    // 跨相位：重置计时
    const moved = buildHandoff('awaiting_human', again, { needs: '请登录' });
    expect(moved.phase).toBe('awaiting_human');
    expect(moved.since).not.toBe(oldSince);
    expect(new Date(moved.since).getTime()).toBeGreaterThan(new Date(oldSince).getTime());
    expect(moved.needs).toBe('请登录');
  });

  it('进入登录交接时 needs / blocker / nextAction 三者齐全', () => {
    const prompt = loginHandoffPrompt('juejin.cn', '页面呈现登录墙');
    expect(prompt.needs).toContain('juejin.cn');
    expect(prompt.blocker).toBeTruthy();
    expect(prompt.nextAction).toContain('await-human');
  });
});

describe('交接卡片渲染', () => {
  const status: SessionStatus = {
    agent: 'claude-code',
    port: 9222,
    alive: true,
    profile: 'agent-claude-code',
    url: 'https://juejin.cn/login',
    title: '登录 - 掘金',
    phase: 'awaiting_human',
    since: new Date().toISOString(),
    elapsedInPhaseMs: 65_000,
    step: { index: 2, total: 5, label: '发布文章' },
    needs: '请在弹出的浏览器窗口中手动完成 juejin.cn 的登录',
    blocker: '页面呈现登录墙',
    nextAction: 'lite-browser await-human --timeout 300',
    auth: {
      state: 'anonymous',
      domain: 'juejin.cn',
      verifiedDomains: [],
      visitedDomains: ['juejin.cn'],
      signals: ['url-login-path'],
    },
    lastSeen: new Date().toISOString(),
    staleSeconds: 3,
    task: null,
  };

  it('卡片必须同时包含「需要你做」与「恢复命令」', () => {
    const card = renderHandoffCard(status);
    expect(card).toContain('需要你介入');
    expect(card).toContain('juejin.cn');
    expect(card).toContain('await-human');
    expect(card).toContain('2/5');
    expect(card).toContain('1 分 5 秒');
  });

  it('相位摘要行在 awaiting_human 时明确写「需要你介入」', () => {
    expect(renderStatusLine(status)).toContain('需要你介入');
    expect(renderStatusLine(status)).toContain('phase=awaiting_human');
  });

  it('时间格式化可读', () => {
    expect(formatElapsed(5_000)).toBe('5 秒');
    expect(formatElapsed(125_000)).toBe('2 分 5 秒');
    expect(formatElapsed(undefined)).toBe('未知');
  });
});

describe('退出码契约', () => {
  it('值与文档一致，脚本可据此分支而不必解析中文', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_ERROR).toBe(1);
    expect(EXIT_USAGE).toBe(2);
    expect(EXIT_AWAITING_HUMAN).toBe(3);
    expect(EXIT_AWAIT_TIMEOUT).toBe(4);
  });
});
