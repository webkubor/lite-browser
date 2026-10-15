/**
 * fingerprint.ts —— 可定制 / 可随机的浏览器指纹（给 Agent 用）。
 *
 * 覆盖项：时区、语言、User-Agent、视口与 DPR、CPU 核数、内存。
 * - 时区 / 语言 / UA / 视口 走 CDP Emulation（连接级，每次连接重新应用）。
 * - 核数 / 内存 走 Page.addScriptToEvaluateOnNewDocument（同样是连接级）。
 * - 启动新 Chrome 时额外传 TZ 环境变量、--lang、--user-agent、--window-size，让进程本身也一致。
 *
 * 随机指纹是**可复现**的：同一个 seed 永远得到同一组值，seed 会写进会话记录，Agent 可以再次使用。
 */
import type { CdpClient } from './cdp';

export interface FingerprintProfile {
  timezone?: string;
  locale?: string;
  userAgent?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  /** 随机指纹的种子；只要 seed 相同，生成的值就相同。 */
  seed?: number;
}

const TIMEZONES = [
  'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London',
  'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney',
];
const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'zh-CN', 'es-ES'];
const VIEWPORTS: Array<[number, number]> = [[1440, 900], [1536, 864], [1920, 1080], [1366, 768], [1280, 800]];
const DPRS = [1, 2];
const CORES = [4, 8, 10, 12];
const MEMORY = [4, 8, 16];
/** 与本机 Chrome（155.0.8059）一致的 macOS UA，避免随机出一个和平台不符的 UA。 */
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

/** mulberry32：固定种子下输出稳定的伪随机数。 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];

/** 按种子生成一组随机指纹；未指定 seed 时随机取一个并记录下来。 */
export function randomFingerprint(seed: number = Math.floor(Math.random() * 2 ** 31)): FingerprintProfile {
  const rnd = prng(seed);
  const [width, height] = pick(rnd, VIEWPORTS);
  return {
    seed,
    timezone: pick(rnd, TIMEZONES),
    locale: pick(rnd, LOCALES),
    userAgent: MAC_UA,
    width,
    height,
    deviceScaleFactor: pick(rnd, DPRS),
    hardwareConcurrency: pick(rnd, CORES),
    deviceMemory: pick(rnd, MEMORY),
  };
}

/**
 * 解析 open 命令的指纹参数。
 * --random-fingerprint [--seed N] 先生成随机基线，之后的显式参数逐项覆盖基线。
 * 没有任何指纹参数时返回 undefined（保持原有行为）。
 */
export function parseFingerprintFlags(args: string[]): FingerprintProfile | undefined {
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
  };
  const random = args.includes('--random-fingerprint');
  const seedRaw = value('--seed');
  const explicit: FingerprintProfile = {};
  const tz = value('--timezone');
  const locale = value('--locale');
  const ua = value('--user-agent');
  const viewport = value('--viewport');
  const dpr = value('--dpr');
  const cores = value('--cores');
  const memory = value('--memory');
  if (tz) explicit.timezone = tz;
  if (locale) explicit.locale = locale;
  if (ua) explicit.userAgent = ua;
  if (viewport) {
    const m = viewport.match(/^(\d+)x(\d+)$/i);
    if (!m) throw new Error(`--viewport 格式应为 WxH，例如 1440x900，收到: ${viewport}`);
    explicit.width = Number(m[1]);
    explicit.height = Number(m[2]);
  }
  if (dpr) explicit.deviceScaleFactor = Number(dpr);
  if (cores) explicit.hardwareConcurrency = Number(cores);
  if (memory) explicit.deviceMemory = Number(memory);

  if (!random && Object.keys(explicit).length === 0 && seedRaw === undefined) return undefined;
  const base = random || seedRaw !== undefined ? randomFingerprint(seedRaw !== undefined ? Number(seedRaw) : undefined) : {};
  return { ...base, ...explicit };
}

/** 页面里覆盖 navigator.hardwareConcurrency / deviceMemory（CDP 没有直接的 Emulation 方法）。 */
export function fingerprintInitScript(p: FingerprintProfile): string | undefined {
  if (p.hardwareConcurrency === undefined && p.deviceMemory === undefined) return undefined;
  return `(() => {
    const def = (prop, value) => { try { Object.defineProperty(Navigator.prototype, prop, { get: () => value, configurable: true }) } catch (_) {} };
    ${p.hardwareConcurrency !== undefined ? `def('hardwareConcurrency', ${p.hardwareConcurrency});` : ''}
    ${p.deviceMemory !== undefined ? `def('deviceMemory', ${p.deviceMemory});` : ''}
  })();`;
}

/** 在一个 CDP 连接上应用指纹。每次连接都要调一次（覆盖随连接断开而失效）。 */
export async function applyFingerprint(client: CdpClient, p: FingerprintProfile): Promise<void> {
  await client.send('Page.enable').catch(() => {});
  if (p.timezone) await client.send('Emulation.setTimezoneOverride', { timezoneId: p.timezone }).catch(() => {});
  if (p.locale) await client.send('Emulation.setLocaleOverride', { locale: p.locale }).catch(() => {});
  if (p.userAgent) {
    await client
      .send('Emulation.setUserAgentOverride', {
        userAgent: p.userAgent,
        ...(p.locale ? { acceptLanguage: `${p.locale},en;q=0.8` } : {}),
      })
      .catch(() => {});
  }
  if (p.width && p.height) {
    await client
      .send('Emulation.setDeviceMetricsOverride', {
        width: p.width,
        height: p.height,
        deviceScaleFactor: p.deviceScaleFactor ?? 1,
        mobile: false,
      })
      .catch(() => {});
  }
  const script = fingerprintInitScript(p);
  if (script) await client.send('Page.addScriptToEvaluateOnNewDocument', { source: script }).catch(() => {});
}

/** 启动新 Chrome 时的命令行与环境变量，让进程级设置与连接级覆盖保持一致。 */
export function fingerprintLaunchArgs(p: FingerprintProfile): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};
  if (p.locale) args.push(`--lang=${p.locale}`);
  if (p.userAgent) args.push(`--user-agent=${p.userAgent}`);
  if (p.width && p.height) args.push(`--window-size=${p.width},${p.height}`);
  if (p.timezone) env.TZ = p.timezone;
  return { args, env };
}
