#!/usr/bin/env bun
/**
 * cli.ts —— lite-browser CLI 入口
 * 专为 AI Agent 与极速自动化设计的轻量级浏览器操控终端
 */

import { ChromeManager } from './chrome.js';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';

const USAGE = `
🚀 lite-browser —— 极致轻量、零常驻、可沉淀的自研浏览器操控工具

基础操作:
  lite-browser open <url> [--headless]     打开网页并建立会话
  lite-browser snapshot [--json]           提取页面可交互元素并进行 [@1] 编号
  lite-browser click <@id|selector>        点击指定元素（支持 @编号 或 CSS 选择器）
  lite-browser type <@id|selector> <text>  在指定元素中键入文本
  lite-browser scroll [up|down] [px]       页面平滑滚动（默认向下 400px）
  lite-browser wait [seconds]              等待指定秒数（默认 1 秒）
  lite-browser screenshot [path]           全屏/当前视口截图（默认存至 /tmp）
  lite-browser eval "<code>"               在页面控制台执行 JavaScript
  lite-browser close                       断开连接并清理会话

任务沉淀与自动化回放 (Recipe):
  lite-browser done --name <recipe-name>   将本次成功的动作轨迹优化沉淀为 Recipe
  lite-browser recipe list                 列出所有已沉淀的 Recipe
  lite-browser recipe show <name>          查看指定 Recipe 的详情与步骤
  lite-browser recipe run <name> [args]    高速确定性回放 Recipe（免模型思考，300ms直达）
  lite-browser recipe delete <name>        删除指定 Recipe

示例:
  lite-browser open https://www.baidu.com
  lite-browser snapshot
  lite-browser type @1 "CortexOS"
  lite-browser click @2
  lite-browser done --name "baidu-search"
  lite-browser recipe run "baidu-search" --var input_1="广州天气"
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE.trim());
    return;
  }

  const recipeEngine = new RecipeEngine();

  try {
    switch (command) {
      case 'open': {
        const url = args[1];
        if (!url) {
          console.error('❌ 请提供目标 URL。例如: lite-browser open https://github.com');
          process.exit(1);
        }
        const headless = args.includes('--headless');
        console.log(`🌐 正在打开: ${url} (headless: ${headless})...`);
        const mgr = new ChromeManager();
        await mgr.getOrLaunch({ headless, url });
        const browser = await BrowserActions.connectToSession();
        const res = await browser.open(url);
        console.log(`✅ 页面加载就绪: ${res.url}`);
        break;
      }

      case 'snapshot': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.snapshot();
        if (args.includes('--json')) {
          console.log(JSON.stringify(res.elements, null, 2));
        } else {
          console.log(res.formatted);
        }
        break;
      }

      case 'click': {
        const target = args[1];
        if (!target) {
          console.error('❌ 请指定点击目标。例如: lite-browser click @3 或 lite-browser click "#submit-btn"');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        const res = await browser.click(target);
        console.log(`✅ 点击成功: ${res.target} (x:${res.x}, y:${res.y})`);
        break;
      }

      case 'type': {
        const target = args[1];
        const text = args.slice(2).join(' ');
        if (!target || text === undefined) {
          console.error('❌ 请指定目标与输入内容。例如: lite-browser type @2 "搜索关键词"');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        await browser.type(target, text);
        console.log(`✅ 文本输入成功: ${target} → "${text}"`);
        break;
      }

      case 'scroll': {
        const direction = (args[1] === 'up' ? 'up' : 'down') as 'up' | 'down';
        const amount = parseInt(args[2] || '400', 10);
        const browser = await BrowserActions.connectToSession();
        await browser.scroll(direction, amount);
        console.log(`✅ 页面滚动完成: ${direction} ${amount}px`);
        break;
      }

      case 'wait': {
        const seconds = parseFloat(args[1] || '1');
        const browser = await BrowserActions.connectToSession();
        await browser.wait(seconds);
        console.log(`✅ 等待完成: ${seconds} 秒`);
        break;
      }

      case 'screenshot': {
        const path = args[1] || `/tmp/lite-browser-${Date.now()}.png`;
        const browser = await BrowserActions.connectToSession();
        const res = await browser.screenshot(path);
        console.log(`📸 截图已保存 (${(res.size / 1024).toFixed(1)} KB): ${res.path}`);
        break;
      }

      case 'eval': {
        const code = args.slice(1).join(' ');
        if (!code) {
          console.error('❌ 请提供要执行的 JavaScript 表达式。');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        const res = await browser.eval(code);
        console.log(res);
        break;
      }

      case 'close': {
        const session = ChromeManager.getActiveSession();
        if (session) {
          const browser = await BrowserActions.connectToSession();
          browser.close();
          console.log('✅ 会话已关闭，连接已清理');
        } else {
          console.log('💡 当前无活跃会话');
        }
        break;
      }

      // 任务沉淀指令
      case 'done': {
        let name = '';
        let desc = '';
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--name' && args[i + 1]) {
            name = args[i + 1];
            i++;
          } else if (args[i] === '--desc' && args[i + 1]) {
            desc = args[i + 1];
            i++;
          }
        }

        if (!name) {
          console.error('❌ 请为沉淀的任务指定名称。例如: lite-browser done --name "wechat-post"');
          process.exit(1);
        }

        const saved = recipeEngine.saveAndOptimize(name, desc);
        console.log(`\n🎉 任务轨迹已成功沉淀并优化为 Recipe: "${saved.name}"`);
        console.log(`📝 步骤数量: ${saved.stepCount} 步`);
        if (saved.variables.length > 0) {
          console.log(`🔧 提取参数: ${saved.variables.map((v) => `{{${v}}}`).join(', ')}`);
        }
        console.log(`💡 下次可直接运行: lite-browser recipe run ${name}\n`);
        break;
      }

      // Recipe 子命令集
      case 'recipe': {
        const sub = args[1];
        if (sub === 'list') {
          const list = recipeEngine.listRecipes();
          console.log(`\n📦 已沉淀的 Recipe (${list.length} 个):`);
          console.log('────────────────────────────────────────────────────────');
          for (const item of list) {
            console.log(`• ${item.name.padEnd(20)} [${item.stepCount} 步] ${item.description}`);
            if (item.variables.length > 0) {
              console.log(`    参数: ${item.variables.join(', ')}`);
            }
          }
          console.log('────────────────────────────────────────────────────────\n');
        } else if (sub === 'show') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 Recipe 名称。例如: lite-browser recipe show "baidu-search"');
            process.exit(1);
          }
          const rec = recipeEngine.getRecipe(name);
          console.log(JSON.stringify(rec, null, 2));
        } else if (sub === 'delete') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 Recipe 名称。');
            process.exit(1);
          }
          recipeEngine.deleteRecipe(name);
          console.log(`✅ 已删除 Recipe: ${name}`);
        } else if (sub === 'run') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 Recipe 名称。例如: lite-browser recipe run "baidu-search"');
            process.exit(1);
          }

          // 解析传入变量 (例如 --var input_1="广州天气")
          const vars: Record<string, string> = {};
          for (let i = 3; i < args.length; i++) {
            if (args[i] === '--var' && args[i + 1]) {
              const pair = args[i + 1];
              const eqIdx = pair.indexOf('=');
              if (eqIdx > 0) {
                const k = pair.slice(0, eqIdx);
                const v = pair.slice(eqIdx + 1);
                vars[k] = v;
              }
              i++;
            }
          }

          const rec = recipeEngine.getRecipe(name);
          console.log(`⚡ 开始执行 Recipe "${name}" (${rec.stepCount} 步)...`);
          const browser = await BrowserActions.connectToSession();

          for (const step of rec.steps) {
            console.log(`  [${step.step}/${rec.stepCount}] ${step.description || step.action}...`);
            if (step.action === 'open' && step.url) {
              await browser.open(step.url);
            } else if (step.action === 'click' && step.target) {
              await browser.click(step.target);
            } else if (step.action === 'type' && step.target) {
              let textToType = step.text || step.defaultText || '';
              // 替换变量
              for (const [k, v] of Object.entries(vars)) {
                textToType = textToType.replaceAll(`{{${k}}}`, v);
              }
              await browser.type(step.target, textToType);
            } else if (step.action === 'scroll') {
              await browser.scroll(step.direction, step.amount);
            } else if (step.action === 'wait') {
              await browser.wait(step.seconds || 1);
            }
          }
          console.log(`\n🎉 Recipe "${name}" 执行完成！(确定性直达，零大模型开销)\n`);
        } else {
          console.error(`❌ 未知 recipe 子命令: ${sub}。支持: list, show, run, delete`);
        }
        break;
      }

      default:
        console.error(`❌ 未知命令: ${command}\n`);
        console.log(USAGE.trim());
        process.exit(1);
    }

    process.exit(0);
  } catch (err: any) {
    console.error(`\n💥 执行失败: ${err.message}\n`);
    process.exit(1);
  }
}

main();
