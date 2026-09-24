/**
 * task.ts —— 任务委派、后台异步执行与调度审计引擎
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';

export const TASKS_DIR = join(homedir(), '.lite-browser', 'tasks');
export const TASK_LOGS_DIR = join(TASKS_DIR, 'logs');
const TASKS_FILE = join(TASKS_DIR, 'index.json');

export interface DelegatedTask {
  id: string;
  sopName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  variables?: Record<string, string>;
  headless?: boolean;
  pid?: number;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  error?: string;
  logFile: string;
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
   */
  delegate(sopName: string, options: { variables?: Record<string, string>; headless?: boolean } = {}): DelegatedTask {
    this.ensureDirs();
    const recipeEngine = new RecipeEngine();
    // 校验 SOP 是否存在
    recipeEngine.getRecipe(sopName);

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const logFile = join(TASK_LOGS_DIR, `${id}.log`);
    const vars = options.variables || {};
    const headless = options.headless ?? true;

    const task: DelegatedTask = {
      id,
      sopName,
      status: 'pending',
      variables: vars,
      headless,
      startTime: new Date().toISOString(),
      logFile,
    };
    this.saveTask(task);

    // 获取当前执行 cli 路径
    const cliPath = process.argv[1];
    const logFd = openSync(logFile, 'a');

    const workerArgs = [
      cliPath,
      '_task_worker',
      id,
      sopName,
      JSON.stringify(vars),
    ];
    if (headless) workerArgs.push('--headless');

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, LITE_BROWSER_TASK_ID: id },
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
    this.saveTask(task);

    const startTime = Date.now();
    const recipeEngine = new RecipeEngine();

    console.log(`[Worker] 开始执行委派任务 ${id} (SOP: ${sopName}, headless: ${headless})...`);

    try {
      const rec = recipeEngine.getRecipe(sopName);
      const browser = await BrowserActions.launchOrConnect({ headless });

      for (const step of rec.steps) {
        console.log(`[Worker] [${step.step}/${rec.stepCount}] ${step.description || step.action}...`);
        if (step.action === 'open' && step.url) {
          await browser.open(step.url);
        } else if (step.action === 'click' && step.target) {
          await browser.click(step.target);
        } else if (step.action === 'type' && step.target) {
          let textToType = step.text || step.defaultText || '';
          for (const [k, v] of Object.entries(vars)) {
            textToType = textToType.replaceAll(`{{${k}}}`, v);
          }
          await browser.type(step.target, textToType);
        } else if (step.action === 'hover' && step.target) {
          await browser.hover(step.target);
        } else if (step.action === 'press' && step.key) {
          await browser.press(step.key);
        } else if (step.action === 'select' && step.target && step.value) {
          await browser.select(step.target, step.value);
        } else if (step.action === 'upload' && step.target && step.files) {
          await browser.upload(step.target, step.files);
        } else if (step.action === 'scroll') {
          await browser.scroll(step.direction, step.amount);
        } else if (step.action === 'wait') {
          await browser.wait(step.seconds || 1);
        }
      }

      recipeEngine.recordRun(sopName, true);
      const durationMs = Date.now() - startTime;
      task.status = 'completed';
      task.endTime = new Date().toISOString();
      task.durationMs = durationMs;
      this.saveTask(task);

      console.log(`[Worker] ✅ 委派任务 ${id} 执行成功，耗时 ${durationMs}ms`);
    } catch (err: any) {
      recipeEngine.recordRun(sopName, false);
      const durationMs = Date.now() - startTime;
      task.status = 'failed';
      task.endTime = new Date().toISOString();
      task.durationMs = durationMs;
      task.error = err.message || String(err);
      this.saveTask(task);

      console.error(`[Worker] ❌ 委派任务 ${id} 执行失败:`, err.message);
      throw err;
    }
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
