/**
 * 测试全局前置：把 lite-browser 的状态根目录指向一个临时目录。
 *
 * 必须在任何 src 模块被导入前生效 —— `STATE_ROOT` 是模块级常量，
 * 而 test/*.test.ts 是静态导入的，所以只能靠 bunfig.toml 的 preload。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandbox = mkdtempSync(join(tmpdir(), 'lite-browser-test-'));

if (!process.env.LITE_BROWSER_HOME) {
  process.env.LITE_BROWSER_HOME = sandbox;
  process.on('exit', () => {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
  });
}

// 兜底断言：任何测试都不该把真实 home 当作状态根
const realHome = join(process.env.HOME || '', '.lite-browser');
if (process.env.LITE_BROWSER_HOME === realHome) {
  throw new Error('测试拒绝在真实 ~/.lite-browser 上运行：LITE_BROWSER_HOME 未隔离');
}
