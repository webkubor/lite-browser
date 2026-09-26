/**
 * recipe.ts —— SOP 元数组、轨迹沉淀、自进化更新、团队共享与自动化匹配执行引擎
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SOP, SOPMatch, SOPSchedule, SOPParameter, SOPChangelog, RecipeStep, TrajectoryAction } from './types.js';
import { SessionRegistry } from './registry.js';

export const GLOBAL_RECIPES_DIR = join(homedir(), '.lite-browser', 'recipes');
export const LOCAL_RECIPES_DIR = join(process.cwd(), '.lite-browser', 'recipes');

/**
 * 轨迹文件**按 Agent 隔离**。
 *
 * 曾经是全局单文件 `/tmp/lite-browser-trajectory.json`：两个 Agent 并行时，
 * 各自的 open/click/type 会交错写进同一条轨迹，`done` 沉淀出来的 SOP 是两件事
 * 拼在一起的怪物。这跟会话指针全局共用是同一类 bug。
 */
const TRAJECTORY_DIR = join(homedir(), '.lite-browser', 'trajectory');

export function trajectoryFileFor(agent?: string): string {
  const a = String(agent || RecipeEngine.currentActor() || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(TRAJECTORY_DIR, `${a}.json`);
}

export interface SaveSOPOptions {
  name: string;
  description?: string;
  intent?: string;
  domain?: string;
  urlPattern?: string;
  frequency?: string;
  cron?: string;
  reason?: string;
  scope?: 'global' | 'project';
}

export interface MatchQuery {
  url?: string;
  intent?: string;
  domain?: string;
}

export interface MatchResult {
  matched: SOP | null;
  score: number;
  reason: string;
}

function bumpVersion(version: string, type: 'patch' | 'minor' = 'patch'): string {
  const parts = (version || '1.0.0').split('.').map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (type === 'minor') {
    parts[1]++;
    parts[2] = 0;
  } else {
    parts[2]++;
  }
  return parts.join('.');
}

export class RecipeEngine {
  public globalDir: string;
  public localDir: string;

  constructor(globalDir = GLOBAL_RECIPES_DIR, localDir = LOCAL_RECIPES_DIR) {
    this.globalDir = globalDir;
    this.localDir = localDir;
    this.ensureDir();
  }

  ensureDir(): void {
    if (!existsSync(this.globalDir)) {
      mkdirSync(this.globalDir, { recursive: true });
    }
  }

  /**
   * 当前操作者身份。轨迹必须记在**做这件事的 Agent** 名下，
   * 否则多 Agent 并行时轨迹会互相污染。
   */
  private static actor?: string;

  static setActor(agent?: string): void {
    RecipeEngine.actor = agent;
  }

  static currentActor(): string {
    return RecipeEngine.actor || SessionRegistry.detectCurrentAgent() || 'default';
  }

  static recordAction(action: Omit<TrajectoryAction, 'timestamp'>): void {
    const file = trajectoryFileFor();
    if (!existsSync(TRAJECTORY_DIR)) {
      try { mkdirSync(TRAJECTORY_DIR, { recursive: true }); } catch (_) {}
    }

    let trajectory: TrajectoryAction[] = [];
    if (existsSync(file)) {
      try {
        trajectory = JSON.parse(readFileSync(file, 'utf-8'));
      } catch (_) {}
    }

    trajectory.push({
      ...action,
      timestamp: Date.now(),
    });

    writeFileSync(file, JSON.stringify(trajectory, null, 2));
  }

  static resetTrajectory(agent?: string): void {
    const file = trajectoryFileFor(agent);
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (_) {}
    }
    // 清理历史遗留的全局轨迹文件
    const legacy = '/tmp/lite-browser-trajectory.json';
    if (existsSync(legacy)) {
      try { unlinkSync(legacy); } catch (_) {}
    }
  }

  /**
   * 读取轨迹。
   *
   * 自己的轨迹为空时，若全系统恰好只有另一个 Agent 留下过轨迹，则采用它 ——
   * 无歧义才推断，多条并存时宁可报空，也不猜（猜错会沉淀出别人的 SOP）。
   */
  static getTrajectory(agent?: string): TrajectoryAction[] {
    const own = RecipeEngine.readTrajectoryFile(trajectoryFileFor(agent));
    if (own.length > 0) return own;

    if (!existsSync(TRAJECTORY_DIR)) return [];
    const others = readdirSync(TRAJECTORY_DIR)
      .filter((f) => f.endsWith('.json'))
      .filter((f) => f !== `${String(agent || RecipeEngine.currentActor()).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
      .map((f) => RecipeEngine.readTrajectoryFile(join(TRAJECTORY_DIR, f)))
      .filter((t) => t.length > 0);

    return others.length === 1 ? others[0] : [];
  }

  private static readTrajectoryFile(file: string): TrajectoryAction[] {
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * 保存或自进化更新 SOP（绝不单纯做加法或乱开副本）
   *
   * explicitSteps 用于 `sop adopt`：把已经写好的外部脚本一次性收编，
   * 这种场景本来就没有轨迹可沉淀。
   */
  saveOrUpdate(options: SaveSOPOptions | string, legacyDesc?: string, explicitSteps?: RecipeStep[]): SOP {
    const opts: SaveSOPOptions =
      typeof options === 'string'
        ? { name: options, description: legacyDesc }
        : options;

    const rawActions = explicitSteps?.length ? [] : RecipeEngine.getTrajectory();
    if (rawActions.length === 0 && !explicitSteps?.length) {
      // 这是本工具最容易让人误判的地方：活干完了、`done` 也跑了，却什么都没沉淀，
      // 而且不给原因。真实原因通常是——操作走的是自研脚本直连 CDP，从未经过
      // lite-browser 的动作层，所以根本没有轨迹可沉淀。必须把话说清楚。
      throw new Error(
        [
          `没有可沉淀的动作轨迹（Agent: ${RecipeEngine.currentActor()}）。`,
          '',
          '自动沉淀的前提是「操作经过 lite-browser 的动作层」：',
          '  · lite-browser open / click / type / eval ...  —— 会被记录',
          '  · 你自己的脚本直连 CDP（例如 twitter-poster.mjs）—— 不会被记录，沉淀引擎看不见',
          '',
          '两种修法：',
          '  1) 让脚本调用经过工具，这样以后自动沉淀：',
          '       lite-browser exec -- node scripts/twitter-poster.mjs check',
          '  2) 已经写好的脚本想一次性纳入索引：',
          '       lite-browser sop adopt <name> --script scripts/twitter-poster.mjs',
        ].join('\n')
      );
    }

    const optimizedSteps: RecipeStep[] = [];
    const variables = new Set<string>();
    const parameters: SOPParameter[] = [];
    const detectedDomains = new Set<string>();
    const detectedUrlPatterns = new Set<string>();

    if (opts.domain) detectedDomains.add(opts.domain);
    if (opts.urlPattern) detectedUrlPatterns.add(opts.urlPattern);

    // adopt 路径：直接采用外部给定的步骤，无需轨迹
    if (explicitSteps?.length) {
      optimizedSteps.push(...explicitSteps);
    }

    for (let i = 0; i < rawActions.length; i++) {
      const act = rawActions[i];

      if (act.type === 'open' && act.url) {
        try {
          const u = new URL(act.url);
          detectedDomains.add(u.hostname);
          detectedUrlPatterns.add(`${u.origin}${u.pathname.split('/').slice(0, 3).join('/')}*`);
        } catch (_) {}

        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'open',
          url: act.url,
          description: `打开 ${act.url}`,
        });
      } else if (act.type === 'type' && act.text) {
        const varName = `input_${optimizedSteps.length + 1}`;
        variables.add(varName);
        const desc = act.targetDescription || act.selector || act.target || '输入文本';

        parameters.push({
          name: varName,
          description: `在 ${desc} 输入内容`,
          required: true,
          default: act.text,
          example: act.text,
        });

        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'type',
          target: act.selector || act.target,
          text: `{{${varName}}}`,
          defaultText: act.text,
          description: `在 ${desc} 输入文本`,
        });
      } else if (act.type === 'click') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'click',
          target: act.selector || act.target,
          x: act.x,
          y: act.y,
          description: `点击 ${act.targetDescription || act.selector || act.target}`,
        });
      } else if (act.type === 'hover') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'hover',
          target: act.selector || act.target,
          x: act.x,
          y: act.y,
          description: `悬停在 ${act.targetDescription || act.selector || act.target}`,
        });
      } else if (act.type === 'press') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'press',
          key: act.key,
          description: `按下按键 ${act.key}`,
        });
      } else if (act.type === 'select') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'select',
          target: act.selector || act.target,
          value: act.value,
          description: `选择下拉框 ${act.selector || act.target} 为 "${act.value}"`,
        });
      } else if (act.type === 'upload') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'upload',
          target: act.selector || act.target,
          files: act.files,
          description: `上传文件至 ${act.selector || act.target}`,
        });
      } else if (act.type === 'scroll') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'scroll',
          direction: act.direction,
          amount: act.amount,
        });
      } else if (act.type === 'exec' && act.command) {
        // 连续相同的命令只留一次，避免重试造成的重复步骤
        const last = optimizedSteps[optimizedSteps.length - 1];
        if (!(last && last.action === 'exec' && last.command === act.command && JSON.stringify(last.args) === JSON.stringify(act.args))) {
          optimizedSteps.push({
            step: optimizedSteps.length + 1,
            action: 'exec',
            command: act.command,
            args: act.args || [],
            description: `执行命令 ${[act.command, ...(act.args || [])].join(' ')}`,
          });
        }
      } else if (act.type === 'wait') {
        const last = optimizedSteps[optimizedSteps.length - 1];
        if (last && last.action === 'wait') {
          last.seconds = (last.seconds || 0) + (act.seconds || 0);
        } else {
          optimizedSteps.push({
            step: optimizedSteps.length + 1,
            action: 'wait',
            seconds: act.seconds,
          });
        }
      }
    }

    // 判断保存目录与作用域
    const targetScope: 'global' | 'project' =
      opts.scope || (existsSync(join(this.localDir, `${opts.name}.json`)) ? 'project' : 'global');
    const targetDir = targetScope === 'project' ? this.localDir : this.globalDir;

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const filePath = join(targetDir, `${opts.name}.json`);
    const now = new Date().toISOString();
    let sop: SOP;

    if (existsSync(filePath)) {
      // 存在旧版本：走「自愈与版本升级」逻辑，保留频次统计与既有元数据
      const old: SOP = JSON.parse(readFileSync(filePath, 'utf-8'));
      const newVersion = bumpVersion(old.version || '1.0.0', 'patch');

      const mergedIntents = Array.from(new Set([...(old.match?.intents || []), ...(opts.intent ? [opts.intent] : [])]));
      const mergedDomains = Array.from(new Set([...(old.match?.domains || []), ...detectedDomains]));
      const mergedUrls = Array.from(new Set([...(old.match?.urlPatterns || []), ...detectedUrlPatterns]));

      const changelogEntry: SOPChangelog = {
        version: newVersion,
        date: now,
        reason: opts.reason || '自动根据最新轨迹更新步骤与参数结构',
      };

      sop = {
        name: opts.name,
        version: newVersion,
        description: opts.description || old.description || `自动化 SOP: ${opts.name}`,
        scope: targetScope,
        match: {
          urlPatterns: mergedUrls,
          intents: mergedIntents,
          domains: mergedDomains,
        },
        schedule: {
          frequency: opts.frequency || old.schedule?.frequency || 'manual',
          cron: opts.cron || old.schedule?.cron,
          lastRunAt: old.schedule?.lastRunAt,
          lastSuccessAt: old.schedule?.lastSuccessAt,
          runCount: old.schedule?.runCount || 0,
          successCount: old.schedule?.successCount || 0,
          failureCount: old.schedule?.failureCount || 0,
        },
        parameters,
        stepCount: optimizedSteps.length,
        variables: Array.from(variables),
        steps: optimizedSteps,
        changelog: [...(old.changelog || []), changelogEntry],
        createdAt: old.createdAt || now,
        updatedAt: now,
      };
    } else {
      // 全新初始版本 1.0.0
      const initialChangelog: SOPChangelog = {
        version: '1.0.0',
        date: now,
        reason: opts.reason || '初次录制并沉淀为标准化 SOP',
      };

      sop = {
        name: opts.name,
        version: '1.0.0',
        description: opts.description || `自动化 SOP: ${opts.name}`,
        scope: targetScope,
        match: {
          urlPatterns: Array.from(detectedUrlPatterns),
          intents: opts.intent ? [opts.intent] : [opts.name],
          domains: Array.from(detectedDomains),
        },
        schedule: {
          frequency: opts.frequency || 'manual',
          cron: opts.cron,
          runCount: 0,
          successCount: 0,
          failureCount: 0,
        },
        parameters,
        stepCount: optimizedSteps.length,
        variables: Array.from(variables),
        steps: optimizedSteps,
        changelog: [initialChangelog],
        createdAt: now,
        updatedAt: now,
      };
    }

    writeFileSync(filePath, JSON.stringify(sop, null, 2));
    RecipeEngine.resetTrajectory();

    return sop;
  }

  // 兼容老调用
  saveAndOptimize(name: string, description = ''): SOP {
    return this.saveOrUpdate({ name, description });
  }

  /**
   * 根据上下文（URL、意图、域名）匹配最合适的 SOP
   */
  matchSOP(query: MatchQuery): MatchResult {
    this.ensureDir();
    const sops = this.listSOPs();
    if (sops.length === 0) {
      return { matched: null, score: 0, reason: '当前无任何可用 SOP' };
    }

    let bestScore = 0;
    let bestSOP: SOP | null = null;
    let bestReason = '';

    for (const item of sops) {
      let score = 0;
      const reasons: string[] = [];

      // 本地项目 SOP 优先 (+0.05)
      if (item.scope === 'project') {
        score += 0.05;
        reasons.push('项目级优先');
      }

      // 1. 域名精确匹配 (+0.4)
      if (query.domain && item.match?.domains?.includes(query.domain)) {
        score += 0.4;
        reasons.push(`域名匹配(${query.domain})`);
      }

      // 2. URL 模式匹配 (+0.4)
      if (query.url && item.match?.urlPatterns) {
        for (const pattern of item.match.urlPatterns) {
          const regexStr = '^' + pattern.replace(/\*/g, '.*') + '$';
          if (new RegExp(regexStr).test(query.url) || query.url.includes(pattern.replace('*', ''))) {
            score += 0.4;
            reasons.push(`URL规则匹配(${pattern})`);
            break;
          }
        }
      }

      // 3. 意图关键词模糊匹配 (+0.3)
      if (query.intent && item.match?.intents) {
        const lowerIntent = query.intent.toLowerCase();
        for (const it of item.match.intents) {
          if (lowerIntent.includes(it.toLowerCase()) || it.toLowerCase().includes(lowerIntent)) {
            score += 0.3;
            reasons.push(`意图关键词命中(${it})`);
            break;
          }
        }
      }

      // 4. 名称完全一致 (+0.5)
      if (query.intent && item.name.toLowerCase() === query.intent.toLowerCase()) {
        score += 0.5;
        reasons.push(`SOP名称完全一致`);
      }

      score = Math.min(1.0, score);

      if (score > bestScore) {
        bestScore = score;
        bestSOP = item;
        bestReason = reasons.join(', ');
      }
    }

    if (bestScore >= 0.3 && bestSOP) {
      return {
        matched: bestSOP,
        score: Math.round(bestScore * 100) / 100,
        reason: bestReason,
      };
    }

    return { matched: null, score: bestScore, reason: '未找到足够置信度的匹配 SOP' };
  }

  /**
   * 记录执行结果并自增频次统计
   */
  recordRun(name: string, success: boolean): void {
    const filePath = this._findFilePath(name);
    if (!filePath || !existsSync(filePath)) return;

    try {
      const sop: SOP = JSON.parse(readFileSync(filePath, 'utf-8'));
      const now = new Date().toISOString();
      if (!sop.schedule) {
        sop.schedule = { frequency: 'manual', runCount: 0, successCount: 0, failureCount: 0 };
      }
      sop.schedule.runCount = (sop.schedule.runCount || 0) + 1;
      sop.schedule.lastRunAt = now;
      if (success) {
        sop.schedule.successCount = (sop.schedule.successCount || 0) + 1;
        sop.schedule.lastSuccessAt = now;
      } else {
        sop.schedule.failureCount = (sop.schedule.failureCount || 0) + 1;
      }
      sop.updatedAt = now;
      writeFileSync(filePath, JSON.stringify(sop, null, 2));
    } catch (_) {}
  }

  /**
   * 更新调度策略
   */
  updateSchedule(name: string, scheduleUpdate: Partial<SOPSchedule>): SOP {
    const filePath = this._findFilePath(name);
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`找不到名为 "${name}" 的 SOP`);
    }

    const sop: SOP = JSON.parse(readFileSync(filePath, 'utf-8'));
    sop.schedule = {
      ...sop.schedule,
      ...scheduleUpdate,
    };
    sop.updatedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(sop, null, 2));
    return sop;
  }

  /**
   * 校验 SOP 结构完整性
   */
  validateSOP(sop: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!sop || typeof sop !== 'object') {
      return { valid: false, errors: ['SOP 必须是一个 JSON 对象'] };
    }
    if (!sop.name || typeof sop.name !== 'string') {
      errors.push('缺少或非法的 "name" 字段');
    }
    if (!sop.version || typeof sop.version !== 'string') {
      errors.push('缺少或非法的 "version" 字段');
    }
    if (!Array.isArray(sop.steps)) {
      errors.push('"steps" 必须是一个数组');
    } else {
      sop.steps.forEach((step: any, idx: number) => {
        if (!step.action) {
          errors.push(`第 ${idx + 1} 步缺少 "action" 字段`);
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * 导出 SOP 为格式化 JSON 字符串
   */
  exportSOP(name: string): string {
    const sop = this.getRecipe(name);
    return JSON.stringify(sop, null, 2);
  }

  /**
   * 导入 SOP（支持字符串或对象）
   */
  importSOP(sopInput: string | SOP, targetScope: 'global' | 'project' = 'global'): SOP {
    let sop: SOP;
    if (typeof sopInput === 'string') {
      try {
        sop = JSON.parse(sopInput);
      } catch (err: any) {
        throw new Error(`SOP 解析失败: ${err.message}`);
      }
    } else {
      sop = sopInput;
    }

    const { valid, errors } = this.validateSOP(sop);
    if (!valid) {
      throw new Error(`SOP 校验失败: ${errors.join(', ')}`);
    }

    const targetDir = targetScope === 'project' ? this.localDir : this.globalDir;
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    sop.scope = targetScope;
    sop.updatedAt = new Date().toISOString();
    const filePath = join(targetDir, `${sop.name}.json`);
    writeFileSync(filePath, JSON.stringify(sop, null, 2));

    return sop;
  }

  listSOPs(): SOP[] {
    this.ensureDir();
    const map = new Map<string, SOP>();

    // 1. 读取全局 SOP
    if (existsSync(this.globalDir)) {
      const gFiles = readdirSync(this.globalDir).filter((f) => f.endsWith('.json'));
      for (const file of gFiles) {
        try {
          const content: SOP = JSON.parse(readFileSync(join(this.globalDir, file), 'utf-8'));
          content.scope = 'global';
          map.set(content.name, content);
        } catch (_) {}
      }
    }

    // 2. 读取项目本地 SOP（同名可覆盖全局显示）
    if (existsSync(this.localDir)) {
      const lFiles = readdirSync(this.localDir).filter((f) => f.endsWith('.json'));
      for (const file of lFiles) {
        try {
          const content: SOP = JSON.parse(readFileSync(join(this.localDir, file), 'utf-8'));
          content.scope = 'project';
          map.set(content.name, content);
        } catch (_) {}
      }
    }

    return Array.from(map.values());
  }

  listRecipes(): Array<{ name: string; version: string; description: string; scope: string; stepCount: number; variables: string[]; frequency: string; runCount: number; createdAt: string }> {
    return this.listSOPs().map((sop) => ({
      name: sop.name,
      version: sop.version || '1.0.0',
      description: sop.description || '',
      scope: sop.scope || 'global',
      stepCount: sop.stepCount || (sop.steps ? sop.steps.length : 0),
      variables: sop.variables || [],
      frequency: sop.schedule?.frequency || 'manual',
      runCount: sop.schedule?.runCount || 0,
      createdAt: sop.createdAt,
    }));
  }

  getRecipe(name: string): SOP {
    const filePath = this._findFilePath(name);
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`找不到名为 "${name}" 的 SOP/Recipe`);
    }
    const sop: SOP = JSON.parse(readFileSync(filePath, 'utf-8'));
    sop.scope = filePath.startsWith(this.localDir) ? 'project' : 'global';
    return sop;
  }

  deleteRecipe(name: string): boolean {
    const filePath = this._findFilePath(name);
    if (filePath && existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }
    return false;
  }

  private _findFilePath(name: string): string | null {
    const localPath = join(this.localDir, `${name}.json`);
    if (existsSync(localPath)) return localPath;

    const globalPath = join(this.globalDir, `${name}.json`);
    if (existsSync(globalPath)) return globalPath;

    return null;
  }
}
