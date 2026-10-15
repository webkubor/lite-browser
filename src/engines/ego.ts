/**
 * engines/ego.ts —— lite-browser 的 ego-browser 引擎适配层。
 *
 * 编排在 lite-browser 这边：认领（claim）、指纹、账号选择都是 lite-browser 的概念；
 * 页面操作交给 ego-browser（它自己的 Task Space / Page / Snapshot API）。
 *
 * 认领键统一为 `ego:<space>`，与 chrome:<profile> 走同一套 claims 存储，
 * 所以 `lite-browser claims` / `takeover` / `release` 对两种引擎都生效。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { statePath } from '../paths.js';
import { assertCanAct, claimProfile } from '../claims.js';

export interface EgoTarget {
  space: string;
  page: string;
}

interface EgoState extends EgoTarget {
  url?: string;
}

const STATE_FILE = () => statePath('ego-state.json');

export const egoClaimKey = (space: string) => `ego:${space}`;

function egoBin(): string {
  return process.env.LITE_BROWSER_EGO || 'ego-browser';
}

function readState(): EgoState {
  if (!existsSync(STATE_FILE())) return { space: 'default', page: 'p1' };
  try {
    return JSON.parse(readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return { space: 'default', page: 'p1' };
  }
}

function writeState(s: EgoState): void {
  mkdirSync(dirname(STATE_FILE()), { recursive: true });
  writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2));
}

/** 执行一段 ego-browser 脚本（Node 运行时），返回 stdout；失败抛错并带上 stderr。 */
function runEgo(script: string): string {
  const res = spawnSync(egoBin(), ['nodejs', '-e', script], { encoding: 'utf8', timeout: 180_000 });
  if (res.error) throw new Error(`无法执行 ${egoBin()}：${res.error.message}。请确认 ego lite 已安装并完成引导。`);
  if (res.status !== 0) throw new Error(`ego-browser 执行失败（退出码 ${res.status}）：${(res.stderr || res.stdout).trim()}`);
  // ego-browser 把脚本的 console 输出写到 stderr（stdout 留给 CLI 自身），这里两路都收下。
  return `${res.stdout || ''}${res.stderr || ''}`.replace(/\n+$/, '');
}

const q = (v: string) => JSON.stringify(v);

/** 解析本次命令的目标：显式参数优先，否则沿用上次的 space/page。 */
export function resolveEgoTarget(space?: string, page?: string): EgoTarget {
  const last = readState();
  return { space: space ?? last.space, page: page ?? last.page };
}

/** 打开（或在已有 space 里新建 page 并导航），保存为当前目标，返回快照文本。 */
export function egoOpen(agent: string, target: EgoTarget, url: string): string {
  assertCanAct(egoClaimKey(target.space), agent);
  claimProfile(egoClaimKey(target.space), agent);
  const out = runEgo(`
    const task = await taskSpace(${q(target.space)});
    const page = task.page(${q(target.page)});
    await page.goto(${q(url)});
    console.log(JSON.stringify({ taskSpaceId: task.spaceId, page: page.label }));
    console.log(await page.snapshot());
  `);
  writeState({ ...target, url });
  return out;
}

export function egoSnapshot(agent: string, target: EgoTarget): string {
  assertCanAct(egoClaimKey(target.space), agent);
  return runEgo(`
    const task = await taskSpace(${q(target.space)});
    const page = task.page(${q(target.page)});
    console.log(await page.snapshot());
  `);
}

/** 在页面里执行浏览器侧 JS（page.evaluate），结果以 JSON 输出。 */
export function egoEval(agent: string, target: EgoTarget, code: string): string {
  assertCanAct(egoClaimKey(target.space), agent);
  return runEgo(`
    const task = await taskSpace(${q(target.space)});
    const page = task.page(${q(target.page)});
    const value = await page.evaluate(${q(code)});
    console.log(JSON.stringify(value ?? null));
  `);
}
