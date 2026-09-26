/**
 * task.ts —— 任务委派、后台异步执行与调度审计引擎
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { renderHandoffCard } from './handoff.js';
import { executeSteps, needsBrowser } from './runner.js';
import { STATE_ROOT } from './paths.js';

export const TASKS_DIR = join(STATE_ROOT, 'tasks');
export const TASK_LOGS_DIR = join(TASKS_DIR, 'logs');
const TASKS_FILE = join(TASKS_DIR, 'index.json');

/**
 * 重新拉起自己时，是否需要显式补一个「入口脚本」参数。
 *
 * bun run 下 process.argv[1] 是真入口（.ts 文件），必须补，否则 argv 少一位；
 * 编译成单文件二进制后 process.argv[1] 是 bunfs 虚拟路径 /$bunfs/root/<name>，
 * 它既不是真实文件也没法当参数——补进去会让程序多收一个位置参数，
 * worker 直接把 USAGE 吐进日志（delegate 派发的任务明明跑了却什么都没做）。
 */
export function selfEntryArgs(argv: string[] = process.argv, execPath: string = process.execPath): string[] {
  const standalone = typeof Bun !== 'undefined' && (Bun as any).isStandaloneExecutable === true;
  if (standalone) return [];
  const entry = argv[1];
  if (!entry) return [];
  // 兜底：万一某个 Bun 版本没有 isStandaloneExecutable，bunfs 前缀同样能识别
  if (entry.startsWith('/$bunfs/') || entry === execPath) return [];
  return [entry];
}

export interface DelegatedTask {
  id: string;
  sopName: string;
  /**
   * awaiting_human 是刻意独立于 failed 的一档：卡在等人类扫码时任务并没有失败，
   * 过去只有 running/failed 两种表达，于是「在等你」被显示成「正在运行」，
   * 人根本不知道要去做点什么。
   */
  status: 'pending' | 'running' | 'awaiting_human' | 'completed' | 'failed';
  variables?: Record<string, string>;
  headless?: boolean;
  pid?: number;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  error?: string;
  logFile: string;
  /** 该任务归属的 Agent 身份，用于多 Agent 并存时对齐会话相位 */
  agent?: string;
  port?: number;
  profile?: string;
  /** 当前步骤进度，用于回答「跑到哪了」 */
  step?: number;
  stepTotal?: number;
  stepLabel?: string;
  /** 每次心跳刷新，用于区分「在跑」和「僵死」 */
  heartbeatAt?: string;
  /** 需要人类做什么（awaiting_human 时必填） */
  needs?: string;
  nextAction?: string;
}

export class TaskEngine {
  constructor() {
    this.ensureDirs();
  }

