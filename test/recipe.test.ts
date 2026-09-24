import { describe, it, expect } from 'bun:test';
import { RecipeEngine } from '../src/recipe.js';
import { formatSnapshot } from '../src/dom.js';

describe('RecipeEngine', () => {
  it('should initialize and list recipes without error', () => {
    const engine = new RecipeEngine();
    const list = engine.listRecipes();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should record, optimize, and save a recipe', () => {
    RecipeEngine.resetTrajectory();

    RecipeEngine.recordAction({
      type: 'open',
      url: 'https://example.com',
    });

    RecipeEngine.recordAction({
      type: 'click',
      target: '@1',
      selector: '#btn',
      x: 100,
      y: 200,
      targetDescription: 'Search Button',
    });

    RecipeEngine.recordAction({
      type: 'type',
      target: '@2',
      selector: '#input',
      text: 'hello world',
      targetDescription: 'Search Input',
    });

    const engine = new RecipeEngine();
    const recipe = engine.saveAndOptimize('test-recipe', 'Test description');

    expect(recipe.name).toBe('test-recipe');
    expect(recipe.stepCount).toBe(3);
    expect(recipe.steps[0].action).toBe('open');
    expect(recipe.steps[1].action).toBe('click');
    expect(recipe.steps[2].action).toBe('type');
    expect(recipe.steps[2].text).toContain('{{input_');

    // Clean up
    engine.deleteRecipe('test-recipe');
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
    expect(output).toContain('@2');
  });
});
