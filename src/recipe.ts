/**
 * recipe.ts —— SOP 元数组、轨迹沉淀、自进化更新、团队共享与自动化匹配执行引擎
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SOP, SOPMatch, SOPSchedule, SOPParameter, SOPChangelog, RecipeStep, TrajectoryAction } from './types.js';

export const GLOBAL_RECIPES_DIR = join(homedir(), '.lite-browser', 'recipes');
export const LOCAL_RECIPES_DIR = join(process.cwd(), '.lite-browser', 'recipes');
const ACTIVE_TRAJECTORY_FILE = '/tmp/lite-browser-trajectory.json';

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

  static recordAction(action: Omit<TrajectoryAction, 'timestamp'>): void {
    let trajectory: TrajectoryAction[] = [];
    if (existsSync(ACTIVE_TRAJECTORY_FILE)) {
      try {
        trajectory = JSON.parse(readFileSync(ACTIVE_TRAJECTORY_FILE, 'utf-8'));
      } catch (_) {}
    }

    trajectory.push({
      ...action,
      timestamp: Date.now(),
    });

    writeFileSync(ACTIVE_TRAJECTORY_FILE, JSON.stringify(trajectory, null, 2));
  }

  static resetTrajectory(): void {
    if (existsSync(ACTIVE_TRAJECTORY_FILE)) {
      try {
        unlinkSync(ACTIVE_TRAJECTORY_FILE);
      } catch (_) {}
    }
  }

  static getTrajectory(): TrajectoryAction[] {
    if (!existsSync(ACTIVE_TRAJECTORY_FILE)) return [];
    try {
      return JSON.parse(readFileSync(ACTIVE_TRAJECTORY_FILE, 'utf-8'));
    } catch (_) {
      return [];
    }
  }

  /**
   * 保存或自进化更新 SOP（绝不单纯做加法或乱开副本）
   */
  saveOrUpdate(options: SaveSOPOptions | string, legacyDesc?: string): SOP {
    const opts: SaveSOPOptions =
      typeof options === 'string'
        ? { name: options, description: legacyDesc }
        : options;

    const rawActions = RecipeEngine.getTrajectory();
    if (rawActions.length === 0) {
      throw new Error('当前会话没有记录到任何可沉淀的动作轨迹');
    }

    const optimizedSteps: RecipeStep[] = [];
    const variables = new Set<string>();
    const parameters: SOPParameter[] = [];
    const detectedDomains = new Set<string>();
    const detectedUrlPatterns = new Set<string>();

    if (opts.domain) detectedDomains.add(opts.domain);
    if (opts.urlPattern) detectedUrlPatterns.add(opts.urlPattern);

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
