/**
 * runner.ts —— SOP 步骤的统一执行器
 *
 * 此前 `sop run`（cli.ts）、后台 worker（task.ts）、MCP 的 sop_run（mcp.ts）各自
 * 复制了一份一模一样的步骤分发 switch。加一种动作就要改三处，改漏一处的表现是
 * 「同一个 SOP 在委派时能跑、手动跑就挂」这种最难查的 bug。这里收敛成一份。
 */

import { spawn } from 'node:child_process';
import type { BrowserActions } from './actions.js';
import type { RecipeStep, SOP } from './types.js';

export interface StepExecutionHooks {
  /** 每一步开始前调用，用于播报进度 / 刷新心跳 */
  onStep?: (step: RecipeStep, index: number, total: number) => void | Promise<void>;
  /** 每一步之后调用，用于交接检查点（例如检测登录墙） */
  afterStep?: (step: RecipeStep, index: number, total: number) => Promise<void> | void;
}

export interface StepExecutionOptions extends StepExecutionHooks {
  vars?: Record<string, string>;
  /** 只打印将要执行的步骤，不真正执行（用于审查含 exec 的 SOP） */
  dryRun?: boolean;
  /** exec 步骤的工作目录 */
  cwd?: string;
}

export function interpolateVars(text: string, vars: Record<string, string> = {}): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

/**
 * 执行一个 exec 步骤。
 *
 * 这是自研脚本进入自动沉淀的唯一入口：脚本通过这里被调用，动作才会进入轨迹，
 * 之后 `lite-browser done` 才能把它沉淀成 SOP。脚本自己直连 CDP 是记录不到的。
 */
export async function runExecStep(step: RecipeStep, vars: Record<string, string> = {}, cwd?: string): Promise<void> {
  const command = interpolateVars(step.command || '', vars);
  const args = (step.args || []).map((a) => interpolateVars(String(a), vars));
  if (!command) {
    throw new Error(`exec 步骤缺少 command（step ${step.step}）`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd, shell: false });
    child.on('error', (err) => reject(new Error(`exec 步骤启动失败: ${command} —— ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exec 步骤失败 (exit ${code}): ${[command, ...args].join(' ')}`));
    });
  });
}

/**
 * 按顺序执行 SOP 的全部步骤。
 *
 * browser 可以缺省：只含 exec 步骤的 SOP 不需要浏览器会话。
 */
export async function executeSteps(
  rec: Pick<SOP, 'steps' | 'stepCount'>,
  browser: BrowserActions | null,
  options: StepExecutionOptions = {}
): Promise<void> {
  const vars = options.vars || {};
  const total = rec.stepCount || rec.steps.length;

  for (const step of rec.steps) {
    await options.onStep?.(step, step.step, total);

    if (options.dryRun) {
      console.log(`  [dry-run] [${step.step}/${total}] ${step.description || step.action}`);
    } else if (step.action === 'exec') {
      await runExecStep(step, vars, options.cwd);
    } else if (step.action === 'open' && step.url) {
      await requireBrowser(browser).open(step.url);
    } else if (step.action === 'click' && step.target) {
      await requireBrowser(browser).click(step.target);
    } else if (step.action === 'type' && step.target) {
      const text = interpolateVars(step.text || step.defaultText || '', vars);
      await requireBrowser(browser).type(step.target, text);
    } else if (step.action === 'hover' && step.target) {
      await requireBrowser(browser).hover(step.target);
    } else if (step.action === 'press' && step.key) {
      await requireBrowser(browser).press(step.key);
    } else if (step.action === 'select' && step.target && step.value) {
      await requireBrowser(browser).select(step.target, step.value);
    } else if (step.action === 'upload' && step.target && step.files) {
      await requireBrowser(browser).upload(step.target, step.files);
    } else if (step.action === 'scroll') {
      await requireBrowser(browser).scroll(step.direction, step.amount);
    } else if (step.action === 'wait') {
      if (browser) await browser.wait(step.seconds || 1);
      else await new Promise((r) => setTimeout(r, (step.seconds || 1) * 1000));
    } else if (step.action === 'eval') {
      if (step.text) await requireBrowser(browser).eval(step.text);
    }

    await options.afterStep?.(step, step.step, total);
  }
}

/** SOP 里是否含需要浏览器的步骤 —— 只含 exec 的 SOP 可以在无浏览器下运行 */
export function needsBrowser(rec: Pick<SOP, 'steps'>): boolean {
  return rec.steps.some((s) => s.action !== 'exec');
}

function requireBrowser(browser: BrowserActions | null): BrowserActions {
  if (!browser) {
    throw new Error('该 SOP 含浏览器步骤，但没有可用的浏览器会话。请先执行 `lite-browser open <url>`。');
  }
  return browser;
}
