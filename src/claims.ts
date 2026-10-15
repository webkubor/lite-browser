/**
 * claims.ts —— Task Space 式的 profile 认领（移植 ego-lite 的 claim/release 语义，落在 lite-browser 会话层）。
 *
 * 一个 profile（即一个真实账号的 Chrome 目录）同一时刻只能被一个 agent 认领：
 * - claim：认领；已被别的（未过期的）agent 持有则拒绝。
 * - release：释放；只有持有者（或 --force）能释放。
 * - takeover：用户接管。认领仍在，但 controller 切到 user，agent 的动作一律被拒绝（LB_USER_IN_CONTROL）。
 * - return：用户交还。controller 切回 agent。
 * - 心跳：持有者每次连接会话时刷新 heartbeatAt；超过 STALE_MS 没有心跳的认领视为过期，可被抢占。
 *
 * 存储：$STATE_ROOT/claims.json，key 为 profile 键（如 chrome:Profile 5）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { statePath } from './paths.js';

export const STALE_MS = 30 * 60 * 1000;

export type Controller = 'agent' | 'user';

export interface Claim {
  key: string;
  owner: string;
  controller: Controller;
  claimedAt: string;
  heartbeatAt: string;
  /** 认领时的说明（例如账号邮箱打码），便于 claims 列表阅读 */
  label?: string;
}

const CLAIMS_FILE = () => statePath('claims.json');

function readAll(): Record<string, Claim> {
  const file = CLAIMS_FILE();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Claim>): void {
  const file = CLAIMS_FILE();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, file); // 原子替换，避免两个 CLI 同时写坏文件
}

const isStale = (c: Claim, now = Date.now()) => now - Date.parse(c.heartbeatAt) > STALE_MS;

/** 当前有效的认领（过期的视为不存在）。 */
export function getClaim(key: string): Claim | undefined {
  const c = readAll()[key];
  return c && !isStale(c) ? c : undefined;
}

export function listClaims(): Array<Claim & { stale: boolean }> {
  return Object.values(readAll()).map((c) => ({ ...c, stale: isStale(c) }));
}

export function claimProfile(key: string, agent: string, label?: string): Claim {
  const all = readAll();
  const cur = all[key];
  if (cur && !isStale(cur) && cur.owner !== agent) {
    throw new Error(
      `LB_PROFILE_CLAIMED: ${key} 已被 agent「${cur.owner}」认领（controller=${cur.controller}，心跳 ${cur.heartbeatAt}）。` +
        `先让它 release，或由你执行 lite-browser release ${key} --force。`,
    );
  }
  const now = new Date().toISOString();
  const claim: Claim = {
    key,
    owner: agent,
    controller: cur && cur.owner === agent ? cur.controller : 'agent',
    claimedAt: cur && cur.owner === agent ? cur.claimedAt : now,
    heartbeatAt: now,
    label: label ?? cur?.label,
  };
  all[key] = claim;
  writeAll(all);
  return claim;
}

export function releaseProfile(key: string, agent: string, force = false): boolean {
  const all = readAll();
  const cur = all[key];
  if (!cur) return false;
  if (!force && cur.owner !== agent && !isStale(cur)) {
    throw new Error(`LB_PROFILE_CLAIMED: ${key} 由「${cur.owner}」持有，你不能释放。若确需释放请加 --force。`);
  }
  delete all[key];
  writeAll(all);
  return true;
}

/** 用户接管：agent 的动作从此被拒绝，直到用户 return。 */
export function takeoverProfile(key: string): Claim {
  const all = readAll();
  const cur = all[key];
  if (!cur) throw new Error(`${key} 当前没有认领，无需接管。`);
  cur.controller = 'user';
  cur.heartbeatAt = new Date().toISOString();
  writeAll(all);
  return cur;
}

export function returnProfile(key: string): Claim {
  const all = readAll();
  const cur = all[key];
  if (!cur) throw new Error(`${key} 当前没有认领。`);
  cur.controller = 'agent';
  cur.heartbeatAt = new Date().toISOString();
  writeAll(all);
  return cur;
}

/** 动作前的守卫：认领存在且归别人、或者用户正在控制，都拒绝；否则刷新心跳。 */
export function assertCanAct(key: string, agent: string): void {
  const cur = readAll()[key];
  if (!cur || isStale(cur)) return;
  if (cur.owner !== agent) {
    throw new Error(`LB_PROFILE_CLAIMED: ${key} 由「${cur.owner}」认领，「${agent}」不能操作。`);
  }
  if (cur.controller === 'user') {
    throw new Error(`LB_USER_IN_CONTROL: ${key} 正由你接管中，agent 暂停操作。你交还后（lite-browser return ${key}）才会继续。`);
  }
  touchHeartbeat(key);
}

export function touchHeartbeat(key: string): void {
  const all = readAll();
  if (!all[key]) return;
  all[key].heartbeatAt = new Date().toISOString();
  writeAll(all);
}
