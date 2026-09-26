#!/usr/bin/env bun
/**
 * cli.ts —— lite-browser CLI 入口
 * 专为 AI Agent 与极速自动化设计的轻量级浏览器操控终端
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ChromeManager } from './chrome.js';
import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { TaskEngine } from './task.js';
import { CookieManager } from './cookie.js';
import { McpServer } from './mcp.js';
import { SessionRegistry } from './registry.js';
import { buildSessionStatus } from './status.js';
import { executeSteps, needsBrowser, runExecStep } from './runner.js';
import { discoverAssets } from './discover.js';
import {
  EXIT_AWAITING_HUMAN,
  EXIT_AWAIT_TIMEOUT,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  authStateLabel,
  formatElapsed,
  renderHandoffCard,
  renderStatusLine,
} from './handoff.js';

const VERSION = '1.4.0';

const USAGE = `
🚀 lite-browser —— 极致轻量、零常驻、具身自进化的自研浏览器操控工具 (v${VERSION})

⭐ 交接协议 (Agent 与人类怎么对接，先看这三条):
  lite-browser status [--json]             唯一状态真源：当前相位 / 在等谁 / 下一步该做什么
  lite-browser await-human [flags]         阻塞等待人类完成登录或授权，返回机器可读结果
      [--timeout <秒>]                     最长等待时间 (默认 300)
      [--poll <秒>]                        轮询间隔 (默认 3)
      [--json]                             输出 JSON
  lite-browser resume                      人类处理完后恢复流程，清除等待态

  退出码契约: 0=正常  1=执行错误  2=参数错误  3=需要人类介入  4=等待人类超时
  相位 (phase): idle | navigating | acting | awaiting_human | blocked | completed

基础操作:
  lite-browser open <url> [flags]          打开网页建立会话 (默认有头，支持持久化 profile)
      [--headless]                         使用无头模式
      [--profile <name>]                   指定持久化 profile 标识 (默认 "default")
      [--temp]                             使用临时临时会话 (退出后不持久化)
  lite-browser snapshot [--json]           提取页面可交互元素并进行 [@1] 编号
  lite-browser click <@id|selector>        点击指定元素（支持 @编号 或 CSS 选择器）
  lite-browser type <@id|selector> <text>  在指定元素中键入文本 (支持富文本与多行输入)
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

多 Agent 身份感知、端口隔离与免登录复用:
  lite-browser whoami                      等价于 status：诊断身份、端口、Profile 与登录态
  lite-browser session list                列出所有注册的 Agent 会话、端口、PID 与登录域
  lite-browser session clean               检测并清理已退出的失效/离线会话
  lite-browser session remove <agent|port> 从注册表中移除指定 Agent 或端口记录
  lite-browser session mark-login <domain> 人工确认「该域名已登录」，登记为 verified
                                            (verified 才会被 --reuse 采信；仅访问过只算 visited)

SOP 智能沉淀、自进化与团队共享:
  lite-browser exec -- <命令> [参数...]      执行外部脚本并**记入轨迹**，让自研脚本的
                                            工作也能被 done 自动沉淀（直连 CDP 的脚本
                                            沉淀引擎是看不见的）
  lite-browser done --name <name> [flags]  沉淀轨迹为 SOP，若已存在则自动版本升级与自愈
      [--desc <desc>]                      SOP 描述
      [--intent <intent>]                  触发意图关键词（例如 "发布掘金"）
      [--domain <domain>]                  适用主域名（例如 "juejin.cn"）
      [--scope <global|project>]           存储作用域 (global: ~/.lite-browser, project: ./.lite-browser)
      [--frequency <freq>]                 调度频次 (manual|daily|weekly|hourly)
      [--cron <cron>]                      Cron 定时表达式
      [--reason <reason>]                  本次修改/自愈原因说明

  lite-browser sop list [--json]           列出已沉淀 SOP；并自动扫描项目里的 sop/*.md
                                            与 scripts/* 资产（发现 ≠ 登记，只让它可见）
      [--no-scan]                          跳过项目资产扫描
  lite-browser sop match <url|intent>      根据当前 URL 或任务意图智能匹配最适配的 SOP
  lite-browser sop show <name>             查看指定 SOP 的完整元数组与步骤定义
  lite-browser sop run <name> [args]       以确定性执行 SOP 并自动记录频次与成功率
      [--var <key>=<val>]                  传入参数变量（如 --var input_1="我的文章"）
      [--headless]                         以无头模式运行 SOP
      [--dry-run]                          只打印将要执行的步骤，含 exec 的 SOP 建议先跑这个
  lite-browser sop adopt <name> --script <路径>  一次性收编已写好的外部脚本为 SOP
      [--intent <意图>] [--domain <域名>] [--desc <描述>]
  lite-browser sop schedule <name> [flags] 更新 SOP 的调度策略与频次
  lite-browser sop export <name> [--file]  导出 SOP 为格式化 JSON 规范
  lite-browser sop import <file> [flags]   导入团队共享的 SOP 规范文件 (--scope global|project)
  lite-browser sop validate <name|file>    校验 SOP 契约与步骤定义的合法性
  lite-browser sop delete <name>           删除指定 SOP

任务委派与后台执行:
  lite-browser delegate <name> [flags]     将 SOP 委派至后台异步执行，立即返回任务 ID
      [--var <key>=<val>]                  传入参数变量
      [--headless]                         后台以无头运行（默认 true）
      [--await-human <秒>]                 撞到登录墙时原地等待人类的秒数 (默认 600)
  lite-browser task list [--limit <N>]     查看最近委派任务执行清单与状态
  lite-browser task status <id>            查看委派任务详情与执行结果
  lite-browser task logs <id> [--tail <N>] 查看委派任务的标准输出与错误日志
  lite-browser task retry <id>             人类完成登录后，用同样参数重新委派该 SOP

Cookie 与 Profile 管理:
  lite-browser cookie export [domain]      导出当前会话的 Cookies [--out <path>]
  lite-browser cookie import <file>        将 Cookie 文件导入当前会话
  lite-browser cookie pull-system [domain] 从系统 Chrome 安全解密提取并注入 Cookies (免输密码)
  lite-browser cookie clear                清理当前会话的 Cookies
  lite-browser profile list                列出所有持久化的用户 Profile


AI 插件化扩展服务:
  lite-browser mcp                         启动 Model Context Protocol (MCP) STDIO 服务

版本:
  lite-browser version                     打印版本号 (等价于 --version / -v，支持 --json)

全局参数修饰 (可在任意命令中附加):
  [--agent <name>]                         显式指定当前调用 Agent 身份 (如 gemini, claude-code, codex)
  [--port <number>]                        显式绑定指定 CDP 调试端口
  [--reuse]                                跨 Agent 复用**已确认**的登录态 (免扫码重复登录)

接管已有浏览器 profile (open 命令):
  [--user-data-dir <path>]                 直接接管已有的 Chromium user-data-dir，
                                           不改动、不迁移其中的登录态
                                           (例: "~/Library/Application Support/Citro Labs/ego lite")
  [--profile-directory <name>]             在该 user-data-dir 里选子 profile
                                           (Chromium 原生语义: Default / "Profile 1" …)
  说明: --profile <name> 用的是 lite-browser 自己的独立 profile 目录
        (~/.lite-browser/profiles/<name>)；--user-data-dir 是接管别人的目录。
        想复用某个浏览器里**已经登录好**的账号，用后者。
`;

async function main() {
  const rawArgs = process.argv.slice(2);
  let explicitAgent: string | undefined;
  let explicitPort: number | undefined;
  let explicitUserDataDir: string | undefined;
  let explicitProfileDirectory: string | undefined;
  let reuse = false;

  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--agent' && rawArgs[i + 1]) {
      explicitAgent = rawArgs[++i];
    } else if (rawArgs[i] === '--port' && rawArgs[i + 1]) {
      explicitPort = parseInt(rawArgs[++i], 10);
    } else if (rawArgs[i] === '--user-data-dir' && rawArgs[i + 1]) {
      explicitUserDataDir = rawArgs[++i];
    } else if (rawArgs[i] === '--profile-directory' && rawArgs[i + 1]) {
      explicitProfileDirectory = rawArgs[++i];
    } else if (rawArgs[i] === '--reuse') {
      reuse = true;
    } else {
      args.push(rawArgs[i]);
    }
  }

  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    console.log(USAGE.trim());
    return;
  }

  const recipeEngine = new RecipeEngine();
  const taskEngine = new TaskEngine();

  // 轨迹必须记在「做这件事的 Agent」名下，多 Agent 并行才不会互相污染。
  // 进程内所有 recordAction / getTrajectory（含 done 的沉淀）都读同一个身份。
  RecipeEngine.setActor(SessionRegistry.detectCurrentAgent(explicitAgent));

  const getSessionClient = async () => {
    return await BrowserActions.connectToSession(explicitPort || explicitAgent);
  };

  try {
    switch (command) {
      /**
       * exec —— 让自研脚本的调用进入轨迹。
       *
       * 这是「每次执行完任务自动落成 SOP」对脚本类工作成立的前提：
       * 脚本自己直连 CDP 时，沉淀引擎看不见任何东西；经由这里调用才会被记录，
       * 之后 `lite-browser done` 才能把它沉淀成 SOP。
       */
      case 'exec': {
        const raw = process.argv.slice(2);
        const ddIdx = raw.indexOf('--');
        if (ddIdx < 0 || ddIdx === raw.length - 1) {
          console.error('❌ 用法: lite-browser exec -- <命令> [参数...]');
          console.error('   例如: lite-browser exec -- node scripts/twitter-poster.mjs check');
          process.exit(EXIT_USAGE);
        }
        const commandParts = raw.slice(ddIdx + 1);
        const [cmd, ...cmdArgs] = commandParts;

        console.log(`▶ exec: ${commandParts.join(' ')}`);

        let exitCode = 0;
        try {
          await runExecStep({ step: 0, action: 'exec', command: cmd, args: cmdArgs }, {}, process.cwd());
        } catch (err: any) {
          exitCode = 1;
          console.error(`❌ ${err.message}`);
        }

        // 无论成败都记录：失败的步骤同样是有价值的信息（自愈时会用到）
        RecipeEngine.recordAction({
          type: 'exec',
          command: cmd,
          args: cmdArgs,
          exitCode,
          targetDescription: commandParts.join(' '),
        });

        if (exitCode === 0) {
          console.log(`✅ 已执行并记入轨迹（Agent: ${RecipeEngine.currentActor()}）。`);
          console.log(`   沉淀成 SOP: lite-browser done --name <name> --intent "<触发意图>"`);
        }
        process.exit(exitCode === 0 ? EXIT_OK : EXIT_ERROR);
      }

      // 内部 Worker 入口
      case '_task_worker': {
        const taskId = args[1];
        const sopName = args[2];
        const varsJson = args[3] || '{}';
        const headless = args.includes('--headless');
        const vars = JSON.parse(varsJson);
        try {
          await taskEngine.runWorker(taskId, sopName, vars, headless);
        } catch (err: any) {
          if (err?.name === 'AwaitingHumanTimeoutError') {
            // 等待人类超时不是崩溃，用约定的退出码表达，不打印堆栈误导人
            process.exit(EXIT_AWAIT_TIMEOUT);
          }
          throw err;
        }
        process.exit(EXIT_OK);
      }

      // MCP 服务入口
      case 'mcp': {
        const server = new McpServer();
        server.start();
        return;
      }

      // Agent 身份诊断与会话洞察（whoami 是 status 的别名，保持向后兼容）
      case 'whoami':
      case 'status': {
        const detectedAgent = SessionRegistry.detectCurrentAgent(explicitAgent);
        const registry = new SessionRegistry();
        const asJson = args.includes('--json');
        const status = await buildSessionStatus(explicitPort || explicitAgent, { live: !args.includes('--no-probe') });

        if (status) {
          if (asJson) {
            console.log(JSON.stringify(status, null, 2));
            process.exit(status.phase === 'awaiting_human' ? EXIT_AWAITING_HUMAN : EXIT_OK);
          }

          console.log(`\n🤖 lite-browser 会话状态 (Agent 调用者身份诊断):`);
          console.log('────────────────────────────────────────────────────────────────────');
          console.log(`  调用者标识 (Agent)   : ${detectedAgent} ${explicitAgent ? '(CLI --agent 显式指定)' : '(环境感知探测)'}`);
          console.log(`  关联浏览器会话       : ${status.alive ? `✅ 活跃中 (PID: ${status.pid || '已接管'})` : '🔴 离线'}`);
          console.log(`  CDP 调试端口 (Port)  : ${status.port}`);
          console.log(`  Profile 配置目录     : ${status.profile}`);
          console.log(`  当前相位 (phase)     : ${renderStatusLine(status)}`);
          if (status.step) console.log(`  进度                 : 第 ${status.step.index}/${status.step.total} 步 · ${status.step.label}`);
          console.log(`  当前页面标题         : "${status.title || '未知'}"`);
          console.log(`  当前页面 URL         : ${status.url}`);
          console.log(`  登录态判定           : ${authStateLabel(status.auth.state)}${status.auth.signals.length ? ` (证据: ${status.auth.signals.join(', ')})` : ''}`);
          console.log(`  ✅ 已验证登录域       : ${status.auth.verifiedDomains.length ? status.auth.verifiedDomains.join(', ') : '无'}`);
          console.log(`  👀 仅访问过的域       : ${status.auth.visitedDomains.length ? status.auth.visitedDomains.join(', ') : '无'}`);
          if (status.lastSeen) {
            console.log(`  最后心跳             : ${status.lastSeen}${status.staleSeconds !== null ? ` (${formatElapsed(status.staleSeconds * 1000)} 前)` : ''}`);
          }
          if (status.task) {
            console.log(`  关联委派任务         : ${status.task.id} [${status.task.status}] (${status.task.sopName})`);
          }
          console.log('────────────────────────────────────────────────────────────────────');

          if (status.phase === 'awaiting_human') {
            console.log(renderHandoffCard(status));
            process.exit(EXIT_AWAITING_HUMAN);
          }
          console.log('');
        } else {
          if (asJson) {
            console.log(JSON.stringify({ agent: detectedAgent, phase: null, alive: false, session: null }, null, 2));
            process.exit(EXIT_OK);
          }
          console.log(`\n🤖 lite-browser Agent 调用者身份诊断:`);
          console.log('────────────────────────────────────────────────────────────────────');
          console.log(`  调用者标识 (Agent)   : ${detectedAgent} ${explicitAgent ? '(CLI --agent 显式指定)' : '(环境感知探测)'}`);
          console.log(`  关联浏览器会话       : ⚠️  当前无活跃绑定会话`);
          const others = registry.getAll().filter((s) => s.status === 'active');
          if (others.length > 1) {
            console.log(`  注意                 : 注册表里有 ${others.length} 个活跃会话 (${others.map((o) => o.agent).join(', ')})，`);
            console.log(`                         请用 --agent <name> 或 --port <n> 显式指定，避免操作到别的会话。`);
          }
          console.log(`  推荐隔离端口         : ${await registry.allocatePort(detectedAgent)}`);
          console.log(`  提示                 : 执行 \`lite-browser open <url> --agent ${detectedAgent}\` 启动专属会话`);
          console.log('────────────────────────────────────────────────────────────────────\n');
        }
        break;
      }

      // 阻塞等待人类完成介入
      case 'await-human': {
        const timeoutIdx = args.indexOf('--timeout');
        const pollIdx = args.indexOf('--poll');
        const timeout = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) : 300;
        const poll = pollIdx >= 0 ? parseInt(args[pollIdx + 1], 10) : 3;
        const asJson = args.includes('--json');

        const browser = await BrowserActions.connectToSession(explicitPort || explicitAgent);
        if (!asJson) {
          console.log(`⏳ 正在等待人类完成登录/授权（最长 ${timeout} 秒，每 ${poll} 秒探测一次）...`);
          console.log(`   如需要你操作，请在浏览器窗口内完成；Agent 会自动检测登录态并继续。`);
        }

        const res = await browser.awaitHuman(timeout, poll, (elapsed, probe) => {
          if (!asJson && elapsed > 0 && elapsed % 15 === 0) {
            console.log(`   ...已等待 ${elapsed}s（当前判定: ${authStateLabel(probe.state)}${probe.signals.length ? `, 证据: ${probe.signals.join(', ')}` : ''}）`);
          }
        });

        if (asJson) {
          console.log(JSON.stringify(res, null, 2));
        } else if (res.ready) {
          console.log(`✅ 已检测到 ${res.domain || '目标站点'} 登录完成（等待 ${res.waitedSeconds}s），登录态已登记为 verified。`);
          console.log(`   现在可以继续执行后续动作；其他 Agent 可用 --reuse 免重复登录。`);
        } else {
          console.log(`⚠️  等待超时（${res.waitedSeconds}s），仍未检测到登录完成。`);
          console.log(`   当前判定: ${authStateLabel(res.auth)}`);
          console.log(`   可延长等待: lite-browser await-human --timeout 600`);
        }
        process.exit(res.ready ? EXIT_OK : EXIT_AWAIT_TIMEOUT);
      }

      // 人类处理完后恢复流程
      case 'resume': {
        const browser = await BrowserActions.connectToSession(explicitPort || explicitAgent);
        const before = await buildSessionStatus(explicitPort || explicitAgent, { live: false });
        const probe = await browser.probeAuth();
        if (probe.loginWall) {
          const handoff = browser.setHandoff('awaiting_human', {
            needs: `请先手动完成 ${probe.domain || '目标站点'} 的登录，然后重新执行 lite-browser resume`,
            blocker: `页面仍呈现登录墙（证据: ${probe.signals.join(', ') || '未知'}）`,
            nextAction: 'lite-browser await-human --timeout 300',
          });
          void handoff;
          console.log(renderHandoffCard({ ...(before as any), phase: 'awaiting_human', needs: handoff.needs, blocker: handoff.blocker, nextAction: handoff.nextAction }));
          console.error(`\n⚠️  会话仍处于 await-human 状态：尚未检测到登录完成。`);
          process.exit(EXIT_AWAITING_HUMAN);
        }
        browser.setHandoff('acting');
        if (probe.domain) ChromeManager.markVerifiedDomain(probe.domain, explicitPort || explicitAgent);
        console.log(`✅ 已恢复执行：${probe.domain || '目标站点'} 登录态确认为 ${authStateLabel(probe.state)}${probe.domain ? `，已登记 ${probe.domain} 为 verified` : ''}。`);
        console.log(`   当前相位: acting`);
        process.exit(EXIT_OK);
      }

      case 'open': {
        const url = args[1];
        if (!url) {
          console.error('❌ 请提供目标 URL。例如: lite-browser open https://github.com');
          process.exit(1);
        }
        const headless = args.includes('--headless');
        const temp = args.includes('--temp');
        // 只有显式传 --profile 才指定 profile。此前这里默认写死 'default'，
        // 把 ChromeManager 里按 Agent 隔离 profile（agent-<name>）的设计架空了：
        // 两个 Agent 会落到同一个 profile 目录，后启动的那个直接启动失败。
        // 不传时由 ChromeManager 决定：default 身份 -> 'default'，命名 Agent -> 'agent-<name>'。
        const profIdx = args.indexOf('--profile');
        const profile = profIdx >= 0 ? args[profIdx + 1] : undefined;

        const agent = SessionRegistry.detectCurrentAgent(explicitAgent);
        const adoptedLabel = explicitUserDataDir
          ? `${basename(explicitUserDataDir)}${explicitProfileDirectory ? `/${explicitProfileDirectory}` : ''}`
          : undefined;
        const effectiveProfile = temp
          ? '临时'
          : (profile ?? adoptedLabel ?? (agent !== 'default' ? `agent-${agent}` : 'default'));

        console.log(`🌐 正在打开 ${url} (模式: ${headless ? '无头' : '有头'}, Profile: ${effectiveProfile}, Agent: ${agent}${reuse ? ', 智能复用: 是' : ''})...`);
        const browser = await BrowserActions.launchOrConnect({
          url,
          headless,
          profile,
          profileDirectory: explicitProfileDirectory,
          userDataDir: explicitUserDataDir,
          temp,
          port: explicitPort,
          agent: explicitAgent,
          reuse,
        });
        const title = await browser.getTitle();
        console.log(`✅ 页面已就绪: "${title}" (${url})`);

        // 打开后就地判定相位：撞上登录墙立刻交接，不让 Agent 继续盲跑
        const after = await buildSessionStatus(explicitPort || explicitAgent, { live: true });
        if (after) {
          const asJson = args.includes('--json');
          if (asJson) {
            console.log(JSON.stringify(after, null, 2));
          } else {
            console.log(`   ${renderStatusLine(after)}`);
          }
          if (after.phase === 'awaiting_human') {
            if (!asJson) {
              console.log(renderHandoffCard(after));
              console.log(`\n提示: 你也可以直接执行 \`lite-browser await-human --timeout 300\` 让 Agent 阻塞等待你完成登录。`);
            }
            process.exit(EXIT_AWAITING_HUMAN);
          }
        }
        break;
      }

      case 'snapshot': {
        const browser = await getSessionClient();
        const res = await browser.snapshot();
        if (args.includes('--json')) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(res.formatted);
          if (res.phase === 'awaiting_human') {
            console.log(`\n⏸  当前相位: awaiting_human —— 页面需要登录。`);
            if (res.needs) console.log(`   👉 需要你做: ${res.needs}`);
            if (res.nextAction) console.log(`   恢复命令: ${res.nextAction}`);
          }
        }
        if (res.phase === 'awaiting_human') process.exit(EXIT_AWAITING_HUMAN);
        break;
      }

      case 'click': {
        const target = args[1];
        if (!target) {
          console.error('❌ 请指定要点击的目标。例如: lite-browser click @1 或 lite-browser click "button.submit"');
          process.exit(1);
        }
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
        await browser.upload(target, files);
        console.log(`✅ 文件上传设置完成: ${files.join(', ')} → ${target}`);
        break;
      }

      case 'scroll': {
        const direction = (args[1] === 'up' ? 'up' : 'down') as 'up' | 'down';
        const amount = parseInt(args[2] || '400', 10);
        const browser = await getSessionClient();
        await browser.scroll(direction, amount);
        console.log(`✅ 页面滚动完成: ${direction} ${amount}px`);
        break;
      }

      case 'wait': {
        const seconds = parseFloat(args[1] || '1');
        const browser = await getSessionClient();
        await browser.wait(seconds);
        console.log(`✅ 等待完成: ${seconds} 秒`);
        break;
      }

      case 'screenshot': {
        const path = args[1] || `/tmp/lite-browser-${Date.now()}.png`;
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
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
        const browser = await getSessionClient();
        const res = await browser.cdp(method, params);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'close': {
        const session = ChromeManager.getActiveSession(explicitPort || explicitAgent);
        if (session) {
          try {
            const browser = await getSessionClient();
            browser.close();
          } catch (_) {}
          ChromeManager.clearSession(explicitPort || explicitAgent);
          console.log(`✅ 会话已关闭，连接已清理 (Agent/Port: ${explicitPort || explicitAgent || session.agent})`);
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
          const asJson = args.includes('--json');
          const assets = args.includes('--no-scan') ? [] : discoverAssets(process.cwd());
          const indexedPaths = new Set(list.map((i) => i.name));

          if (asJson) {
            console.log(JSON.stringify({ indexed: list, discovered: assets }, null, 2));
            break;
          }

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
          console.log('────────────────────────────────────────────────────────────────────────');

          if (assets.length > 0) {
            // 不自动登记，只是让它可见：索引不到 ≠ 没做，不该让人误以为活白干了
            const SCAN_LIMIT = 25;
            const shown = assets.slice(0, SCAN_LIMIT);
            const hidden = assets.length - shown.length;
            console.log(`\n📎 项目里已存在的自动化资产（${assets.length} 个，尚未纳入 SOP 索引）:`);
            console.log('────────────────────────────────────────────────────────────────────────');
            for (const a of shown) {
              const tag = a.kind === 'doc' ? '📄 SOP 文档' : '⚙️  脚本  ';
              const dom = a.domains.length > 0 ? ` · ${a.domains.slice(0, 2).join(', ')}` : '';
              console.log(`• ${tag} ${a.path}${dom}`);
              if (a.title && a.title !== a.name) console.log(`    ${a.title.slice(0, 70)}`);
            }
            if (hidden > 0) {
              console.log(`  …… 另有 ${hidden} 个未列出（lite-browser sop list --json 看全量）`);
            }
            console.log('────────────────────────────────────────────────────────────────────────');
            console.log('这两类资产不会被 sop list / sop match 命中，因为沉淀引擎只记录经过');
            console.log('lite-browser 动作层的操作。想让它进入索引，二选一：');
            console.log('  · 以后经由工具调用，自动沉淀（推荐）:');
            console.log('      lite-browser exec -- <你的脚本命令>');
            console.log('      lite-browser done --name <name> --intent "<触发意图>"');
            console.log('  · 一次性收编已有脚本:');
            console.log('      lite-browser sop adopt <name> --script <脚本路径> --intent "<触发意图>"');
            console.log('');
          }
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
        } else if (sub === 'adopt') {
          /**
           * 一次性收编：把已经写好的脚本变成本工具能索引到的 SOP。
           *
           * 这不是常规路径 —— 常规路径是经由 `lite-browser exec` 执行、自动沉淀。
           * 这里只为「在我改工具之前就已经写好的脚本」补录，把历史资产接进索引。
           */
          const name = args[2];
          if (!name) {
            console.error('❌ 用法: lite-browser sop adopt <name> --script <脚本路径> [--args "<额外参数>"] [--intent <意图>] [--domain <域名>] [--desc <描述>] [--frequency <频次>]');
            process.exit(EXIT_USAGE);
          }
          const getFlag = (flag: string): string | undefined => {
            const i = args.indexOf(flag);
            return i >= 0 ? args[i + 1] : undefined;
          };
          const scriptPath = getFlag('--script');
          if (!scriptPath) {
            console.error('❌ 缺少 --script。例如: lite-browser sop adopt twitter-publish --script scripts/twitter-poster.mjs --intent "发推"');
            process.exit(EXIT_USAGE);
          }
          const { existsSync: exists } = await import('node:fs');
          const { resolve: resolvePath } = await import('node:path');
          const abs = resolvePath(scriptPath);
          if (!exists(abs)) {
            console.error(`❌ 脚本不存在: ${abs}`);
            process.exit(EXIT_ERROR);
          }

          const ext = abs.slice(abs.lastIndexOf('.'));
          const runner = ext === '.py' ? 'python3' : ext === '.sh' ? 'bash' : ext === '.ts' ? 'bun' : 'node';
          const relScript = scriptPath;

          /**
           * 真实脚本几乎都带子命令（`xhs-collect.py collect all`、`foo.sh --strict`），
           * 不带参数就收编等于收编了一个跑不起来的壳子。支持引号，够日常用。
           */
          const extraArgs = (getFlag('--args') || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((s) => s.replace(/^["']|["']$/g, '')) ?? [];

          const asset = discoverAssets(process.cwd()).find((a) => a.name === name || a.path.endsWith(scriptPath));
          const intent = getFlag('--intent') || asset?.intents.join(', ');
          const domain = getFlag('--domain') || asset?.domains[0];
          const desc = getFlag('--desc') || asset?.title || `外部脚本 ${relScript}`;

          const sop = recipeEngine.saveOrUpdate({
            name,
            description: desc,
            intent,
            domain,
            scope: 'project',
            frequency: getFlag('--frequency'),
          }, undefined, [
            {
              step: 1,
              action: 'exec',
              command: runner,
              args: [relScript, ...extraArgs],
              description: `执行 ${runner} ${[relScript, ...extraArgs].join(' ')}`,
            },
          ]);

          console.log(`\n✅ 已收编外部脚本为 SOP "${sop.name}" (v${sop.version}, 作用域: ${sop.scope})`);
          console.log(`   脚本  : ${runner} ${[relScript, ...extraArgs].join(' ')}`);
          console.log(`   意图  : ${sop.match.intents.join(', ') || '（无）'}`);
          console.log(`   域名  : ${sop.match.domains.join(', ') || '（无）'}`);
          console.log(`   频次  : ${sop.schedule.frequency || 'manual'}`);
          console.log(`   运行  : lite-browser sop run ${sop.name}`);
          console.log(`   提醒  : 这条 SOP 走的是 exec，执行时会真实调用你的脚本。\n`);
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
          const dryRun = args.includes('--dry-run');
          const stepTotal = rec.steps?.length ?? rec.stepCount ?? 0;
          console.log(`⚡ 开始执行 SOP "${name}" (v${rec.version || '1.0.0'}, ${stepTotal} 步)${dryRun ? ' [dry-run]' : ''}...`);

          // 只含 exec 步骤的 SOP 不需要浏览器，别为一条命令白起一个窗口
          const browser = needsBrowser(rec)
            ? await BrowserActions.launchOrConnect({
                headless,
                port: explicitPort,
                agent: explicitAgent,
                reuse,
              })
            : null;

          try {
            await executeSteps(rec, browser, {
              vars,
              dryRun,
              onStep: (step, index, total) => {
                console.log(`  [${index}/${total}] ${step.description || step.action}...`);
              },
            });

            // dry-run 不算一次真实运行：写进统计会把成功率变成骗人的数字
            if (dryRun) {
              console.log(`\n🔍 SOP "${name}" dry-run 通过，未执行任何步骤，统计未改动。\n`);
            } else {
              recipeEngine.recordRun(name, true);
              console.log(`\n🎉 SOP "${name}" 执行成功！(自动更新统计: 成功率+1)\n`);
            }
          } catch (execErr: any) {
            if (!dryRun) recipeEngine.recordRun(name, false);
            console.error(`\n❌ SOP "${name}" 在执行过程中出现异常: ${execErr.message}`);
            console.log(`💡 提示: 可通过手动修正操作后执行 "lite-browser done --name ${name} --reason '修复某步骤'" 完成自愈更新。\n`);
            process.exit(EXIT_ERROR);
          }
        } else {
          console.error(`❌ 未知 sop 子命令: ${sub}。支持: list, match, show, run, schedule, export, import, validate, delete, adopt`);
          process.exit(EXIT_USAGE);
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

        const awaitIdx = args.indexOf('--await-human');
        if (awaitIdx >= 0 && args[awaitIdx + 1]) {
          process.env.LITE_BROWSER_AWAIT_HUMAN = args[awaitIdx + 1];
        }
        const dProfIdx = args.indexOf('--profile');
        const dProfile = dProfIdx >= 0 ? args[dProfIdx + 1] : undefined;

        const task = taskEngine.delegate(sopName, {
          variables: vars,
          headless,
          agent: SessionRegistry.detectCurrentAgent(explicitAgent),
          port: explicitPort,
          profile: dProfile,
        });
        const awaitSeconds = process.env.LITE_BROWSER_AWAIT_HUMAN || '600';
        console.log(`\n🚀 任务已成功委派至后台运行！`);
        console.log(`🆔 任务 ID: ${task.id}`);
        console.log(`📦 目标 SOP: ${task.sopName}`);
        console.log(`📄 运行日志: ${task.logFile}`);
        console.log(`🤝 交接策略: 撞到登录墙会转成 awaiting_human 并原地等你，最长 ${awaitSeconds} 秒`);
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
              t.status === 'awaiting_human' ? '⏸️ 需要你介入' :
              t.status === 'running' ? '⏳ 运行中' : '⏸️ 待处理';
            const dur = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : '-';
            const hb = t.heartbeatAt ? ` 心跳: ${formatElapsed(Date.now() - new Date(t.heartbeatAt).getTime())} 前` : '';
            console.log(`• ${t.id.padEnd(26)} [${t.sopName.padEnd(16)}] ${statusIcon.padEnd(12)} (耗时: ${dur}) 起始: ${t.startTime.slice(0, 19).replace('T', ' ')}${hb}`);
            if (t.status === 'awaiting_human') {
              if (t.needs) console.log(`    👉 需要你做: ${t.needs}`);
              if (t.nextAction) console.log(`    恢复命令: ${t.nextAction}`);
            }
          }
          console.log('────────────────────────────────────────────────────────────────────────────────────────\n');
        } else if (sub === 'status') {
          const id = args[2];
          if (!id) {
            console.error('❌ 请提供任务 ID。');
            process.exit(EXIT_USAGE);
          }
          const task = taskEngine.getTask(id);
          if (!task) {
            console.error(`❌ 未找到任务: ${id}`);
            process.exit(EXIT_ERROR);
          }
          if (args.includes('--json')) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`\n📋 委派任务详情:`);
            console.log('────────────────────────────────────────────────────────────────────');
            console.log(`  任务 ID   : ${task.id}`);
            console.log(`  目标 SOP  : ${task.sopName}`);
            console.log(`  状态      : ${task.status}`);
            if (task.step) console.log(`  进度      : 第 ${task.step}/${task.stepTotal ?? '?'} 步 · ${task.stepLabel ?? ''}`);
            if (task.heartbeatAt) console.log(`  最后心跳  : ${task.heartbeatAt} (${formatElapsed(Date.now() - new Date(task.heartbeatAt).getTime())} 前)`);
            if (task.error) console.log(`  错误      : ${task.error}`);
            if (task.status === 'awaiting_human') {
              console.log('────────────────────────────────────────────────────────────────────');
              console.log(`  ⏸  该任务正在等待人类介入，它**没有失败**。`);
              if (task.needs) console.log(`  👉 需要你做: ${task.needs}`);
              if (task.nextAction) console.log(`  恢复命令  : ${task.nextAction}`);
            }
            console.log('────────────────────────────────────────────────────────────────────');
            console.log(`  完整 JSON : lite-browser task status ${task.id} --json\n`);
          }
          if (task.status === 'awaiting_human') process.exit(EXIT_AWAITING_HUMAN);
        } else if (sub === 'logs') {
          const id = args[2];
          if (!id) {
            console.error('❌ 请提供任务 ID。');
            process.exit(EXIT_USAGE);
          }
          const tailIdx = args.indexOf('--tail');
          const tail = tailIdx >= 0 ? parseInt(args[tailIdx + 1], 10) : 50;
          const logs = taskEngine.getTaskLogs(id, tail);
          console.log(logs);
        } else if (sub === 'retry') {
          const id = args[2];
          if (!id) {
            console.error('❌ 请提供要重试的任务 ID。例如: lite-browser task retry task_1727...');
            process.exit(EXIT_USAGE);
          }
          const fresh = taskEngine.retry(id);
          console.log(`\n🔁 已用相同参数重新委派该 SOP（人类介入后从头重放，语义可预期）。`);
          console.log(`   原任务 : ${id}`);
          console.log(`   新任务 : ${fresh.id}`);
          console.log(`   查询   : lite-browser task status ${fresh.id}\n`);
        } else {
          console.error(`❌ 未知 task 子命令: ${sub}。支持: list, status, logs, retry`);
          process.exit(EXIT_USAGE);
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
        } else if (sub === 'pull-system' || sub === 'pull') {
          const domain = args[2] && !args[2].startsWith('--') ? args[2] : undefined;
          console.log(`🔐 正在从系统 Chrome 安全解密提取 Cookies${domain ? ` (匹配域名: ${domain})` : ''}...`);
          const res = await CookieManager.pullFromSystem(domain);
          console.log(`✅ 成功从系统 Chrome 提取并注入 ${res.count} 条 Cookies 至当前会话！`);
        } else if (sub === 'clear') {
          await CookieManager.clear();
          console.log('✅ 已清除当前会话的所有 Cookies');
        } else {
          console.error(`❌ 未知 cookie 子命令: ${sub}。支持: export, import, pull-system, clear`);
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

      // Session 多租户与 Agent 会话管理指令
      case 'session': {
        const sub = args[1] || 'list';
        const registry = new SessionRegistry();
        if (sub === 'list') {
          const sessions = registry.getAll();
          console.log(`\n🌐 lite-browser 多 Agent 会话注册表 (${sessions.length} 个):`);
          console.log('────────────────────────────────────────────────────────────────────────────────────────');
          for (const s of sessions) {
            const isAlive = await registry.pingPort(s.port);
            const statusIcon = isAlive ? '🟢 活跃' : '⚪ 已离线';
            const verified = s.verifiedDomains && s.verifiedDomains.length > 0 ? s.verifiedDomains.join(', ') : '无';
            const visited = s.visitedDomains && s.visitedDomains.length > 0 ? s.visitedDomains.join(', ') : '无';
            const phase = s.handoff?.phase ?? 'idle';
            const phaseTag = phase === 'awaiting_human' ? '  ⏸ 需要你介入' : '';
            console.log(`• [${s.agent.padEnd(12)}] 端口:${s.port} ${statusIcon} (PID:${s.pid || '-'}) Profile:${s.profile} phase:${phase}${phaseTag}`);
            console.log(`    ✅ 已验证登录域: [${verified}]`);
            console.log(`    👀 仅访问过    : [${visited}]`);
            if (s.handoff?.needs) console.log(`    👉 需要你做   : ${s.handoff.needs}`);
            if (s.url) console.log(`    URL          : ${s.url}`);
            if (s.title) console.log(`    标题         : "${s.title}"`);
          }
          console.log('────────────────────────────────────────────────────────────────────────────────────────\n');
        } else if (sub === 'clean') {
          console.log('🧹 正在检测并清理已退出的失效会话...');
          const res = await registry.cleanDeadSessions();
          console.log(`✅ 清理完成: 已标记失效 ${res.cleaned} 个，当前存活会话: ${res.active} 个`);
        } else if (sub === 'remove') {
          const target = args[2];
          if (!target) {
            console.error('❌ 请指定要移除的 Agent 名称或端口。例如: lite-browser session remove gemini 或 9222');
            process.exit(1);
          }
          registry.remove(target);
          console.log(`✅ 已从注册表中移除会话记录: ${target}`);
        } else if (sub === 'mark-login') {
          const domain = args[2];
          if (!domain) {
            console.error('❌ 请指定已登录的主域名。例如: lite-browser session mark-login juejin.cn');
            process.exit(EXIT_USAGE);
          }
          const session = ChromeManager.getActiveSession(explicitPort || explicitAgent);
          if (!session) {
            console.error('❌ 未找到活跃会话，无法标记登录态。请先执行 open 建立会话。');
            process.exit(EXIT_ERROR);
          }
          registry.registerLoginDomain(session.port, domain);

          // 人工标记是「已登录」的显式断言，但仍用探针核对一次，避免人标错
          let confirm = '';
          try {
            const browser = await BrowserActions.connectToSession(session.port);
            const probe = await browser.probeAuth();
            if (probe.loginWall) {
              confirm = `\n⚠️  注意: 探针仍判定当前页面为登录墙（证据: ${probe.signals.join(', ')}），已按你的显式标记登记，但 --reuse 复用后仍需人工登录。`;
            } else if (probe.state === 'authenticated') {
              confirm = `\n✅ 探针已确认登录态（证据: ${probe.signals.join(', ')}）。`;
            } else {
              confirm = `\nℹ️ 探针证据不足，已按你的显式标记登记为 verified。`;
            }
          } catch (_) {}
          console.log(`✅ 已将 ${domain} 登记为 **verified**（端口 ${session.port}, Agent: ${session.agent}）—— 只有 verified 才会被 --reuse 采信。${confirm}`);
        } else {
          console.error(`❌ 未知 session 子命令: ${sub}。支持: list, clean, remove, mark-login`);
          process.exit(EXIT_USAGE);
        }
        break;
      }

      case 'version':
      case '--version':
      case '-v':
        // 脚本/CI 普遍用 `--version` 探版本，落到「未知命令 + 退出码 2」会让人以为装坏了
        if (args.includes('--json')) console.log(JSON.stringify({ name: 'lite-browser', version: VERSION }));
        else console.log(`lite-browser ${VERSION}`);
        break;

      default:
        console.error(`❌ 未知命令: ${command}\n`);
        console.log(USAGE.trim());
        process.exit(EXIT_USAGE);
    }

    process.exit(EXIT_OK);
  } catch (err: any) {
    console.error(`\n💥 执行失败: ${err.message}\n`);
    process.exit(EXIT_ERROR);
  }
}

main();
