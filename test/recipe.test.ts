import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { RecipeEngine } from '../src/recipe.js';
import { formatSnapshot } from '../src/dom.js';

describe('RecipeEngine & SOP Evolution', () => {
  const TEST_SOP = 'unit-test-sop';
  let engine: RecipeEngine;

  beforeEach(() => {
    engine = new RecipeEngine();
    RecipeEngine.resetTrajectory();
    try { engine.deleteRecipe(TEST_SOP); } catch (_) {}
  });

  afterEach(() => {
    try { engine.deleteRecipe(TEST_SOP); } catch (_) {}
    RecipeEngine.resetTrajectory();
  });

  it('should initialize and list recipes without error', () => {
    const list = engine.listRecipes();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should record, optimize, and save a SOP v1.0.0 with full meta array', () => {
    RecipeEngine.recordAction({
      type: 'open',
      url: 'https://juejin.cn/editor/drafts/new',
    });

    RecipeEngine.recordAction({
      type: 'click',
      target: '@1',
      selector: '#btn',
      x: 100,
      y: 200,
      targetDescription: '发布按钮',
    });

    RecipeEngine.recordAction({
      type: 'type',
      target: '@2',
      selector: '#input',
      text: 'AI 博客标题',
      targetDescription: '标题输入框',
    });

    const sop = engine.saveOrUpdate({
      name: TEST_SOP,
      description: '掘金文章发布 SOP',
      intent: '发布掘金',
      domain: 'juejin.cn',
      frequency: 'daily',
    });

    expect(sop.name).toBe(TEST_SOP);
    expect(sop.version).toBe('1.0.0');
    expect(sop.stepCount).toBe(3);
    expect(sop.schedule.frequency).toBe('daily');
    expect(sop.schedule.runCount).toBe(0);
    expect(sop.match.domains).toContain('juejin.cn');
    expect(sop.match.intents).toContain('发布掘金');
    expect(sop.parameters.length).toBe(1);
    expect(sop.parameters[0].default).toBe('AI 博客标题');
    expect(sop.changelog.length).toBe(1);
  });

  it('should evolve and auto-update existing SOP without creating duplicates', () => {
    // 第一次录入 v1.0.0
    RecipeEngine.recordAction({ type: 'open', url: 'https://juejin.cn/draft' });
    RecipeEngine.recordAction({ type: 'click', target: '@1', selector: '#btn', x: 50, y: 50 });
    engine.saveOrUpdate({ name: TEST_SOP, intent: '发布文章' });

    // 模拟运行 2 次
    engine.recordRun(TEST_SOP, true);
    engine.recordRun(TEST_SOP, true);

    // 发现问题自愈更新，录制新轨迹
    RecipeEngine.recordAction({ type: 'open', url: 'https://juejin.cn/draft' });
    RecipeEngine.recordAction({ type: 'click', target: '@1', selector: '#btn', x: 50, y: 50 });
    RecipeEngine.recordAction({ type: 'click', target: '@2', selector: '#tag-btn', x: 60, y: 60, targetDescription: '补充分类标签' });

    const evolved = engine.saveOrUpdate({
      name: TEST_SOP,
      reason: '补充必填分类标签点击步骤',
    });

    expect(evolved.name).toBe(TEST_SOP);
    expect(evolved.version).toBe('1.0.1'); // 自动版本自增
    expect(evolved.stepCount).toBe(3);
    expect(evolved.schedule.runCount).toBe(2); // 保留历史频次统计
    expect(evolved.schedule.successCount).toBe(2);
    expect(evolved.changelog.length).toBe(2);
    expect(evolved.changelog[1].reason).toBe('补充必填分类标签点击步骤');
  });

  it('should accurately match SOP by URL, domain, or intent', () => {
    RecipeEngine.recordAction({ type: 'open', url: 'https://juejin.cn/editor/drafts/123' });
    RecipeEngine.recordAction({ type: 'click', target: '@1', selector: '#btn', x: 50, y: 50 });
    engine.saveOrUpdate({
      name: TEST_SOP,
      intent: '发布掘金文章',
      domain: 'juejin.cn',
    });

    // 按 URL 匹配
    const matchByUrl = engine.matchSOP({ url: 'https://juejin.cn/editor/drafts/999' });
    expect(matchByUrl.matched?.name).toBe(TEST_SOP);
    expect(matchByUrl.score).toBeGreaterThanOrEqual(0.4);

    // 按 意图 匹配
    const matchByIntent = engine.matchSOP({ intent: '我想发布掘金文章' });
    expect(matchByIntent.matched?.name).toBe(TEST_SOP);

    // 无关任务不匹配
    const matchNone = engine.matchSOP({ intent: '预定机票', domain: 'ctrip.com' });
    expect(matchNone.matched).toBeNull();
  });
});

describe('DOM Snapshot Formatter', () => {
  it('should format elements cleanly', () => {
    const mockElements = [
      { id: '@1', tag: 'button', role: 'button', text: 'Submit', selector: '#sub', x: 50, y: 50, width: 100, height: 30 },
      { id: '@2', tag: 'input', role: 'textbox', text: '', selector: '#kw', x: 200, y: 50, width: 200, height: 30 },
    ];
    const output = formatSnapshot(mockElements, 'https://example.com', 'Example Domain');
    expect(output).toContain('@1');
    expect(output).toContain('Submit');
    expect(output).toContain('(x:50, y:50)');
  });
});
