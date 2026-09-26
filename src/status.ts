/**
 * status.ts —— 会话状态聚合
 *
 * 把「这个 Agent 现在处于什么阶段、正在等谁、下一步该做什么」聚合成一个
 * 稳定契约。这是 Agent 判断交接进程的唯一真源，也是人类一眼看清状态的地方，
 * 取代过去散落在 whoami / session list 里的几行中文。
 */

import { CdpClient } from './cdp.js';
import { ChromeManager } from './chrome.js';
import { SessionRegistry } from './registry.js';
import { AUTH_PROBE_SCRIPT, buildHandoff } from './handoff.js';
import { TaskEngine } from './task.js';
import type { AuthProbe, AuthState, SessionPhase, SessionStatus } from './types.js';

export interface BuildStatusOptions {
  /** 是否连上去做一次活体登录态探针（默认 true；离线探查时设 false 更快） */
  live?: boolean;
}

const NON_TERMINAL = new Set(['pending', 'running', 'awaiting_human']);

export async function buildSessionStatus(
  agentOrPort?: string | number,
  options: BuildStatusOptions = {}
): Promise<SessionStatus | null> {
  const live = options.live ?? true;
  const registry = new SessionRegistry();
  const session = ChromeManager.getActiveSession(agentOrPort);
  if (!session) return null;

  const alive = await registry.pingPort(session.port);

  let probe: AuthProbe | null = null;
  let handoff = session.handoff ?? buildHandoff('idle');

  if (alive && live && session.wsUrl) {
    let client: CdpClient | null = null;
    try {
      client = new CdpClient(session.wsUrl);
      await client.connect(3000);
      await client.send('Runtime.enable');
      const res = await client.send('Runtime.evaluate', {
        expression: AUTH_PROBE_SCRIPT,
        returnByValue: true,
      });
      const value = res.result?.value;
      if (value) {
        probe = { ...value, probeAt: new Date().toISOString() };
      }
    } catch (_) {
      // 页面正在刷新或 target 已失效时探针失败属正常，降级为无探针
    } finally {
      try { client?.close(); } catch (_) {}
    }
  }

  // 相位推进：探针是权威证据，优先于持久化的旧相位
  if (probe) {
    if (probe.loginWall) {
      handoff = buildHandoff('awaiting_human', handoff, {
        needs: `请手动完成 ${probe.domain || '目标站点'} 的登录（扫码 / 账号密码 / 验证码均可）`,
        blocker: `页面呈现登录墙（证据: ${probe.signals.join(', ') || '未知'}）`,
        nextAction: 'lite-browser await-human --timeout 300',
      });
      ChromeManager.setHandoff(handoff, session.port);
    } else if (handoff.phase === 'awaiting_human' && probe.state === 'authenticated') {
      handoff = buildHandoff('acting', handoff, { needs: undefined, blocker: undefined, nextAction: undefined });
      ChromeManager.setHandoff(handoff, session.port);
      if (probe.domain) ChromeManager.markVerifiedDomain(probe.domain, session.port);
    }
  }

  let phase: SessionPhase = handoff.phase;
  let blocker = handoff.blocker;
  if (!alive && (phase === 'acting' || phase === 'navigating' || phase === 'idle')) {
    phase = 'blocked';
    blocker = '浏览器进程已离线（端口无响应），会话不可用';
  }

  const lastSeen = session.lastSeen || session.updatedAt;
  const staleSeconds = lastSeen ? Math.max(0, Math.round((Date.now() - new Date(lastSeen).getTime()) / 1000)) : null;

  const task = findActiveTask(session.agent);

  const authState: AuthState = probe?.state ?? 'unknown';
  const effectiveAuth = authState;

  return {
    agent: session.agent,
    port: session.port,
    alive,
    pid: session.pid,
    profile: session.profile,
    url: session.url,
    title: session.title,
    phase,
    since: handoff.since,
    elapsedInPhaseMs: handoff.since ? Date.now() - new Date(handoff.since).getTime() : undefined,
    step: handoff.step,
    needs: handoff.needs,
    blocker,
    nextAction: handoff.nextAction,
    auth: {
      state: effectiveAuth,
      domain: probe?.domain ?? SessionRegistry.extractDomain(session.url),
      verifiedDomains: session.verifiedDomains ?? [],
      visitedDomains: session.visitedDomains ?? session.loginDomains ?? [],
      signals: probe?.signals ?? [],
    },
    lastSeen,
    staleSeconds,
    task,
  };
}

/**
 * 最近一个未终态的委派任务 —— 用于把「会话相位」和「任务相位」对齐。
 * 多 Agent 并存时只认属于自己的任务，否则会把别人的任务贴到本会话上。
 */
function findActiveTask(agent?: string): SessionStatus['task'] {
  try {
    const engine = new TaskEngine();
    const all = engine.getAllTasks();
    const active =
      all.find((t) => NON_TERMINAL.has(t.status) && (!agent || !t.agent || t.agent === agent)) ||
      all.find((t) => NON_TERMINAL.has(t.status) && agent === undefined);
    if (!active) return null;
    return {
      id: active.id,
      sopName: active.sopName,
      status: active.status,
      heartbeatAt: (active as any).heartbeatAt,
    };
  } catch (_) {
    return null;
  }
}
