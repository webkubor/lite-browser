/**
 * index.ts —— lite-browser 统一编程接口与 SDK 导出
 */

export * from './types.js';
export * from './cdp.js';
export * from './chrome.js';
export * from './dom.js';
export * from './actions.js';
export * from './recipe.js';
export * from './task.js';
export * from './cookie.js';
export * from './mcp.js';

import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { TaskEngine } from './task.js';
import { CookieManager } from './cookie.js';
import type { LaunchOptions } from './types.js';

/**
 * LiteBrowser —— 极简高阶 SDK 统一门面
 */
export class LiteBrowser {
  /**
   * 启动或连接至浏览器会话并打开指定网址
   */
  static async open(url: string, options: LaunchOptions & { temp?: boolean } = {}): Promise<BrowserActions> {
    return await BrowserActions.launchOrConnect({ url, ...options });
  }

  /**
   * 连接至已存在的活跃会话
   */
  static async connect(): Promise<BrowserActions> {
    return await BrowserActions.connectToSession();
  }

  /**
   * SOP 引擎实例
   */
  static get recipes(): RecipeEngine {
    return new RecipeEngine();
  }

  /**
   * 委派任务调度引擎实例
   */
  static get tasks(): TaskEngine {
    return new TaskEngine();
  }

  /**
   * Cookie 会话管理器
   */
  static get cookies(): typeof CookieManager {
    return CookieManager;
  }
}
