/**
 * recipe.ts —— 任务轨迹沉淀、优化与自动化回放引擎
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Recipe, RecipeStep, TrajectoryAction } from './types.js';

const RECIPES_DIR = join(homedir(), '.lite-browser', 'recipes');
const ACTIVE_TRAJECTORY_FILE = '/tmp/lite-browser-trajectory.json';

export class RecipeEngine {
  constructor() {
    this.ensureDir();
  }

  ensureDir(): void {
    if (!existsSync(RECIPES_DIR)) {
      mkdirSync(RECIPES_DIR, { recursive: true });
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
      try { unlinkSync(ACTIVE_TRAJECTORY_FILE); } catch (_) {}
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

  saveAndOptimize(name: string, description = ''): Recipe {
    const rawActions = RecipeEngine.getTrajectory();
    if (rawActions.length === 0) {
      throw new Error('当前会话没有记录到任何可沉淀的动作轨迹');
    }

    const optimizedSteps: RecipeStep[] = [];
    const variables = new Set<string>();

    for (let i = 0; i < rawActions.length; i++) {
      const act = rawActions[i];

      if (act.type === 'type' && act.text) {
        const varName = `input_${optimizedSteps.length + 1}`;
        variables.add(varName);
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'type',
          target: act.selector || act.target,
          text: `{{${varName}}}`,
          defaultText: act.text,
          description: `在 ${act.targetDescription || act.selector || act.target} 输入文本`,
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
      } else if (act.type === 'open') {
        optimizedSteps.push({
          step: optimizedSteps.length + 1,
          action: 'open',
          url: act.url,
          description: `打开 ${act.url}`,
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

    const recipe: Recipe = {
      name,
      description: description || `自动沉淀的任务流水线: ${name}`,
      createdAt: new Date().toISOString(),
      stepCount: optimizedSteps.length,
      variables: Array.from(variables),
      steps: optimizedSteps,
    };

    const filePath = join(RECIPES_DIR, `${name}.json`);
    writeFileSync(filePath, JSON.stringify(recipe, null, 2));
    RecipeEngine.resetTrajectory();

    return recipe;
  }

  listRecipes(): Array<{ name: string; description: string; stepCount: number; variables: string[]; createdAt: string }> {
    this.ensureDir();
    const files = readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.json'));
    const list = [];
    for (const file of files) {
      try {
        const content: Recipe = JSON.parse(readFileSync(join(RECIPES_DIR, file), 'utf-8'));
        list.push({
          name: content.name || file.replace('.json', ''),
          description: content.description || '',
          stepCount: content.stepCount || (content.steps ? content.steps.length : 0),
          variables: content.variables || [],
          createdAt: content.createdAt,
        });
      } catch (_) {}
    }
    return list;
  }

  getRecipe(name: string): Recipe {
    const filePath = join(RECIPES_DIR, `${name}.json`);
    if (!existsSync(filePath)) {
      throw new Error(`找不到名为 "${name}" 的 Recipe`);
    }
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  deleteRecipe(name: string): boolean {
    const filePath = join(RECIPES_DIR, `${name}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
