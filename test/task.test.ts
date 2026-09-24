import { describe, it, expect } from 'bun:test';
import { TaskEngine } from '../src/task.js';
import { McpServer } from '../src/mcp.js';
import { LiteBrowser } from '../src/index.js';

describe('TaskEngine & Delegation', () => {
  const engine = new TaskEngine();

  it('should initialize and list tasks', () => {
    const list = engine.getAllTasks();
    expect(Array.isArray(list)).toBe(true);
  });

  it('should save and retrieve a task record', () => {
    const testTask = {
      id: 'task_test_123',
      sopName: 'test-sop',
      status: 'pending' as const,
      startTime: new Date().toISOString(),
      logFile: '/tmp/test-task.log',
    };

    engine.saveTask(testTask);
    const retrieved = engine.getTask('task_test_123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('task_test_123');
    expect(retrieved?.sopName).toBe('test-sop');
  });
});

describe('McpServer & Protocol Inspection', () => {
  it('should expose tool definitions including browser actions and SOP tools', () => {
    const server = new McpServer();
    const tools = (server as any).getToolDefinitions();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(15);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain('browser_open');
    expect(names).toContain('browser_snapshot');
    expect(names).toContain('browser_click');
    expect(names).toContain('browser_type');
    expect(names).toContain('browser_hover');
    expect(names).toContain('browser_press');
    expect(names).toContain('browser_select');
    expect(names).toContain('browser_cdp');
    expect(names).toContain('sop_match');
    expect(names).toContain('sop_run');
    expect(names).toContain('sop_list');
    expect(names).toContain('sop_save');
    expect(names).toContain('task_delegate');
    expect(names).toContain('task_status');
  });
});

describe('LiteBrowser SDK Facade', () => {
  it('should expose unified engines and helpers', () => {
    expect(LiteBrowser.recipes).toBeDefined();
    expect(LiteBrowser.tasks).toBeDefined();
    expect(LiteBrowser.cookies).toBeDefined();
    expect(typeof LiteBrowser.open).toBe('function');
    expect(typeof LiteBrowser.connect).toBe('function');
  });
});
