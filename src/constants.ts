/**
 * constants.ts —— CDP 调试端口的单一真源（SSOT）
 *
 * ## 为什么不是 9222
 *
 * 9222 是 Chrome 社区默认的调试端口，也是人类自己开 `--remote-debugging-port`
 * 时的第一反应。这个端口**留给人类**：AI 会话一律不碰。
 *
 * 历史上本文件散落着三份硬编码（registry.ts / chrome.ts / actions.ts），
 * 想挪端口得改三处、漏一处就出现「注册表分配到 A、ChromeManager 落到 B」，
 * 结果是静默接管错实例而不是报错。改成单一真源后，端口只有这一个定义点。
 *
 * ## 覆盖方式
 *
 * 临时换端口不必重编译：`LITE_BROWSER_BASE_PORT=9400 lite-browser open ...`
 * 非法值会退回默认值并在 stderr 提示，不静默吞掉。
 */

/** 9222 被显式让给人类，扫描区间从它之后起 —— 这里只做断言，不做分配。 */
export const RESERVED_HUMAN_PORT = 9222;

/** AI 会话端口分配区间的起点。`default` Agent 落在这里，其余 Agent 顺延。 */
export const DEFAULT_PORT = readPort('LITE_BROWSER_BASE_PORT', 9229);

/**
 * 端口分配扫描起点。刻意与 {@link DEFAULT_PORT} 同值：
 * 不带 `--agent` 的裸调用也要落在 AI 区间内，绝不能掉回 9222 去接管人类浏览器。
 */
export const BASE_PORT = DEFAULT_PORT;

/**
 * 读一个端口号环境变量；非法或缺省时退回 fallback。
 * 端口被占用 / 配错属于「用户马上会踩」的错误，必须出声，不能静默降级。
 */
function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    console.error(`⚠️  ${name}="${raw}" 不是合法端口（需 1024-65535 的整数），已退回 ${fallback}`);
    return fallback;
  }
  if (parsed === RESERVED_HUMAN_PORT) {
    console.error(`⚠️  ${name}=${RESERVED_HUMAN_PORT} 不可用：该端口保留给人类浏览器，AI 会话不得占用。已退回 ${fallback}`);
    return fallback;
  }
  return parsed;
}
