/**
 * discover.ts —— 自动发现项目里已有的自动化资产
 *
 * 解决的是一个反复出现的错觉：人明明写了 Twitter / 小红书 的 SOP 和脚本，
 * `lite-browser sop list` 却只显示 `example-visit` 这种冒烟产物，于是得出结论
 * 「这工具还是 Demo 级的」。
 *
 * 原因是结构性的：lite-browser 只认 `~/.lite-browser/recipes` 与
 * `./.lite-browser/recipes` 两处索引，而真实项目里的约定是 `sop/*.md` 文档 +
 * `scripts/*.mjs` 脚本。**索引不到 ≠ 没做**。这里让工具自己去扫，而不是让人
 * 手动登记一遍。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

export interface DiscoveredAsset {
  /** 资产类型：文档型 SOP / 可执行脚本 */
  kind: 'doc' | 'script';
  name: string;
  title: string;
  path: string;
  ext: string;
  /** 推测的触发意图关键词 */
  intents: string[];
  /** 内容里出现的域名 */
  domains: string[];
  /** 建议的执行方式（脚本型才有），例如 `node scripts/x.mjs` */
  suggestion?: string;
  sizeBytes: number;
  mtime: string;
}

const DOC_DIRS = ['sop', 'docs/sop', 'docs'];
const SCRIPT_DIRS = ['scripts', 'bin'];

function walk(dir: string, depth = 0): string[] {
  if (depth > 2 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch (_) { continue; }
    if (st.isDirectory()) out.push(...walk(full, depth + 1));
    else out.push(full);
  }
  return out;
}

function domainsIn(content: string): string[] {
  const found = new Set<string>();
  const re = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(content)) !== null && guard++ < 200) {
    found.add(m[1].toLowerCase());
  }
  return Array.from(found).slice(0, 6);
}

function intentsFrom(name: string, title: string): string[] {
  const out = new Set<string>();
  const cleaned = name.replace(/[-_]/g, ' ');
  if (cleaned) out.add(cleaned);
  for (const word of title.split(/[\s，,、:：\-—/()（）]+/)) {
    const w = word.trim();
    if (w.length >= 2 && w.length <= 20) out.add(w);
  }
  return Array.from(out).slice(0, 6);
}

const RUNNERS: Record<string, string> = {
  '.mjs': 'node',
  '.js': 'node',
  '.cjs': 'node',
  '.ts': 'bun',
  '.py': 'python3',
  '.sh': 'bash',
};

/**
 * 从脚本头部注释里取一句人话当描述。
 *
 * 不能用「匹配到的第一行 # 注释」了事 —— 脚本第一行是 `#!/usr/bin/env node`，
 * 于是列表里每个脚本的描述都成了 shebang，等于没描述。
 *
 * 分两档：文档字符串 / 块注释（三引号或斜杠星号）通常是作者写的正经说明，
 * 排在单行注释之前；同为第一档时优先中文（license 头多半是英文套话）。
 */
export function describeScript(content: string, fallback: string): string {
  const lines = content.split('\n').slice(0, 60);
  const block: string[] = [];
  const inline: string[] = [];
  let fence: string | null = null;

  const clean = (s: string) => s
    .replace(/\*\/\s*$/, '')
    .replace(/^["'\s*]+|["'\s*]+$/g, '')
    .trim();
  const push = (arr: string[], s: string) => {
    const c = clean(s);
    if (c.length >= 4) arr.push(c);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (fence) {
      // 块内：先看有没有结束符（可能与正文同一行）
      const end = line.indexOf(fence);
      if (end >= 0) {
        push(block, line.slice(0, end));
        fence = null;
      } else {
        push(block, line);
      }
      continue;
    }
    if (!line) continue;
    if (line.startsWith('#!')) continue; // shebang 永远不是描述
    if (line.startsWith('//')) { push(inline, line.slice(2)); continue; }
    if (line.startsWith('#')) { push(inline, line.slice(1)); continue; }

    const open = line.startsWith('/*') ? '*/'
      : line.startsWith('"""') ? '"""'
      : line.startsWith("'''") ? "'''"
      : null;
    if (!open) continue; // 不在块内时，'*' 开头多半是 shell case 分支或解引用，不是注释
    const body = line.slice(open === '*/' ? 2 : 3);
    const end = body.indexOf(open);
    if (end >= 0) push(block, body.slice(0, end)); // 单行块/单行 docstring
    else { push(block, body); fence = open; }
  }

  for (const tier of [block, inline]) {
    const hit = tier.find((c) => /[\u4e00-\u9fa5]/.test(c)) || tier[0];
    if (hit) return hit.slice(0, 90);
  }
  return fallback.slice(0, 90);
}

/**
 * 扫描项目里的外部自动化资产。
 *
 * 只读，不写任何文件 —— 发现不等于注册。想让它变成可被 sop run/match 命中的
 * SOP，用 `lite-browser sop adopt <name>` 显式收编，或让脚本经由
 * `lite-browser exec -- <cmd>` 执行以便自动沉淀。
 */
export function discoverAssets(cwd = process.cwd()): DiscoveredAsset[] {
  const assets: DiscoveredAsset[] = [];

  for (const dir of DOC_DIRS) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      if (extname(file).toLowerCase() !== '.md') continue;
      let content = '';
      try { content = readFileSync(file, 'utf-8'); } catch (_) { continue; }
      const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(file, '.md');
      const name = basename(file, '.md');
      assets.push({
        kind: 'doc',
        name,
        title: heading,
        path: relative(cwd, file),
        ext: '.md',
        intents: intentsFrom(name, heading),
        domains: domainsIn(content),
        sizeBytes: content.length,
        mtime: statSync(file).mtime.toISOString(),
      });
    }
  }

  for (const dir of SCRIPT_DIRS) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      const ext = extname(file).toLowerCase();
      const runner = RUNNERS[ext];
      if (!runner) continue;
      let content = '';
      try { content = readFileSync(file, 'utf-8'); } catch (_) { continue; }
      const name = basename(file, ext);
      const firstComment = describeScript(content, name);
      assets.push({
        kind: 'script',
        name,
        title: firstComment,
        path: relative(cwd, file),
        ext,
        intents: intentsFrom(name, firstComment),
        domains: domainsIn(content),
        suggestion: `${runner} ${relative(cwd, file)}`,
        sizeBytes: content.length,
        mtime: statSync(file).mtime.toISOString(),
      });
    }
  }

  // 同一路径（docs 与 sop 目录重叠时会重复扫到）去重
  const seen = new Set<string>();
  return assets
    .filter((a) => (seen.has(a.path) ? false : (seen.add(a.path), true)))
    // 排序即减噪：带域名的最可能是浏览器自动化资产，脚本比文档更可直接执行，
    // 同权再按 mtime 新的在前。列表头部应该是「你真正做过的活」。
    .sort((a, b) => {
      const da = a.domains.length > 0 ? 0 : 1;
      const db = b.domains.length > 0 ? 0 : 1;
      if (da !== db) return da - db;
      const ka = a.kind === 'script' ? 0 : 1;
      const kb = b.kind === 'script' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return b.mtime.localeCompare(a.mtime);
    });
}
