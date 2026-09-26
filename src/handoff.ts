/**
 * handoff.ts —— Agent ↔ 人类交接协议
 *
 * 解决的问题：Agent 跑到一半需要人类扫码/授权时，外部看到的仍然只是
 * 「任务在运行」，人不知道该做什么、Agent 也不知道该不该继续等。
 *
 * 这里定义三件事：
 *   1. 登录墙探针（probeAuth）——用证据判定当前页面到底登录没登录；
 *   2. 相位状态机（buildHandoff / phaseAfterProbe）——把「在等谁」显式建模；
 *   3. 交接卡片渲染（renderHandoff）——给人看的中文指令 + 给 Agent 看的 JSON。
 */

import type { AuthProbe, AuthState, HandoffState, SessionPhase, SessionStatus } from './types.js';

/**
 * 退出码契约：脚本与 Agent 可以据此分支，而不必解析中文输出。
 *   0 = 正常完成
 *   1 = 执行错误
 *   2 = 参数用法错误
 *   3 = 需要人类介入（awaiting_human）
 *   4 = 超时未等到人类
 */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_AWAITING_HUMAN = 3;
export const EXIT_AWAIT_TIMEOUT = 4;

/**
 * 登录墙探针脚本。在页面内执行，返回结构化证据。
 *
 * 判定原则：**宁可 unknown，也不谎报 authenticated**。原实现仅凭「导航过该
 * 域名」就宣称「免登录复用命中」，导致 Agent 在后续步骤炸得莫名其妙；这里
 * 改成加权证据打分，负向信号（退出登录文案、用户头像）可以抵消弱正向信号。
 */
export const AUTH_PROBE_SCRIPT = `(() => {
  const signals = [];
  let score = 0;
  const url = location.href;
  const host = location.hostname;
  const txt = (document.body ? (document.body.innerText || '') : '').slice(0, 8000);

  // ── 强正向：登录墙特征 ──────────────────────────────────────────
  if (/(\\/login|\\/signin|sign-in|\\/sign_in|\\/passport|\\/sso|account\\/login|\\/user\\/login|\\/auth\\/)/i.test(url)) {
    score += 3; signals.push('url-login-path');
  }
  const pwCount = document.querySelectorAll('input[type=password]').length;
  if (pwCount > 0) { score += 3; signals.push('password-input:' + pwCount); }

  // ── 中等正向：二维码 / 扫码 / 验证码 ────────────────────────────
  let qrCount = 0;
  document.querySelectorAll('img,canvas,.qrcode,[class*=qrcode],[class*=qr-code],[id*=qrcode]').forEach((el) => {
    const sig = String(el.getAttribute('src') || '') + ' ' + String(el.className || '') + ' ' + String(el.id || '');
    if (/qrcode|qr-code|qr_code|scan/i.test(sig)) qrCount++;
  });
  if (qrCount > 0) { score += 2; signals.push('qrcode:' + qrCount); }

  // ── 中等正向：只在登录墙出现的专有文案（裸「登录」不算，导航栏到处都有） ──
  const WALL_COPY = ['扫码登录', '请先登录', '请登录后', '登录后即可', '登录后查看', '密码登录', '短信登录', '验证码登录', '立即登录', 'Sign in to continue', 'Please log in', 'Please sign in', 'Log in to continue'];
  const hitCopy = WALL_COPY.filter((t) => txt.includes(t));
  if (hitCopy.length > 0) {
    score += Math.min(2, hitCopy.length + 1);
    signals.push('wall-copy:' + hitCopy.slice(0, 3).join('|'));
  }
  // 独立的「登录/注册」表单标题组合
  if (/登录/.test(txt) && /注册/.test(txt) && /忘记密码|忘记密码|密码/.test(txt)) {
    score += 1; signals.push('login-register-form');
  }

  // ── 负向：明确已登录的信号 ──────────────────────────────────────
  if (/退出登录|退出帐号|退出账号|Sign out|Log out|注销/.test(txt)) {
    score -= 4; signals.push('-logout-copy');
  }
  let avatarHit = 0;
  document.querySelectorAll('[class*=avatar],[class*=Avatar],[class*=user-info],[class*=userInfo],[class*=profile]').forEach(() => { avatarHit++; });
  if (avatarHit > 0) { score -= 1; signals.push('-avatar-like:' + avatarHit); }
  // 常见会话 cookie 名
  if (/(sessionid|session_id|sid=|token=|sso|login_state|auth)/i.test(document.cookie || '')) {
    score -= 1; signals.push('-session-cookie');
  }

  let state = 'unknown';
  if (score >= 3) state = 'anonymous';
  else if (score <= 0 && signals.some((s) => s.charAt(0) === '-')) state = 'authenticated';

  return { state: state, score: score, loginWall: score >= 3, domain: host || null, url: url, signals: signals };
})()`;

