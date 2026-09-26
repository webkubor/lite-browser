import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseSingletonLock } from '../src/chrome.js';

/**
 * 这类缺陷的本质是「报错文案把人引向错误的排查方向」：
 * 真实原因是 user-data-dir 被一个没开调试端口的实例占着，但用户看到的是
 * 「启动 Chrome 失败」——他会去查 Chrome 装没装、端口有没有被占，全都查不出结果。
 *
 * 所以这里的断言不是在测「函数返回了字符串」，而是在钉两条判据：
 *   1. 占用者活着 → 必须点名 PID，并给出可执行的三条出路
 *   2. 占用者已死（残留锁）→ 必须闭嘴，不能把自己的锅甩给一个不存在的进程
 */
describe('diagnoseSingletonLock', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lb-lock-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLock = (target: string) => symlinkSync(target, join(dir, 'SingletonLock'));

  test('目录不存在 / 未传 → 不产生任何附加信息', () => {
    expect(diagnoseSingletonLock(undefined)).toBe('');
    expect(diagnoseSingletonLock(join(dir, 'nope'))).toBe('');
  });

  test('目录存在但没有 SingletonLock → 说明不是这个原因', () => {
    expect(diagnoseSingletonLock(dir)).toBe('');
  });

  test('锁指向活着的进程 → 点名 PID 并给出三条出路', () => {
    writeLock('MacBook-Pro-5.local-80034');
    const msg = diagnoseSingletonLock(dir, (pid) => pid === 80034);

    expect(msg).toContain('80034');
    expect(msg).toContain(dir);
    // 必须解释机制，否则用户仍然不知道为什么「端口没起来」
    expect(msg).toContain('只允许一个浏览器进程');
    expect(msg).toContain('--remote-debugging-port');
    expect(msg).toContain('kill 80034');
    expect(msg).toContain('user-data-dir');
  });

  test('锁指向已死的进程（残留锁）→ 不是本次失败的原因，必须闭嘴', () => {
    writeLock('MacBook-Pro-5.local-99999');
    expect(diagnoseSingletonLock(dir, () => false)).toBe('');
  });

  test('锁内容不是 <host>-<pid> 形态 → 不猜，保持沉默', () => {
    writeLock('garbage');
    expect(diagnoseSingletonLock(dir, () => true)).toBe('');
  });

  test('真实进程探针：当前进程必然活着，不存在的 PID 必然已死', () => {
    writeLock(`host-${process.pid}`);
    expect(diagnoseSingletonLock(dir)).toContain(String(process.pid));

    rmSync(join(dir, 'SingletonLock'));
    writeLock('host-999999');
    expect(diagnoseSingletonLock(dir)).toBe('');
  });

  test('即使锁名里含连字符也只取最后一段作为 PID', () => {
    writeLock('MacBook-Pro-5.local-1234');
    expect(diagnoseSingletonLock(dir, (pid) => pid === 1234)).toContain('1234');
  });

  test('锁是普通文件而非符号链接 → 读取失败也必须静默降级', () => {
    writeFileSync(join(dir, 'SingletonLock'), 'not-a-symlink');
    expect(diagnoseSingletonLock(dir, () => true)).toBe('');
  });

  test('dir 指向一个文件而不是目录 → 静默降级，不把启动失败变成二次崩溃', () => {
    const f = join(dir, 'afile');
    mkdirSync(dir, { recursive: true });
    writeFileSync(f, 'x');
    expect(diagnoseSingletonLock(f)).toBe('');
  });
});
