/**
 * mcp.ts —— Model Context Protocol (MCP) 标准 STDIO 服务端
 * 零依赖原生 JSON-RPC 2.0 实现，赋能任意 AI Agent 系统一键插件化集成
 */

import { BrowserActions } from './actions.js';
import { RecipeEngine } from './recipe.js';
import { TaskEngine } from './task.js';
import { buildSessionStatus } from './status.js';
import { authStateLabel, renderHandoffCard } from './handoff.js';
import { executeSteps, needsBrowser, runExecStep } from './runner.js';
import type { SessionStatus } from './types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServer {
  private recipeEngine = new RecipeEngine();
  private taskEngine = new TaskEngine();

  start(): void {
    let buffer = '';

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const req: JsonRpcRequest = JSON.parse(trimmed);
          await this.handleRequest(req);
        } catch (err: any) {
          this.sendError(null, -32700, `Parse error: ${err.message}`);
        }
      }
    });

    process.stderr.write('[lite-browser-mcp] MCP STDIO 服务已就绪\n');
  }

  private sendResponse(id: number | string | undefined | null, result: any): void {
    if (id === undefined || id === null) return;
    const res: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  }

  private sendError(id: number | string | undefined | null, code: number, message: string, data?: any): void {
    const res: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, data },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
  }

  private async handleRequest(req: JsonRpcRequest): Promise<void> {
    const { id, method, params } = req;

    switch (method) {
      case 'initialize': {
        this.sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'lite-browser',
            version: '1.1.0',
          },
        });
        break;
      }

      case 'notifications/initialized': {
        // 客户端就绪通知，无需应答
        break;
      }

      case 'ping': {
        this.sendResponse(id, {});
        break;
      }

      case 'tools/list': {
        this.sendResponse(id, {
          tools: this.getToolDefinitions(),
        });
        break;
      }

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        try {
          const resultText = await this.executeTool(toolName, toolArgs);
          this.sendResponse(id, {
            content: [
              {
                type: 'text',
                text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText, null, 2),
              },
            ],
          });
        } catch (err: any) {
          this.sendResponse(id, {
            isError: true,
            content: [
              {
                type: 'text',
                text: `执行失败: ${err.message}`,
              },
            ],
          });
        }
        break;
      }

      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  private getToolDefinitions() {
    return [
      {
        name: 'browser_open',
        description: '在轻量浏览器中打开指定目标网址并建立会话',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '网页 URL' },
            headless: { type: 'boolean', description: '是否使用无头模式，默认 false (有头可视)' },
            profile: { type: 'string', description: '指定持久化 profile 标识，默认 default' },
          },
          required: ['url'],
        },
      },
      {
        name: 'browser_snapshot',
        description: '获取当前网页视口内所有可交互元素的精简编号清单 (@1, @2...)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'browser_click',
        description: '点击网页中的元素（支持 @编号 如 "@1" 或 CSS 选择器）',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标元素编号 (@1) 或选择器' },
          },
          required: ['target'],
        },
      },
      {
        name: 'browser_type',
        description: '在目标输入框中录入文本',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标输入框编号 (@2) 或选择器' },
            text: { type: 'string', description: '输入的文本内容' },
          },
          required: ['target', 'text'],
        },
      },
      {
        name: 'browser_hover',
        description: '悬停在目标元素上方以触发下拉菜单或悬停状态',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '目标元素编号 (@1) 或选择器' },
          },
          required: ['target'],
        },
      },
      {
        name: 'browser_press',
        description: '模拟按下特殊按键（如 Enter, Tab, Escape, Backspace, ArrowDown）',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '按键名称（如 Enter, Tab, Escape）' },
          },
          required: ['key'],
        },
      },
      {
        name: 'browser_select',
        description: '在原生下拉列表 (<select>) 中选取指定值',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: '下拉选择框编号 (@1) 或选择器' },
            value: { type: 'string', description: '选项的 value 属性值' },
          },
          required: ['target', 'value'],
        },
      },
      {
        name: 'browser_scroll',
        description: '平滑滚动当前网页视口',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['down', 'up'], description: '滚动方向，默认 down' },
            amount: { type: 'number', description: '滚动的像素距离，默认 400' },
          },
        },
      },
      {
        name: 'browser_wait',
        description: '等待指定秒数以等待页面渲染或弹窗完成',
        inputSchema: {
          type: 'object',
          properties: {
            seconds: { type: 'number', description: '等待秒数，默认 1' },
          },
        },
      },
      {
        name: 'browser_screenshot',
        description: '抓取当前网页视口截图并保存在本地磁盘',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '截图文件保存绝对路径' },
          },
        },
      },
      {
        name: 'browser_eval',
        description: '在网页控制台上下文执行任意 JavaScript 并获取返回值',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript 表达式代码' },
          },
          required: ['code'],
        },
      },
      {
        name: 'browser_cdp',
        description: '直接向 Chrome CDP 发送底层协议命令',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', description: 'CDP 协议方法名（如 Network.getCookies）' },
            params: { type: 'object', description: '调用参数字典' },
          },
          required: ['method'],
        },
      },
      {
        name: 'sop_match',
        description: '智能匹配现存的 SOP，若命中可直接执行免除 LLM DOM 探索开销',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '当前意图描述或目标 URL' },
          },
          required: ['query'],
        },
      },
      {
        name: 'sop_run',
        description: '确定性执行已沉淀的标准 SOP',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'SOP 唯一名称' },
            variables: { type: 'object', description: '动态变量键值对' },
          },
          required: ['name'],
        },
      },
      {
        name: 'sop_list',
        description: '列出系统与项目内所有已沉淀的 SOP 清单',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'sop_save',
        description: '将当前会话记录的浏览器操作轨迹沉淀或原地自愈升级为 SOP',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'SOP 英文名称' },
            description: { type: 'string', description: 'SOP 详细业务说明' },
            intent: { type: 'string', description: '触发意图关键词' },
            domain: { type: 'string', description: '主域名' },
            scope: { type: 'string', enum: ['global', 'project'], description: '存储范围：全局或本地项目' },
            reason: { type: 'string', description: '自愈或更新原因' },
          },
          required: ['name'],
        },
      },
      {
        name: 'task_delegate',
        description: '将 SOP 委派至后台异步执行，立即返回任务 ID，无需阻塞等待',
        inputSchema: {
          type: 'object',
          properties: {
            sopName: { type: 'string', description: '要委派执行的 SOP 名称' },
            variables: { type: 'object', description: '动态变量' },
            headless: { type: 'boolean', description: '是否无头运行，默认 true' },
          },
          required: ['sopName'],
        },
      },
      {
        name: 'task_status',
        description: '查询后台委派任务的执行状态与日志摘要',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: '委派任务 ID' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'browser_status',
        description:
          '查询当前会话的完整状态：相位 (phase)、进度、登录态判定、是否需要人类介入。' +
          'phase 为 awaiting_human 时说明任务卡在等人，此时应把 needs 告知用户，而不是继续调用动作工具。',
        inputSchema: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: '指定 Agent 身份（多会话并存时必须指定）' },
            port: { type: 'number', description: '指定 CDP 端口' },
            live: { type: 'boolean', description: '是否连上去做活体登录态探针，默认 true' },
          },
        },
      },
      {
        name: 'await_human',
        description:
          '阻塞等待人类完成登录/验证码/授权，直到检测到登录态或超时。' +
          '撞到登录墙时应当调用它，而不是反复重试或放弃。返回 ready 表示可以继续执行后续步骤。',
        inputSchema: {
          type: 'object',
          properties: {
            timeoutSeconds: { type: 'number', description: '最长等待秒数，默认 300' },
            pollSeconds: { type: 'number', description: '轮询间隔秒数，默认 3' },
          },
        },
      },
      {
        name: 'run_script',
        description:
          '执行外部脚本（例如项目里已有的 twitter-poster.mjs）并把该调用记入动作轨迹。' +
          '这是「执行完任务自动沉淀 SOP」对脚本类工作成立的前提 —— 脚本自己直连 CDP 时' +
          '沉淀引擎看不见任何操作。调用后可用 sop_save 沉淀成 SOP。',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '可执行命令，例如 node 或 python3' },
            args: { type: 'array', items: { type: 'string' }, description: '命令参数，例如 ["scripts/twitter-poster.mjs","check"]' },
            cwd: { type: 'string', description: '工作目录，默认当前目录' },
          },
          required: ['command'],
        },
      },
    ];
  }

  private async executeTool(name: string, args: Record<string, any>): Promise<any> {
    switch (name) {
      case 'browser_open': {
        const browser = await BrowserActions.launchOrConnect({
          url: args.url,
          headless: args.headless ?? false,
          profile: args.profile,
        });
        const title = await browser.getTitle();
        const status = await buildSessionStatus(browser.port, { live: true });
        if (status?.phase === 'awaiting_human') {
          return `${renderHandoffCard(status)}\n\n页面已打开，但检测到登录墙 —— 请把上面的「需要你做」告知用户，然后调用 await_human 等待，不要继续点击。`;
        }
        return `页面已打开: "${title}" (${args.url})\n相位: ${status?.phase ?? 'acting'} · 登录态: ${authStateLabel(status?.auth.state ?? 'unknown')}`;
      }

      case 'browser_status': {
        const target = args.port ?? args.agent;
        const status = await buildSessionStatus(target, { live: args.live ?? true });
        if (!status) {
          return '当前没有活跃会话。请先调用 browser_open 打开一个页面。';
        }
        return status as SessionStatus;
      }

      case 'await_human': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.awaitHuman(args.timeoutSeconds ?? 300, args.pollSeconds ?? 3);
        if (res.ready) {
          return `✅ 已检测到 ${res.domain || '目标站点'} 登录完成（等待 ${res.waitedSeconds}s），登录态已登记为 verified。可以继续执行后续步骤。`;
        }
        return (
          `⚠️ 等待超时（${res.waitedSeconds}s），仍未检测到登录完成（当前判定: ${authStateLabel(res.auth)}）。\n` +
          `请告知用户需要手动登录 ${res.domain || '目标站点'}，或再次调用 await_human 延长等待。`
        );
      }

      /**
       * 让外部脚本的调用进入轨迹。
       *
       * 这是「执行完任务自动落成 SOP」对脚本类工作成立的前提：脚本自己直连 CDP 时
       * 沉淀引擎看不见任何操作；经由这里调用才会被记录，之后 sop_save 才能沉淀。
       */
      case 'run_script': {
        const command = args.command;
        const cmdArgs: string[] = args.args || [];
        if (!command) return '缺少 command 参数';
        try {
          await runExecStep({ step: 0, action: 'exec', command, args: cmdArgs }, {}, args.cwd);
          RecipeEngine.recordAction({
            type: 'exec',
            command,
            args: cmdArgs,
            exitCode: 0,
            targetDescription: [command, ...cmdArgs].join(' '),
          } as any);
          return `✅ 已执行并记入轨迹: ${[command, ...cmdArgs].join(' ')}\n调用 sop_save 即可沉淀成 SOP。`;
        } catch (err: any) {
          RecipeEngine.recordAction({
            type: 'exec',
            command,
            args: cmdArgs,
            exitCode: 1,
            targetDescription: [command, ...cmdArgs].join(' '),
          } as any);
          return `❌ ${err.message}（已记入轨迹，便于自愈时定位）`;
        }
      }

      case 'browser_snapshot': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.snapshot();
        if (res.phase === 'awaiting_human') {
          return (
            `${res.formatted}\n\n` +
            `⏸ 相位: awaiting_human —— 页面需要登录，元素列表可能只是登录页的内容。\n` +
            `👉 需要用户做: ${res.needs || '手动完成登录'}\n` +
            `下一步: 调用 await_human 等待用户完成，不要盲目点击登录页元素。`
          );
        }
        return res.formatted;
      }

      case 'browser_click': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.click(args.target);
        return `点击成功: ${res.target} (x:${res.x}, y:${res.y})`;
      }

      case 'browser_type': {
        const browser = await BrowserActions.connectToSession();
        await browser.type(args.target, args.text);
        return `文本录入完成: ${args.target} → "${args.text}"`;
      }

      case 'browser_hover': {
        const browser = await BrowserActions.connectToSession();
        const res = await browser.hover(args.target);
        return `悬停操作完成: ${res.target}`;
      }

      case 'browser_press': {
        const browser = await BrowserActions.connectToSession();
        await browser.press(args.key);
        return `按键触发完成: ${args.key}`;
      }

      case 'browser_select': {
        const browser = await BrowserActions.connectToSession();
        await browser.select(args.target, args.value);
        return `下拉选项设置完成: ${args.target} = "${args.value}"`;
      }

      case 'browser_scroll': {
        const browser = await BrowserActions.connectToSession();
        await browser.scroll(args.direction || 'down', args.amount || 400);
        return `滚动完成: ${args.direction || 'down'} ${args.amount || 400}px`;
      }

      case 'browser_wait': {
        const browser = await BrowserActions.connectToSession();
        await browser.wait(args.seconds || 1);
        return `等待完成: ${args.seconds || 1} 秒`;
      }

      case 'browser_screenshot': {
        const browser = await BrowserActions.connectToSession();
        const path = args.path || `/tmp/lite-browser-${Date.now()}.png`;
        const res = await browser.screenshot(path);
        return `截图保存成功: ${res.path} (${(res.size / 1024).toFixed(1)} KB)`;
      }

      case 'browser_eval': {
        const browser = await BrowserActions.connectToSession();
        const val = await browser.eval(args.code);
        return val !== undefined ? val : '执行成功 (undefined)';
      }

      case 'browser_cdp': {
        const browser = await BrowserActions.connectToSession();
        return await browser.cdp(args.method, args.params || {});
      }

      case 'sop_match': {
        const q = args.query;
        let url: string | undefined;
        let intent: string | undefined;
        let domain: string | undefined;

        if (q.startsWith('http://') || q.startsWith('https://')) {
          url = q;
          try { domain = new URL(q).hostname; } catch (_) {}
        } else {
          intent = q;
        }

        const matchRes = this.recipeEngine.matchSOP({ url, intent, domain });
        if (matchRes.matched) {
          return {
            matched: true,
            sop: matchRes.matched.name,
            version: matchRes.matched.version,
            score: matchRes.score,
            reason: matchRes.reason,
            parameters: matchRes.matched.parameters,
          };
        }
        return { matched: false, reason: matchRes.reason };
      }

      case 'sop_run': {
        const rec = this.recipeEngine.getRecipe(args.name);
        const vars = args.variables || {};
        const browser = needsBrowser(rec) ? await BrowserActions.connectToSession() : null;

        try {
          await executeSteps(rec, browser, { vars });
        } catch (err: any) {
          this.recipeEngine.recordRun(args.name, false);
          throw err;
        }

        this.recipeEngine.recordRun(args.name, true);
        return `SOP "${args.name}" 执行成功 (${rec.stepCount} 步)`;
      }

      case 'sop_list': {
        return this.recipeEngine.listRecipes();
      }

      case 'sop_save': {
        const saved = this.recipeEngine.saveOrUpdate({
          name: args.name,
          description: args.description,
          intent: args.intent,
          domain: args.domain,
          scope: args.scope,
          reason: args.reason,
        });
        return {
          ok: true,
          name: saved.name,
          version: saved.version,
          scope: saved.scope,
          stepCount: saved.stepCount,
          parameters: saved.parameters,
        };
      }

      case 'task_delegate': {
        const task = this.taskEngine.delegate(args.sopName, {
          variables: args.variables,
          headless: args.headless,
        });
        return {
          ok: true,
          taskId: task.id,
          sopName: task.sopName,
          status: task.status,
          logFile: task.logFile,
          message: `SOP "${args.sopName}" 已委派至后台异步运行`,
        };
      }

      case 'task_status': {
        const task = this.taskEngine.getTask(args.taskId);
        if (!task) throw new Error(`未找到任务: ${args.taskId}`);
        const logs = this.taskEngine.getTaskLogs(args.taskId, 20);
        return {
          task,
          recentLogs: logs,
        };
      }

      default:
        throw new Error(`未实现的 MCP 工具: ${name}`);
    }
  }
}
