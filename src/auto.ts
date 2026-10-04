/**
 * auto.ts —— Jev-Ultrafast 极速自主目标驱动执行器
 * 核心设计：
 *  1. SOP 优先：若目标匹配已有沉淀 SOP，直接确定性回放（300ms 完成，0 Token）
 *  2. 推测式状态机：结构化控件动作空间 + 动作与文本解耦
 *  3. 密钥安全：自动从环境变量或原生 kyvault (secret://deepseek/api-key) 注入，严禁明文落盘
 *  4. 沉淀闭环：达成目标后可一键通过 RecipeEngine 固化为确定性 SOP
 */

import { execSync } from 'node:child_process';
import type { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { executeSteps } from './runner.js';
import type { InteractiveElement } from './types.js';

export interface AutoOptions {
  maxSteps?: number;
  dryRun?: boolean;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  onStep?: (step: AutoStepRecord) => void;
}

export interface AutoStepRecord {
  step: number;
  action: 'click' | 'type' | 'select' | 'press' | 'scroll' | 'wait' | 'done' | 'blocked';
  target?: string;
  text?: string;
  key?: string;
  thought?: string;
  latencyMs?: number;
}

export class AutoPilot {
  private browser: BrowserActions;
  private options: AutoOptions;
  private history: AutoStepRecord[] = [];

  constructor(browser: BrowserActions, options: AutoOptions = {}) {
    this.browser = browser;
    this.options = {
      maxSteps: options.maxSteps || 15,
      ...options,
    };
  }

  static getLlmConfig(): { apiKey?: string; baseUrl: string; model: string } {
    let apiKey = process.env.AUTOPILOT_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY;

    let baseUrl = process.env.AUTOPILOT_BASE_URL || 'https://api.deepseek.com/v1';
    let model = process.env.AUTOPILOT_MODEL || 'deepseek-chat';

    if (!apiKey) {
      try {
        const val = execSync('ky get secret://deepseek/api-key 2>/dev/null', { encoding: 'utf8' }).trim();
        if (val && val.startsWith('sk-')) {
          apiKey = val;
          baseUrl = 'https://api.deepseek.com/v1';
          model = 'deepseek-chat';
        }
      } catch (_) {}
    }

    if (!apiKey) {
      try {
        const val = execSync('ky get secret://openrouter/api-key 2>/dev/null', { encoding: 'utf8' }).trim();
        if (val && val.startsWith('sk-')) {
          apiKey = val;
          baseUrl = 'https://openrouter.ai/api/v1';
          model = 'deepseek/deepseek-chat';
        }
      } catch (_) {}
    }

    return { apiKey, baseUrl, model };
  }

  async run(goal: string): Promise<{ ok: boolean; steps: AutoStepRecord[]; sopMatched?: string }> {
    const currentUrl = await this.browser.getUrl().catch(() => '');
    const engine = new RecipeEngine();

    // 1. SOP 优先：检查是否命中已有沉淀
    const match = engine.matchSOP({ intent: goal, url: currentUrl });
    if (match.matched && match.score >= 0.7) {
      console.log(`⚡ 命中已有 SOP [${match.matched.name}] (匹配度: ${Math.round(match.score * 100)}%)，直接极速回放 (0 Token)...`);
      await executeSteps(match.matched, this.browser);
      engine.recordRun(match.matched.name, true);
      return { ok: true, steps: [], sopMatched: match.matched.name };
    }

    console.log(`🚀 未命中确定性 SOP，启动 Jev-Ultrafast 极速自主探索循环...`);
    console.log(`🎯 目标: "${goal}"`);

    const { apiKey, baseUrl, model } = AutoPilot.getLlmConfig();
    const maxSteps = this.options.maxSteps || 15;

    for (let step = 1; step <= maxSteps; step++) {
      const snap = await this.browser.snapshot();
      if (snap.phase === 'awaiting_human') {
        console.log(`⏸ 遇到登录/验证码拦截，交接给人工处理: ${snap.needs}`);
        return { ok: false, steps: this.history };
      }

      const decision = await this.decideNextAction(goal, snap.elements, snap.title, snap.url, { apiKey, baseUrl, model });
      this.history.push({ step, ...decision });
      this.options.onStep?.({ step, ...decision });

      console.log(`  [Step ${step}] ${decision.action.toUpperCase()} ${decision.target || ''} ${decision.text ? `"${decision.text}"` : ''} —— ${decision.thought || ''}`);

      if (decision.action === 'done') {
        console.log(`\n🎉 目标达成！共执行 ${step} 步。`);
        return { ok: true, steps: this.history };
      }

      if (decision.action === 'blocked') {
        console.warn(`\n⚠️ 探索被阻断：${decision.thought}`);
        return { ok: false, steps: this.history };
      }

      // 执行原子动作
      if (decision.action === 'click' && decision.target) {
        await this.browser.click(decision.target);
      } else if (decision.action === 'type' && decision.target) {
        await this.browser.type(decision.target, decision.text || '');
      } else if (decision.action === 'select' && decision.target && decision.text) {
        await this.browser.select(decision.target, decision.text);
      } else if (decision.action === 'press' && decision.key) {
        await this.browser.press(decision.key);
      } else if (decision.action === 'scroll') {
        await this.browser.scroll('down', 400);
      } else if (decision.action === 'wait') {
        await this.browser.wait(1);
      }
    }

    return { ok: false, steps: this.history };
  }

  private async decideNextAction(
    goal: string,
    elements: InteractiveElement[],
    title: string,
    url: string,
    config: { apiKey?: string; baseUrl: string; model: string }
  ): Promise<Omit<AutoStepRecord, 'step'>> {
    const compactElements = elements.slice(0, 80).map((e) => ({
      id: e.id,
      role: e.role,
      tag: e.tag,
      label: e.text || '<empty>',
    }));

    if (!config.apiKey) {
      // 本地轻量启发式规则（当未配置外部 LLM 时）
      const lowerGoal = goal.toLowerCase();
      const matchBtn = elements.find((e) => (e.role === 'button' || e.tag === 'button') && lowerGoal.includes(e.text.toLowerCase()));
      if (matchBtn) {
        return { action: 'click', target: matchBtn.id, thought: `启发式匹配按钮: "${matchBtn.text}"` };
      }
      return { action: 'blocked', thought: '未检测到可用的 LLM API Key (请配置 DEEPSEEK_API_KEY 或在 kyvault 中写入)' };
    }

    const systemPrompt = `You are an ultrafast web agent. Given a goal, current page info, and interactive element table, decide the single NEXT best action.
Respond ONLY with a JSON object with this exact shape:
{
  "thought": "1 sentence reasoning",
  "action": "click" | "type" | "select" | "press" | "scroll" | "wait" | "done" | "blocked",
  "target": "@1", // the element id to interact with (optional if action is scroll/done/wait)
  "text": "text to type if action is type or select value",
  "key": "Enter" // key to press if action is press
}
Rules:
1. When goal is visibly satisfied, choose action "done".
2. If unable to progress, choose "blocked".
3. Use only element IDs present in the candidate table.`;

    const userPrompt = JSON.stringify({
      goal,
      page: { title, url },
      recentActions: this.history.slice(-4),
      controls: compactElements,
    });

    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 300,
        }),
      });

      if (!res.ok) {
        throw new Error(`LLM 请求失败 HTTP ${res.status}`);
      }

      const json = await res.json() as any;
      const content = json.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      return {
        action: parsed.action || 'wait',
        target: parsed.target,
        text: parsed.text,
        key: parsed.key,
        thought: parsed.thought || '',
      };
    } catch (err: any) {
      return {
        action: 'blocked',
        thought: `模型推测失败: ${err.message}`,
      };
    }
  }
}
