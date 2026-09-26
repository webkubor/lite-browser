/**
 * types.ts —— lite-browser 核心类型定义
 */

export interface InteractiveElement {
  id: string; // 例如 "@1", "@2"
  tag: string;
  role: string;
  text: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotResult {
  elements: InteractiveElement[];
  formatted: string;
  title: string;
  url: string;
  /** 快照时的相位；awaiting_human 说明此刻需要人类介入 */
  phase?: SessionPhase;
  auth?: AuthState;
  needs?: string;
  nextAction?: string;
}

/**
 * 会话相位 —— Agent 与人类交接协议的核心状态维度。
 *
 * 没有相位时，「任务在跑」和「任务卡在等人类扫码」在外部看起来完全一样，
 * 这正是交接过程不明确的根因。
 */
export type SessionPhase =
  | 'idle' // 会话已建立，尚未开始任何动作
  | 'navigating' // 正在导航 / 等待页面加载
  | 'acting' // 正在执行动作或 SOP 步骤
  | 'awaiting_human' // 卡在必须人类介入的环节（扫码 / 验证码 / 二次验证 / 授权）
  | 'blocked' // 技术性阻塞（元素找不到、页面结构变化等），Agent 可自愈
  | 'completed'; // 目标已达成

/** 页面登录态判定结果。'unknown' 表示证据不足，绝不当成已登录。 */
export type AuthState = 'authenticated' | 'anonymous' | 'unknown';

export interface AuthProbe {
  state: AuthState;
  /** 登录墙得分，>= 3 判定为登录墙 */
  score: number;
  loginWall: boolean;
  domain: string | null;
  url: string;
  signals: string[];
  probeAt: string;
}

export interface HandoffStep {
  index: number;
  total: number;
  label: string;
}

/** 交接状态 —— 人类需要知道的最小充分信息。 */
export interface HandoffState {
  phase: SessionPhase;
  since: string;
  step?: HandoffStep;
  /** 人类需要做什么（awaiting_human 时必填） */
  needs?: string;
  /** 为什么卡住 */
  blocker?: string;
  /** 人类处理完之后，恢复流程该执行的确切命令 */
  nextAction?: string;
}

/** `status` 命令输出的机器可读契约，也是 Agent 判断阶段的唯一真源。 */
export interface SessionStatus {
  agent: string;
  port: number;
  alive: boolean;
  pid?: number;
  profile: string;
  url: string;
  title: string;
  phase: SessionPhase;
  since?: string;
  elapsedInPhaseMs?: number;
  step?: HandoffStep;
  needs?: string;
  blocker?: string;
  nextAction?: string;
  auth: {
    state: AuthState;
    domain: string | null;
    verifiedDomains: string[];
    visitedDomains: string[];
    signals: string[];
  };
  lastSeen: string;
  /** 距最后一次心跳的秒数；太久说明进程可能已僵死 */
  staleSeconds: number | null;
  task: { id: string; sopName: string; status: string; heartbeatAt?: string } | null;
}

export interface AgentSessionRecord {
  agent: string;
  port: number;
  pid?: number;
  profile: string;
  url: string;
  title: string;
  targetId: string;
  wsUrl: string;
  /** 已通过探针或人工确认的登录域（可安全用于免登录复用） */
  verifiedDomains?: string[];
  /** 仅导航到过、并未确认登录的域（不可用于免登录复用） */
  visitedDomains?: string[];
  /** @deprecated 旧字段；读取时降级为 visitedDomains，写入时镜像 verifiedDomains */
  loginDomains?: string[];
  handoff?: HandoffState;
  lastSeen?: string;
  status: 'active' | 'idle' | 'closed';
  createdAt: string;
  updatedAt: string;
}

/** `await-human` 的机器可读结果 */
export interface AwaitHumanResult {
  ready: boolean;
  reason: 'authenticated' | 'timeout' | 'no_session' | 'aborted';
  waitedSeconds: number;
  auth: AuthState;
  domain: string | null;
  nextAction?: string;
}

export interface SessionState extends AgentSessionRecord {}

export interface LaunchOptions {
  headless?: boolean;
  url?: string;
  userDataDir?: string;
  profile?: string;
  port?: number;
  agent?: string;
  reuse?: boolean;
}

export interface TrajectoryAction {
  type: 'open' | 'click' | 'type' | 'scroll' | 'wait' | 'eval' | 'hover' | 'press' | 'select' | 'upload' | 'exec';
  target?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  seconds?: number;
  key?: string;
  value?: string;
  files?: string[];
  /** exec 动作：外部命令与参数。这是自研脚本进入自动沉淀的唯一入口。 */
  command?: string;
  args?: string[];
  /** exec 动作的退出码（成功为 0） */
  exitCode?: number;
  targetDescription?: string;
  timestamp: number;
}

export interface RecipeStep {
  step: number;
  action: 'open' | 'click' | 'type' | 'scroll' | 'wait' | 'hover' | 'press' | 'select' | 'upload' | 'eval' | 'exec';
  target?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  defaultText?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  seconds?: number;
  key?: string;
  value?: string;
  files?: string[];
  /** exec 步骤：要执行的命令与参数 */
  command?: string;
  args?: string[];
  description?: string;
}

export interface SOPMatch {
  urlPatterns: string[];
  intents: string[];
  domains: string[];
}

export interface SOPSchedule {
  frequency: 'manual' | 'daily' | 'weekly' | 'hourly' | string;
  cron?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
}

export interface SOPParameter {
  name: string;
  description: string;
  required: boolean;
  default?: string;
  example?: string;
}

export interface SOPChangelog {
  version: string;
  date: string;
  reason: string;
}

export interface SOP {
  name: string;
  version: string;
  description: string;
  scope?: 'global' | 'project';
  match: SOPMatch;
  schedule: SOPSchedule;
  parameters: SOPParameter[];
  stepCount: number;
  variables: string[];
  steps: RecipeStep[];
  changelog: SOPChangelog[];
  createdAt: string;
  updatedAt: string;
}

// 兼容别名
export type Recipe = SOP;
