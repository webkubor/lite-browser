#!/usr/bin/env bun
/**
 * cli.ts —— lite-browser CLI 入口
 * 专为 AI Agent 与极速自动化设计的轻量级浏览器操控终端 (1.0 MVP)
 */

import { ChromeManager } from './chrome.js';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';

const USAGE = `
🚀 lite-browser —— 极致轻量、零常驻、具身自进化的自研浏览器操控工具 (v1.0.0)

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

SOP 智能沉淀与自进化引擎:
  lite-browser done --name <name> [flags]  沉淀轨迹为 SOP，若已存在则自动版本升级与自愈
      [--desc <desc>]                      SOP 描述
      [--intent <intent>]                  触发意图关键词（例如 "发布掘金"）
      [--domain <domain>]                  适用主域名（例如 "juejin.cn"）
      [--frequency <freq>]                 调度频次 (manual|daily|weekly|hourly)
      [--cron <cron>]                      Cron 定时表达式
      [--reason <reason>]                  本次修改/自愈原因说明

  lite-browser sop list                    列出全部 SOP、版本、执行频次与命中规则
  lite-browser sop match <url|intent>      根据当前 URL 或任务意图智能匹配最适配的 SOP
  lite-browser sop show <name>             查看指定 SOP 的完整元数组与步骤定义
  lite-browser sop run <name> [args]       以确定性执行 SOP 并自动记录频次与成功率
      [--var <key>=<val>]                  传入参数变量（如 --var input_1="我的文章"）
  lite-browser sop schedule <name> [flags] 更新 SOP 的调度策略与频次
  lite-browser sop delete <name>           删除指定 SOP

兼容别名:
  lite-browser recipe <list|show|run|delete> 等同于 lite-browser sop
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
        console.log(`🌐 正在打开 ${url} (无头模式: ${headless ? '是' : '否'})...`);
        const browser = await BrowserActions.launchOrConnect({ url, headless });
        const title = await browser.getTitle();
        console.log(`✅ 页面已就绪: "${title}" (${url})`);
        break;
      }

      case 'snapshot': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.snapshot();
        if (args.includes('--json')) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(res.formatted);
        }
        break;
      }

      case 'click': {
        const target = args[1];
        if (!target) {
          console.error('❌ 请指定要点击的目标。例如: lite-browser click @1 或 lite-browser click "button.submit"');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        const res = await browser.click(target);
        console.log(`✅ 点击成功: ${target} (x:${res.x}, y:${res.y})`);
        break;
      }

      case 'type': {
        const target = args[1];
        const text = args.slice(2).join(' ');
        if (!target || text === undefined) {
          console.error('❌ 参数不全。例如: lite-browser type @1 "Hello World"');
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

      case 'cdp': {
        const method = args[1];
        if (!method) {
          console.error('❌ 请提供 CDP 方法名。例如: lite-browser cdp Page.getLayoutMetrics 或 lite-browser cdp Network.getCookies');
          process.exit(1);
        }
        let params: Record<string, any> = {};
        if (args[2]) {
          try {
            params = JSON.parse(args.slice(2).join(' '));
          } catch (e: any) {
            console.error(`❌ 参数必须是合法的 JSON 对象: ${e.message}`);
            process.exit(1);
          }
        }
        const browser = await BrowserActions.connectToSession();
        const res = await browser.cdp(method, params);
        console.log(JSON.stringify(res, null, 2));
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

      // 任务沉淀与自愈更新指令
      case 'done': {
        let name = '';
        let desc = '';
        let intent = '';
        let domain = '';
        let frequency = 'manual';
        let cron = '';
        let reason = '';

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--name' && args[i + 1]) {
            name = args[++i];
          } else if (args[i] === '--desc' && args[i + 1]) {
            desc = args[++i];
          } else if (args[i] === '--intent' && args[i + 1]) {
            intent = args[++i];
          } else if (args[i] === '--domain' && args[i + 1]) {
            domain = args[++i];
          } else if (args[i] === '--frequency' && args[i + 1]) {
            frequency = args[++i];
          } else if (args[i] === '--cron' && args[i + 1]) {
            cron = args[++i];
          } else if (args[i] === '--reason' && args[i + 1]) {
            reason = args[++i];
          }
        }

        if (!name) {
          console.error('❌ 请为沉淀的任务指定名称。例如: lite-browser done --name "juejin-publish"');
          process.exit(1);
        }

        const saved = recipeEngine.saveOrUpdate({
          name,
          description: desc,
          intent,
          domain,
          frequency,
          cron,
          reason,
        });

        console.log(`\n🎉 SOP "${saved.name}" (v${saved.version}) 沉淀/更新成功！`);
        console.log(`📝 步骤数量: ${saved.stepCount} 步`);
        console.log(`🔄 运行统计: 累计执行 ${saved.schedule?.runCount || 0} 次 (成功: ${saved.schedule?.successCount || 0})`);
        if (saved.match) {
          console.log(`🎯 匹配规则: [域名: ${saved.match.domains.join(', ') || '任意'}] [意图: ${saved.match.intents.join(', ') || '任意'}]`);
        }
        if (saved.parameters && saved.parameters.length > 0) {
          console.log(`🔧 动态参数: ${saved.parameters.map((p) => `{{${p.name}}}`).join(', ')}`);
        }
        console.log(`💡 下次可直接匹配或运行: lite-browser sop run ${name}\n`);
        break;
      }

      // SOP 与 Recipe 指令集
      case 'sop':
      case 'recipe': {
        const sub = args[1];
        if (!sub || sub === 'list') {
          const list = recipeEngine.listSOPs();
          console.log(`\n📦 已沉淀的标准 SOP 列表 (${list.length} 个):`);
          console.log('────────────────────────────────────────────────────────────────────────');
          for (const item of list) {
            const v = item.version || '1.0.0';
            const runs = `运行:${item.schedule?.runCount || 0}次 成功:${item.schedule?.successCount || 0}次`;
            console.log(`• ${item.name.padEnd(20)} v${v.padEnd(6)} [${item.stepCount}步] [频次:${item.schedule?.frequency || 'manual'}] (${runs})`);
            if (item.match && item.match.intents?.length > 0) {
              console.log(`    🎯 意图: ${item.match.intents.join(', ')}`);
            }
            if (item.parameters && item.parameters.length > 0) {
              console.log(`    🔧 参数: ${item.parameters.map((p) => p.name).join(', ')}`);
            }
          }
          console.log('────────────────────────────────────────────────────────────────────────\n');
        } else if (sub === 'match') {
          const queryStr = args.slice(2).join(' ');
          if (!queryStr) {
            console.error('❌ 请提供匹配上下文。例如: lite-browser sop match "https://juejin.cn/editor" 或 lite-browser sop match "发布掘金"');
            process.exit(1);
          }

          let url: string | undefined;
          let intent: string | undefined;
          let domain: string | undefined;

          if (queryStr.startsWith('http://') || queryStr.startsWith('https://')) {
            url = queryStr;
            try {
              domain = new URL(queryStr).hostname;
            } catch (_) {}
          } else {
            intent = queryStr;
          }

          const res = recipeEngine.matchSOP({ url, intent, domain });
          if (res.matched) {
            console.log(`\n🎯 命中 SOP: "${res.matched.name}" (v${res.matched.version}) [置信度: ${res.score * 100}%]`);
            console.log(`📝 匹配依据: ${res.reason}`);
            console.log(`💡 可直接执行: lite-browser sop run ${res.matched.name}\n`);
          } else {
            console.log(`\n⚠️  未匹配到现成 SOP (${res.reason})，需要由 Agent 首次探索并用 lite-browser done 沉淀。\n`);
          }
        } else if (sub === 'show') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 SOP 名称。例如: lite-browser sop show "juejin-publish"');
            process.exit(1);
          }
          const rec = recipeEngine.getRecipe(name);
          console.log(JSON.stringify(rec, null, 2));
        } else if (sub === 'delete') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 SOP 名称。');
            process.exit(1);
          }
          recipeEngine.deleteRecipe(name);
          console.log(`✅ 已删除 SOP: ${name}`);
        } else if (sub === 'schedule') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 SOP 名称。例如: lite-browser sop schedule "juejin-publish" --frequency daily');
            process.exit(1);
          }
          let freq = 'manual';
          let cron: string | undefined;
          for (let i = 3; i < args.length; i++) {
            if (args[i] === '--frequency' && args[i + 1]) {
              freq = args[++i];
            } else if (args[i] === '--cron' && args[i + 1]) {
              cron = args[++i];
            }
          }
          const updated = recipeEngine.updateSchedule(name, { frequency: freq, cron });
          console.log(`✅ SOP "${name}" 调度配置已更新: 频次=${updated.schedule.frequency}${cron ? ` (cron: ${cron})` : ''}`);
        } else if (sub === 'run') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定 SOP 名称。例如: lite-browser sop run "juejin-publish"');
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
          console.log(`⚡ 开始执行 SOP "${name}" (v${rec.version || '1.0.0'}, ${rec.stepCount} 步)...`);
          const browser = await BrowserActions.connectToSession();

          try {
            for (const step of rec.steps) {
              console.log(`  [${step.step}/${rec.stepCount}] ${step.description || step.action}...`);
              if (step.action === 'open' && step.url) {
                await browser.open(step.url);
              } else if (step.action === 'click' && step.target) {
                await browser.click(step.target);
              } else if (step.action === 'type' && step.target) {
                let textToType = step.text || step.defaultText || '';
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

            recipeEngine.recordRun(name, true);
            console.log(`\n🎉 SOP "${name}" 执行成功！(自动更新统计: 成功率+1)\n`);
          } catch (execErr: any) {
            recipeEngine.recordRun(name, false);
            console.error(`\n❌ SOP "${name}" 在执行过程中出现异常: ${execErr.message}`);
            console.log(`💡 提示: 可通过手动修正操作后执行 "lite-browser done --name ${name} --reason '修复某步骤'" 完成自愈更新。\n`);
            process.exit(1);
          }
        } else {
          console.error(`❌ 未知 sop 子命令: ${sub}。支持: list, match, show, run, schedule, delete`);
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
