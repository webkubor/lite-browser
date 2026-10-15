/**
 * profiles.ts —— 把 Chrome 的 profile 目录（Default / Profile N）映射成「真实账号身份」。
 *
 * 数据来源：Chrome 的 Local State 文件（profile.info_cache），里面记着每个目录的显示名、
 * Google 账号名（gaia_name）和登录邮箱（user_name）。agent 按账号选 profile，不按 Profile N。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CHROME_USER_DATA_DIR = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');

export interface ChromeProfileIdentity {
  /** Chrome 的 profile 目录名，即 --profile-directory 的值（Default / Profile 1 …） */
  dir: string;
  /** Chrome 里显示的名字 */
  displayName: string;
  /** Google 账号显示名 */
  gaiaName: string;
  /** 登录邮箱；未登录为空 */
  email: string;
  signedIn: boolean;
}

export function listChromeProfiles(userDataDir: string = CHROME_USER_DATA_DIR): ChromeProfileIdentity[] {
  const localState = join(userDataDir, 'Local State');
  if (!existsSync(localState)) return [];
  const json = JSON.parse(readFileSync(localState, 'utf8'));
  const cache: Record<string, any> = json?.profile?.info_cache ?? {};
  return Object.entries(cache).map(([dir, info]) => ({
    dir,
    displayName: String(info?.name ?? ''),
    gaiaName: String(info?.gaia_name ?? ''),
    email: String(info?.user_name ?? ''),
    signedIn: Boolean(info?.user_name || info?.gaia_id),
  }));
}

/** 邮箱打码：保留首尾各一位与域名，便于人看又不整屏暴露。 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}***${tail}${email.slice(at)}`;
}

/**
 * 按账号查找 profile：可以是完整邮箱、邮箱前缀、显示名或 Google 账号名（不区分大小写）。
 * 唯一命中返回该 profile；0 个或多个命中都抛错，并列出候选，避免误选。
 */
export function findProfileByAccount(query: string, userDataDir?: string): ChromeProfileIdentity {
  const q = query.trim().toLowerCase();
  const all = listChromeProfiles(userDataDir);
  const hits = all.filter((p) => {
    const localPart = p.email.split('@')[0]?.toLowerCase() ?? '';
    return p.email.toLowerCase() === q || localPart === q || p.displayName.toLowerCase() === q || p.gaiaName.toLowerCase() === q;
  });
  if (hits.length === 1) return hits[0];
  const listing = all.map((p) => `  ${p.dir.padEnd(10)} ${p.displayName || '-'} / ${p.gaiaName || '-'} / ${maskEmail(p.email) || '未登录'}`).join('\n');
  if (hits.length === 0) throw new Error(`没有找到账号 "${query}"。当前 Chrome 的 profile：\n${listing}`);
  throw new Error(`账号 "${query}" 匹配到多个 profile，请用完整邮箱指定：\n${listing}`);
}
