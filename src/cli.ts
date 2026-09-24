#!/usr/bin/env bun
/**
 * cli.ts —— lite-browser CLI 入口
 * 专为 AI Agent 与极速自动化设计的轻量级浏览器操控终端 (v1.1.0)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { ChromeManager } from './chrome.js';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { TaskEngine } from './task.js';
import { CookieManager } from './cookie.js';
import { McpServer } from './mcp.js';

const USAGE = `
🚀 lite-browser —— 极致轻量、零常驻、具身自进化的自研浏览器操控工具 (v1.1.0)

基础操作:
  lite-browser open <url> [flags]          打开网页建立会话 (默认有头，支持持久化 profile)
      [--headless]                         使用无头模式
      [--profile <name>]                   指定持久化 profile 标识 (默认 "default")
      [--temp]                             使用临时临时会话 (退出后不持久化)
  lite-browser snapshot [--json]           提取页面可交互元素并进行 [@1] 编号
  lite-browser click <@id|selector>        点击指定元素（支持 @编号 或 CSS 选择器）
  lite-browser type <@id|selector> <text>  在指定元素中键入文本
  lite-browser hover <@id|selector>        悬停在指定元素上方以触发下拉菜单或状态
  lite-browser press <key>                 按下特殊按键（Enter, Tab, Escape, Backspace 等）
  lite-browser select <@id|sel> <val>      在下拉选择框 (<select>) 中选取指定值
  lite-browser upload <@id|sel> <file...>  上传一个或多个本地文件至文件输入框
  lite-browser scroll [up|down] [px]       页面平滑滚动（默认向下 400px）
  lite-browser wait [seconds]              等待指定秒数（默认 1 秒）
  lite-browser screenshot [path]           全屏/当前视口截图（默认存至 /tmp）
  lite-browser eval "<code>"               在页面控制台执行 JavaScript
  lite-browser cdp <method> [jsonParams]   向 Chrome 发送底层 CDP 协议命令
  lite-browser close                       断开连接并清理会话

SOP 智能沉淀、自进化与团队共享:
  lite-browser done --name <name> [flags]  沉淀轨迹为 SOP，若已存在则自动版本升级与自愈
      [--desc <desc>]                      SOP 描述
      [--intent <intent>]                  触发意图关键词（例如 "发布掘金"）
      [--domain <domain>]                  适用主域名（例如 "juejin.cn"）
      [--scope <global|project>]           存储作用域 (global: ~/.lite-browser, project: ./.lite-browser)
      [--frequency <freq>]                 调度频次 (manual|daily|weekly|hourly)
      [--cron <cron>]                      Cron 定时表达式
      [--reason <reason>]                  本次修改/自愈原因说明

  lite-browser sop list                    列出全部 SOP、版本、作用域、执行频次与命中规则
  lite-browser sop match <url|intent>      根据当前 URL 或任务意图智能匹配最适配的 SOP
  lite-browser sop show <name>             查看指定 SOP 的完整元数组与步骤定义
  lite-browser sop run <name> [args]       以确定性执行 SOP 并自动记录频次与成功率
      [--var <key>=<val>]                  传入参数变量（如 --var input_1="我的文章"）
      [--headless]                         以无头模式运行 SOP
  lite-browser sop schedule <name> [flags] 更新 SOP 的调度策略与频次
  lite-browser sop export <name> [--file]  导出 SOP 为格式化 JSON 规范
  lite-browser sop import <file> [flags]   导入团队共享的 SOP 规范文件 (--scope global|project)
  lite-browser sop validate <name|file>    校验 SOP 契约与步骤定义的合法性
  lite-browser sop delete <name>           删除指定 SOP

任务委派与后台执行:
  lite-browser delegate <name> [flags]     将 SOP 委派至后台异步执行，立即返回任务 ID
      [--var <key>=<val>]                  传入参数变量
      [--headless]                         后台以无头运行（默认 true）
  lite-browser task list [--limit <N>]     查看最近委派任务执行清单与状态
  lite-browser task status <id>            查看委派任务详情与执行结果
  lite-browser task logs <id> [--tail <N>] 查看委派任务的标准输出与错误日志

Cookie 与 Profile 管理:
  lite-browser cookie export [domain]      导出当前会话的 Cookies [--out <path>]
  lite-browser cookie import <file>        将 Cookie 文件导入当前会话
  lite-browser cookie clear                清理当前会话的 Cookies
  lite-browser profile list                列出所有持久化的用户 Profile

AI 插件化扩展服务:
  lite-browser mcp                         启动 Model Context Protocol (MCP) STDIO 服务
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE.trim());
    return;
  }

  const recipeEngine = new RecipeEngine();
  const taskEngine = new TaskEngine();

  try {
    switch (command) {
      // 内部 Worker 入口
      case '_task_worker': {
        const taskId = args[1];
        const sopName = args[2];
        const varsJson = args[3] || '{}';
        const headless = args.includes('--headless');
        const vars = JSON.parse(varsJson);
        await taskEngine.runWorker(taskId, sopName, vars, headless);
        process.exit(0);
      }

      // MCP 服务入口
      case 'mcp': {
        const server = new McpServer();
        server.start();
        return;
      }

      case 'open': {
        const url = args[1];
        if (!url) {
          console.error('❌ 请提供目标 URL。例如: lite-browser open https://github.com');
          process.exit(1);
        }
        const headless = args.includes('--headless');
        const temp = args.includes('--temp');
        let profile = 'default';
        const profIdx = args.indexOf('--profile');
        if (profIdx >= 0 && args[profIdx + 1]) {
          profile = args[profIdx + 1];
        }

        console.log(`🌐 正在打开 ${url} (无头模式: ${headless ? '是' : '否'}, Profile: ${temp ? '临时' : profile})...`);
        const browser = await BrowserActions.launchOrConnect({ url, headless, profile, temp });
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

      case 'hover': {
        const target = args[1];
        if (!target) {
          console.error('❌ 请指定要悬停的目标。例如: lite-browser hover @1');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        const res = await browser.hover(target);
        console.log(`✅ 悬停成功: ${target} (x:${res.x}, y:${res.y})`);
        break;
      }

      case 'press': {
        const key = args[1];
        if (!key) {
          console.error('❌ 请指定要按下的按键。例如: lite-browser press Enter');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        await browser.press(key);
        console.log(`✅ 按键已触发: ${key}`);
        break;
      }

      case 'select': {
        const target = args[1];
        const value = args[2];
        if (!target || value === undefined) {
          console.error('❌ 参数不全。例如: lite-browser select @1 "option_value"');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        await browser.select(target, value);
        console.log(`✅ 下拉选取完成: ${target} → "${value}"`);
        break;
      }

      case 'upload': {
        const target = args[1];
        const files = args.slice(2);
        if (!target || files.length === 0) {
          console.error('❌ 参数不全。例如: lite-browser upload @1 /path/to/file.png');
          process.exit(1);
        }
        const browser = await BrowserActions.connectToSession();
        await browser.upload(target, files);
        console.log(`✅ 文件上传设置完成: ${files.join(', ')} → ${target}`);
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
          console.error('❌ 请提供 CDP 方法名。例如: lite-browser cdp Page.getLayoutMetrics');
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
        let scope: 'global' | 'project' | undefined;
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
          } else if (args[i] === '--scope' && args[i + 1]) {
            scope = args[++i] as any;
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
          scope,
          frequency,
          cron,
          reason,
        });

        console.log(`\n🎉 SOP "${saved.name}" (v${saved.version}) 沉淀/更新成功！[作用域: ${saved.scope || 'global'}]`);
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
            const scopeTag = item.scope === 'project' ? ' [项目级]' : ' [全局]';
            const runs = `运行:${item.schedule?.runCount || 0}次 成功:${item.schedule?.successCount || 0}次`;
            console.log(`• ${item.name.padEnd(20)} v${v.padEnd(6)}${scopeTag.padEnd(10)} [${item.stepCount}步] [频次:${item.schedule?.frequency || 'manual'}] (${runs})`);
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
            console.log(`\n🎯 命中 SOP: "${res.matched.name}" (v${res.matched.version}) [作用域: ${res.matched.scope || 'global'}] [置信度: ${Math.round(res.score * 100)}%]`);
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
        } else if (sub === 'export') {
          const name = args[2];
          if (!name) {
            console.error('❌ 请指定要导出的 SOP 名称。例如: lite-browser sop export "juejin-publish"');
            process.exit(1);
          }
          const exportedJson = recipeEngine.exportSOP(name);
          const outIdx = args.indexOf('--file');
          if (outIdx >= 0 && args[outIdx + 1]) {
            writeFileSync(args[outIdx + 1], exportedJson);
            console.log(`✅ 已将 SOP "${name}" 导出至文件: ${args[outIdx + 1]}`);
          } else {
            console.log(exportedJson);
          }
        } else if (sub === 'import') {
          const file = args[2];
          if (!file) {
            console.error('❌ 请提供要导入的 SOP 文件路径。例如: lite-browser sop import ./juejin-publish.json');
            process.exit(1);
          }
          const scopeIdx = args.indexOf('--scope');
          const targetScope: 'global' | 'project' = scopeIdx >= 0 && args[scopeIdx + 1] === 'project' ? 'project' : 'global';
          const content = readFileSync(file, 'utf-8');
          const imported = recipeEngine.importSOP(content, targetScope);
          console.log(`✅ 成功导入 SOP "${imported.name}" (v${imported.version}) 至 [${targetScope}] 空间！`);
        } else if (sub === 'validate') {
          const target = args[2];
          if (!target) {
            console.error('❌ 请提供要校验的 SOP 名称或文件路径。');
            process.exit(1);
          }
          let sopObj: any;
          try {
            sopObj = recipeEngine.getRecipe(target);
          } catch (_) {
            sopObj = JSON.parse(readFileSync(target, 'utf-8'));
          }
          const check = recipeEngine.validateSOP(sopObj);
          if (check.valid) {
            console.log(`✅ SOP "${sopObj.name}" 格式合法，包含 ${sopObj.steps?.length || 0} 个步骤。`);
          } else {
            console.error(`❌ SOP 校验未通过:\n  - ${check.errors.join('\n  - ')}`);
            process.exit(1);
          }
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

          const vars: Record<string, string> = {};
          const headless = args.includes('--headless');

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
          const browser = await BrowserActions.launchOrConnect({ headless });

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
              } else if (step.action === 'hover' && step.target) {
                await browser.hover(step.target);
              } else if (step.action === 'press' && step.key) {
                await browser.press(step.key);
              } else if (step.action === 'select' && step.target && step.value) {
                await browser.select(step.target, step.value);
              } else if (step.action === 'upload' && step.target && step.files) {
                await browser.upload(step.target, step.files);
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
          console.error(`❌ 未知 sop 子命令: ${sub}。支持: list, match, show, run, schedule, export, import, validate, delete`);
        }
        break;
      }

      // 任务委派指令
      case 'delegate': {
        const sopName = args[1];
        if (!sopName) {
          console.error('❌ 请指定要委派的 SOP 名称。例如: lite-browser delegate "juejin-publish"');
          process.exit(1);
        }

        const vars: Record<string, string> = {};
        const headless = !args.includes('--headed');

        for (let i = 2; i < args.length; i++) {
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

        const task = taskEngine.delegate(sopName, { variables: vars, headless });
        console.log(`\n🚀 任务已成功委派至后台运行！`);
        console.log(`🆔 任务 ID: ${task.id}`);
        console.log(`📦 目标 SOP: ${task.sopName}`);
        console.log(`📄 运行日志: ${task.logFile}`);
        console.log(`💡 查询进度: lite-browser task status ${task.id}`);
        console.log(`💡 查看日志: lite-browser task logs ${task.id}\n`);
        break;
      }

      // 任务状态与历史审查
      case 'task': {
        const sub = args[1];
        if (!sub || sub === 'list') {
          const limitIdx = args.indexOf('--limit');
          const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;
          const tasks = taskEngine.getAllTasks().slice(0, limit);

          console.log(`\n📋 后台委派任务列表 (${tasks.length} 条):`);
          console.log('────────────────────────────────────────────────────────────────────────────────────────');
          for (const t of tasks) {
            const statusIcon =
              t.status === 'completed' ? '✅ 成功' :
              t.status === 'failed' ? '❌ 失败' :
              t.status === 'running' ? '⏳ 运行中' : '⏸️ 待处理';
            const dur = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : '-';
            console.log(`• ${t.id.padEnd(26)} [${t.sopName.padEnd(16)}] ${statusIcon.padEnd(8)} (耗时: ${dur}) 起始: ${t.startTime.slice(0, 19).replace('T', ' ')}`);
          }
          console.log('────────────────────────────────────────────────────────────────────────────────────────\n');
        } else if (sub === 'status') {
          const id = args[2];
          if (!id) {
            console.error('❌ 请提供任务 ID。');
            process.exit(1);
          }
          const task = taskEngine.getTask(id);
          if (!task) {
            console.error(`❌ 未找到任务: ${id}`);
            process.exit(1);
          }
          console.log(JSON.stringify(task, null, 2));
        } else if (sub === 'logs') {
          const id = args[2];
          if (!id) {
            console.error('❌ 请提供任务 ID。');
            process.exit(1);
          }
          const tailIdx = args.indexOf('--tail');
          const tail = tailIdx >= 0 ? parseInt(args[tailIdx + 1], 10) : 50;
          const logs = taskEngine.getTaskLogs(id, tail);
          console.log(logs);
        } else {
          console.error(`❌ 未知 task 子命令: ${sub}。支持: list, status, logs`);
        }
        break;
      }

      // Cookie 管理指令
      case 'cookie': {
        const sub = args[1];
        if (sub === 'export') {
          const domain = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
          const outIdx = args.indexOf('--out');
          const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;
          const res = await CookieManager.export({ domain, outFile });
          if (outFile) {
            console.log(`✅ 已导出 ${res.count} 条 Cookies 至 ${outFile}`);
          } else {
            console.log(JSON.stringify(res.cookies, null, 2));
          }
        } else if (sub === 'import') {
          const file = args[2];
          if (!file) {
            console.error('❌ 请提供 Cookie JSON 文件路径。');
            process.exit(1);
          }
          const res = await CookieManager.import(file);
          console.log(`✅ 成功导入 ${res.count} 条 Cookies`);
        } else if (sub === 'clear') {
          await CookieManager.clear();
          console.log('✅ 已清除当前会话的所有 Cookies');
        } else {
          console.error(`❌ 未知 cookie 子命令: ${sub}。支持: export, import, clear`);
        }
        break;
      }

      // Profile 管理指令
      case 'profile': {
        const sub = args[1];
        if (!sub || sub === 'list') {
          const profiles = ChromeManager.listProfiles();
          console.log(`\n👤 已配置的用户 Profiles (${profiles.length} 个):`);
          for (const p of profiles) {
            console.log(`• ${p}`);
          }
          console.log('');
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