  ensureDirs(): void {
    if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });
    if (!existsSync(TASK_LOGS_DIR)) mkdirSync(TASK_LOGS_DIR, { recursive: true });
    if (!existsSync(TASKS_FILE)) writeFileSync(TASKS_FILE, JSON.stringify([]));
  }

  getAllTasks(): DelegatedTask[] {
    this.ensureDirs();
    try {
      return JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
    } catch (_) {
      return [];
    }
  }

  getTask(id: string): DelegatedTask | null {
    const tasks = this.getAllTasks();
    return tasks.find((t) => t.id === id) || null;
  }

  saveTask(task: DelegatedTask): void {
    const tasks = this.getAllTasks();
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.unshift(task);
    }
    // 只保留最近 100 条任务历史
    const trimmed = tasks.slice(0, 100);
    writeFileSync(TASKS_FILE, JSON.stringify(trimmed, null, 2));
  }

  /**
   * 启动后台委派任务（脱机运行）
   *
   * agent / port / profile 必须透传给 worker：worker 是独立进程，靠进程内的
   * explicitAgent 传不过去。不传的后果是 worker 一律以 `default` 身份、用默认
   * profile 启动 —— 多 Agent 并存时直接和别人的浏览器抢同一个 profile 目录而启动失败，
   * 而且任务在注册表里挂到了错误的名下。
   */
  delegate(
    sopName: string,
    options: { variables?: Record<string, string>; headless?: boolean; agent?: string; port?: number; profile?: string } = {}
  ): DelegatedTask {
    this.ensureDirs();
    const recipeEngine = new RecipeEngine();
    // 校验 SOP 是否存在
    recipeEngine.getRecipe(sopName);

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const logFile = join(TASK_LOGS_DIR, `${id}.log`);
    const vars = options.variables || {};
    const headless = options.headless ?? true;
    const agent = options.agent || process.env.LITE_BROWSER_AGENT || 'default';

    const task: DelegatedTask = {
      id,
      sopName,
      status: 'pending',
      variables: vars,
      headless,
      agent,
      port: options.port,
      profile: options.profile,
      startTime: new Date().toISOString(),
      logFile,
    };
    this.saveTask(task);

    const logFd = openSync(logFile, 'a');

    const workerArgs = [
      ...selfEntryArgs(),
      '_task_worker',
      id,
      sopName,
      JSON.stringify(vars),
    ];
    if (headless) workerArgs.push('--headless');

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        LITE_BROWSER_TASK_ID: id,
        LITE_BROWSER_AGENT: agent,
        ...(options.port ? { LITE_BROWSER_PORT: String(options.port) } : {}),
        ...(options.profile ? { LITE_BROWSER_PROFILE: options.profile } : {}),
      },
    });

    task.pid = child.pid;
    task.status = 'running';
    this.saveTask(task);

    child.unref();
    return task;
  }

  /**
   * Worker 内部执行函数
   */
  async runWorker(id: string, sopName: string, vars: Record<string, string>, headless = true): Promise<void> {
    const task = this.getTask(id) || {
      id,
      sopName,
      status: 'running',
      variables: vars,
      headless,
      startTime: new Date().toISOString(),
      logFile: join(TASK_LOGS_DIR, `${id}.log`),
    };

    task.status = 'running';
    task.heartbeatAt = new Date().toISOString();
    this.saveTask(task);

    const startTime = Date.now();
    const recipeEngine = new RecipeEngine();
    const awaitHumanSeconds = parseInt(process.env.LITE_BROWSER_AWAIT_HUMAN || '600', 10);

    console.log(`[Worker] 开始执行委派任务 ${id} (SOP: ${sopName}, headless: ${headless})...`);

    try {
      const rec = recipeEngine.getRecipe(sopName);
      // worker 是独立进程，身份/端口/profile 只能从环境变量取回
      const workerPort = process.env.LITE_BROWSER_PORT ? parseInt(process.env.LITE_BROWSER_PORT, 10) : undefined;
      // 只含 exec 步骤的 SOP 不需要浏览器；避免为一条命令白起一个浏览器
      const browser = needsBrowser(rec)
        ? await BrowserActions.launchOrConnect({
            headless,
            agent: process.env.LITE_BROWSER_AGENT,
            port: workerPort,
            profile: process.env.LITE_BROWSER_PROFILE,
          })
        : null;

      await executeSteps(rec, browser, {
        vars,
        onStep: (step, index, total) => {
          task.step = index;
          task.stepTotal = total;
          task.stepLabel = step.description || step.action;
          task.heartbeatAt = new Date().toISOString();
          this.saveTask(task);
          console.log(`[Worker] [${index}/${total}] ${step.description || step.action}...`);
        },
        // 每步之后判定登录墙：撞上就进入交接态并原地等待人类，
        // 而不是继续盲跑把错误抛到几步之后，让人完全看不懂。
        afterStep: async () => {
          if (browser) await this.awaitHumanIfNeeded(task, browser, awaitHumanSeconds);
        },
      });

      recipeEngine.recordRun(sopName, true);
      const durationMs = Date.now() - startTime;
      task.status = 'completed';
      task.needs = undefined;
      task.nextAction = undefined;
      task.endTime = new Date().toISOString();
      task.durationMs = durationMs;
      this.saveTask(task);

      console.log(`[Worker] ✅ 委派任务 ${id} 执行成功，耗时 ${durationMs}ms`);
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      // 等待人类超时不是执行失败：SOP 本身没报错，只是人还没来。
      // 把它标成 failed 会让「需要你」这件事被误报为「跑挂了」。
      if (err instanceof AwaitingHumanTimeoutError) {
        task.status = 'awaiting_human';
        task.durationMs = durationMs;
        task.endTime = undefined;
        task.heartbeatAt = new Date().toISOString();
        this.saveTask(task);
        console.error(`[Worker] ⏸  任务 ${id} 仍在等待人类介入，未标记失败。`);
        throw err;
      }

      recipeEngine.recordRun(sopName, false);
      task.status = 'failed';
      task.endTime = new Date().toISOString();
      task.durationMs = durationMs;
      task.error = err.message || String(err);
      this.saveTask(task);

      console.error(`[Worker] ❌ 委派任务 ${id} 执行失败:`, err.message);
      throw err;
    }
  }

  /**
   * 步骤间的交接检查点。
   *
   * 命中登录墙时把任务显式转成 awaiting_human 并**原地等待人类**（默认 600s），
   * 期间持续刷新心跳。人类登录完成后自动继续，而不是让整个 SOP 从头再跑一遍。
   */
  private async awaitHumanIfNeeded(
    task: DelegatedTask,
    browser: BrowserActions,
    awaitHumanSeconds: number
  ): Promise<void> {
    let probe;
    try {
      probe = await browser.probeAuth();
    } catch (_) {
      return; // 页面正在刷新，探测失败不阻断执行
    }
    if (!probe.loginWall) return;

    const domain = probe.domain || '目标站点';
    task.status = 'awaiting_human';
    task.needs = `请在浏览器窗口中手动完成 ${domain} 的登录（扫码 / 账号密码 / 验证码均可），完成后不要关闭窗口`;
    task.nextAction = `lite-browser await-human --timeout ${awaitHumanSeconds}`;
    task.heartbeatAt = new Date().toISOString();
    this.saveTask(task);

    console.log('');
    console.log(
      renderHandoffCard({
        agent: process.env.LITE_BROWSER_AGENT || 'default',
        port: 0,
        alive: true,
        profile: '',
        url: '',
        title: `委派任务 ${task.id}`,
        phase: 'awaiting_human',
        since: new Date().toISOString(),
        step:
          task.step && task.stepTotal
            ? { index: task.step, total: task.stepTotal, label: task.stepLabel || '' }
            : undefined,
        needs: task.needs,
        blocker: `页面呈现登录墙（证据: ${probe.signals.join(', ') || '未知'}）`,
        nextAction: `自动等待中，最长 ${awaitHumanSeconds} 秒；也可执行 lite-browser resume 手动恢复`,
        auth: {
          state: probe.state,
          domain: probe.domain,
          verifiedDomains: [],
          visitedDomains: [],
          signals: probe.signals,
        },
        lastSeen: new Date().toISOString(),
        staleSeconds: 0,
        task: { id: task.id, sopName: task.sopName, status: 'awaiting_human' },
      })
    );
    console.log('');

    const res = await browser.awaitHuman(awaitHumanSeconds, 3, (elapsed) => {
      task.heartbeatAt = new Date().toISOString();
      this.saveTask(task);
      if (elapsed > 0 && elapsed % 30 === 0) {
        console.log(`[Worker] 仍在等待人类完成 ${domain} 登录... 已等待 ${elapsed}s`);
      }
    });

    if (res.ready) {
      task.status = 'running';
      task.needs = undefined;
      task.nextAction = undefined;
      task.heartbeatAt = new Date().toISOString();
      this.saveTask(task);
      console.log(`✅ [Worker] 已检测到 ${domain} 登录完成（等待 ${res.waitedSeconds}s），任务 ${task.id} 继续执行`);
      return;
    }

    task.heartbeatAt = new Date().toISOString();
    task.nextAction = `lite-browser task retry ${task.id}`;
    task.error = `等待人类登录超时（${res.waitedSeconds}s）`;
    this.saveTask(task);
    console.log(`⚠️  [Worker] 等待人类登录超时（${res.waitedSeconds}s）。任务保持 awaiting_human，未标记失败。`);
    console.log(`    登录完成后可执行: lite-browser task retry ${task.id} 重新从头执行该 SOP`);
    throw new AwaitingHumanTimeoutError(task.id, domain, res.waitedSeconds);
  }

  /**
   * 人工完成安全介入后，用同样的参数重新委派一次该 SOP。
   * 明确不假装「从中断处续跑」——SOP 是有序步骤，从头重放才是可预期语义。
   */
  retry(id: string): DelegatedTask {
    const old = this.getTask(id);
    if (!old) {
      throw new Error(`未找到任务 ${id}，可用 \`lite-browser task list\` 查看全部任务。`);
    }
    return this.delegate(old.sopName, {
      variables: old.variables,
      headless: old.headless,
      agent: old.agent,
      port: old.port,
      profile: old.profile,
    });
  }

  getTaskLogs(id: string, tailLines = 100): string {
    const task = this.getTask(id);
    const logFile = task ? task.logFile : join(TASK_LOGS_DIR, `${id}.log`);
    if (!existsSync(logFile)) {
      return `未找到任务 ${id} 的日志文件: ${logFile}`;
    }
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(-tailLines).join('\n');
  }
}

/** 等待人类介入超时。区别于执行失败：任务未被标记为 failed。 */
export class AwaitingHumanTimeoutError extends Error {
  constructor(
    public taskId: string,
    public domain: string,
    public waitedSeconds: number
  ) {
    super(`任务 ${taskId} 等待人类完成 ${domain} 登录超时（${waitedSeconds}s）`);
    this.name = 'AwaitingHumanTimeoutError';
  }
}