/** 人类介入类文案模板（needs + nextAction 成对出现，缺一不可） */
export interface HandoffPrompt {
  needs: string;
  blocker: string;
  nextAction: string;
  /** 人类可读的补充说明 */
  hint?: string;
}

export function loginHandoffPrompt(domain: string | null, reason: string): HandoffPrompt {
  const where = domain || '目标站点';
  return {
    needs: `请在弹出的浏览器窗口中手动完成 ${where} 的登录（扫码 / 账号密码 / 短信验证码均可），完成后不要关闭窗口`,
    blocker: reason,
    nextAction: `lite-browser await-human --timeout 300    # 或人工确认后执行：lite-browser resume`,
    hint: '登录态一旦建立会被登记为 verified，后续任意 Agent 携带 --reuse 即可免重复登录。',
  };
}

export function genericHandoffPrompt(needs: string, blocker: string, nextAction: string, hint?: string): HandoffPrompt {
  return { needs, blocker, nextAction, hint };
}

/**
 * 根据探针结果推导相位。
 *
 * 只有 loginWall 为真才进入 awaiting_human —— 探针证据不足（unknown）时保持
 * 原相位，避免把正常页面误判成交接点、逼人类无谓地介入。
 */
export function phaseAfterProbe(probe: AuthProbe, current: SessionPhase = 'idle'): SessionPhase {
  if (probe.loginWall) return 'awaiting_human';
  if (current === 'awaiting_human' && probe.state === 'authenticated') return 'acting';
  return current;
}

export function buildHandoff(
  phase: SessionPhase,
  prev?: HandoffState,
  patch: Partial<Omit<HandoffState, 'phase' | 'since'>> = {}
): HandoffState {
  const changed = !prev || prev.phase !== phase;
  return {
    ...prev,
    ...patch,
    phase,
    since: changed ? new Date().toISOString() : prev!.since,
  };
}

/** 从探针构造 awaiting_human 的交接状态 */
export function handoffFromLoginWall(probe: AuthProbe, prompt: HandoffPrompt, prev?: HandoffState): HandoffState {
  return buildHandoff('awaiting_human', prev, {
    needs: prompt.needs,
    blocker: prompt.blocker,
    nextAction: prompt.nextAction,
  });
}

/**
 * 渲染给人看的交接卡片。刻意做得非常显眼 —— 人看不到「需要你」就等于没有交接。
 *
 * 刻意不用字符包围框：中文/emoji 是双宽字符，按字符数补空格必然右边界参差，
 * 反而显得潦草。改用与 CLI 其它输出一致的分段线，对齐问题从根上不存在。
 */
export function renderHandoffCard(status: SessionStatus): string {
  const RULE = '────────────────────────────────────────────────────────────────────';
  const lines: string[] = [];
  lines.push('');
  lines.push(RULE);
  lines.push('⏸  lite-browser 暂停中 · 需要你介入');
  lines.push(RULE);
  lines.push(`  Agent        : ${status.agent}`);
  lines.push(`  阶段 (phase) : ${status.phase}${status.since ? `   (已停留 ${formatElapsed(status.elapsedInPhaseMs)})` : ''}`);
  if (status.step) lines.push(`  进度         : 第 ${status.step.index}/${status.step.total} 步 · ${status.step.label}`);
  if (status.title || status.url) lines.push(`  页面         : ${status.title || '(无标题)'}`);
  if (status.url) lines.push(`                 ${status.url}`);
  lines.push('');
  if (status.needs) lines.push(`  👉 需要你做  : ${status.needs}`);
  if (status.blocker) lines.push(`  卡住原因     : ${status.blocker}`);
  if (status.nextAction) lines.push(`  恢复命令     : ${status.nextAction}`);
  lines.push(RULE);
  return lines.join('\n');
}

/** 一行式相位摘要，用于 open / snapshot 等动作后的即时反馈 */
export function renderStatusLine(status: SessionStatus): string {
  const icon =
    status.phase === 'awaiting_human'
      ? '⏸ 需要你介入'
      : status.phase === 'acting'
        ? '▶ 执行中'
        : status.phase === 'navigating'
          ? '↻ 导航中'
          : status.phase === 'blocked'
            ? '⛔ 阻塞'
            : status.phase === 'completed'
              ? '✅ 已完成'
              : '· 空闲';
  const step = status.step ? ` [${status.step.index}/${status.step.total}]` : '';
  return `${icon}${step} phase=${status.phase} auth=${status.auth.state}${status.auth.domain ? ` @${status.auth.domain}` : ''}`;
}

export function formatElapsed(ms?: number): string {
  if (ms === undefined || ms === null) return '未知';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function authStateLabel(state: AuthState): string {
  switch (state) {
    case 'authenticated':
      return '🟢 已登录';
    case 'anonymous':
      return '🔴 未登录（登录墙）';
    default:
      return '⚪ 未知';
  }
}
