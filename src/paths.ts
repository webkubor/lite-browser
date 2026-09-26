import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 全局状态根目录的唯一真源。
 *
 * 为什么要可覆盖：原先每个模块各自写 `homedir()/.lite-browser`，导致
 * 单元测试一跑就往用户真实状态里写东西 —— `task_test_123` 会出现在用户的
 * `task list` 里，测试用的 SOP 会混进 `sop list`。测试污染真实状态不是
 * 「小瑕疵」，它让人不敢相信任何一条诊断输出。
 *
 * `LITE_BROWSER_HOME` 一改，profiles / sessions / recipes / trajectory / tasks
 * 全部跟着搬，测试即可在临时目录里跑，与真实环境完全隔离。
 */
export const STATE_ROOT = process.env.LITE_BROWSER_HOME
  ? process.env.LITE_BROWSER_HOME.replace(/\/+$/, '')
  : join(homedir(), '.lite-browser');

/** 进程级隔离用：测试里设 LITE_BROWSER_HOME 后，模块常量已在导入时定值。 */
export function statePath(...segments: string[]): string {
  return join(STATE_ROOT, ...segments);
}

export function stateHomeHint(): string {
  return process.env.LITE_BROWSER_HOME ? `$LITE_BROWSER_HOME (${STATE_ROOT})` : STATE_ROOT;
}
