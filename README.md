# lite-browser

**极致轻量、零常驻、具身自进化的 AI 浏览器操控工具 (v1.1.0)** —— 专为 AI Agent、自动化脚本与团队协作设计。

零依赖、冷启动 < 20ms、支持 DOM 候选元素编号、12 项原子动作、**SOP 具身自进化引擎**、**后台任务委派引擎**、**团队 SOP 共享规范** 与 **内置 MCP (Model Context Protocol) 插件化服务**。

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg?style=flat-square)](package.json)
[![MCP](https://img.shields.io/badge/MCP-JSON--RPC_2.0-purple.svg?style=flat-square)](src/mcp.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 解决的核心痛点

| 传统浏览器 Agent / 工具 | **lite-browser (自研轻量解法)** |
|---|---|
| 磁盘占用几百兆，常驻后台吃 1GB 内存，taskspace 频繁超限 | **单文件原生 Mach-O（~60MB 内嵌 Bun），零常驻后台进程** |
| 启动耗时数秒，依赖庞大 Playwright/Puppeteer 链路 | **冷启动 19ms，纯原生 WebSocket 直连 Chrome CDP** |
| **AI 只会无脑新增**：每次探索产生冗余脚本，从不自愈更新 | **SOP 元数组管理 + 语义匹配 + 原地版本自增（v1.0.0 → v1.0.1）** |
| 重复消耗 LLM Token，每次探索不稳定且易幻觉 | **一次成功即沉淀为标准 SOP，二次执行 300ms 确定性直达** |
| 难以与团队协作共享自动化经验，SOP 无法随代码沉淀 | **支持项目级与全局双作用域（`./.lite-browser` 与 `~/.lite-browser`），支持 export/import/validate** |
| AI Agent 无法简单将耗时任务脱机异步委派 | **内置 `delegate` 异步委派引擎与任务审计（状态追踪、日志持久化）** |
| 孤岛式运行，各 Agent 框架需定制适配层 | **内置 Model Context Protocol (MCP) STDIO 服务，一键插件化接入任何 AI 系统** |

---

## 架构体系

```
lite-browser (TypeScript + Bun Mach-O)
      │
      ├──> 原生 WebSocket ──> Google Chrome CDP (Port 9222)
      │                            │
      │                            ├──> DOM 元素精简编号 (@1, @2 ... 自动过滤视口外与不可见元素)
      │                            ├──> 12 项原子操作 (open, click, type, hover, press, select, upload, scroll, wait, shot, eval, cdp)
      │                            └──> 状态与会话持久化 (Profile 隔离、Cookies 导入/导出/清理)
      │
      ├──> SOP 具身自进化与团队协作引擎
      │     ├──> 双作用域元数组注册表 (全局 ~/.lite-browser / 项目本地 ./.lite-browser)
      │     ├──> 智能语义与 URL 模式匹配 (lite-browser sop match)
      │     ├──> 原地版本自愈升级与变更日志 (SemVer + changelog)
      │     ├──> 团队共享流通 (sop export, import, validate)
      │     └──> 调度与频次统计 (runCount, successCount, lastRunAt)
      │
      ├──> 异步任务委派引擎 (Task Delegation)
      │     ├──> 脱机后台执行 (lite-browser delegate)
      │     └──> 任务审计清单与日志追踪 (task list, status, logs)
      │
      └──> 开放插件化生态 (MCP & SDK)
            ├──> Model Context Protocol (MCP) STDIO 服务 (lite-browser mcp)
            └──> 统一 TypeScript / ESM SDK 门面 (import { LiteBrowser })
```

---

## 安装与快速开始

```bash
# 1. 编译为单文件原生二进制
bun run build

# 2. 软链至系统 PATH
ln -sf $(pwd)/bin/lite-browser ~/.local/bin/lite-browser

# 3. 验证就绪
lite-browser --help
```

---

## 核心功能指南

### 1. 探索与交互

```bash
# 打开目标页面（支持有头、无头模式与持久化 Profile）
lite-browser open https://juejin.cn/editor/drafts/new --profile default

# 提取当前可视交互元素（自动生成 @1, @2 ... 精简编号）
lite-browser snapshot

# 在指定元素中输入文本与点击
lite-browser type @1 "端点、协议、API——调 AI 模型时那三个总被搞混的词"
lite-browser click @3

# 悬停与键盘快捷按键
lite-browser hover @5
lite-browser press Enter

# 下拉选择与文件上传
lite-browser select @6 "technology"
lite-browser upload @7 /path/to/cover.png

# 截图核验
lite-browser screenshot /tmp/juejin-draft.png
```

### 2. SOP 智能沉淀与元数组规范

当一次任务探索完成，使用 `done` 命令沉淀为标准化 SOP，自动提炼动态参数与匹配规则：

```bash
lite-browser done \
  --name "juejin-publish" \
  --desc "掘金文章录入、分类标签选择与发布流程" \
  --intent "发布掘金" \
  --domain "juejin.cn" \
  --scope "global" \
  --frequency "daily"
```

生成具备完整元数组的 SOP 规范：
```json
{
  "name": "juejin-publish",
  "version": "1.0.0",
  "description": "掘金文章录入、分类标签选择与发布流程",
  "scope": "global",
  "match": {
    "urlPatterns": ["https://juejin.cn/editor/*"],
    "intents": ["发布掘金", "掘金发文", "juejin-publish"],
    "domains": ["juejin.cn"]
  },
  "schedule": {
    "frequency": "daily",
    "runCount": 0,
    "successCount": 0,
    "failureCount": 0
  },
  "parameters": [
    { "name": "input_6", "description": "文章标题", "required": true },
    { "name": "input_10", "description": "技术分类与搜索标签", "required": true }
  ],
  "steps": [...],
  "changelog": [
    { "version": "1.0.0", "date": "...", "reason": "初次录制并沉淀为标准化 SOP" }
  ]
}
```

### 3. Agent 模式：匹配判定与免探索直达

下次 Agent 接收到类似任务时，先进行匹配：

```bash
# 智能匹配（支持 URL、域名或任务意图）
lite-browser sop match "我想发布掘金文章"
# 🎯 命中 SOP: "juejin-publish" (v1.0.0) [置信度: 85%]
# 💡 可直接执行: lite-browser sop run juejin-publish

# 零大模型开销，毫秒级直接执行 SOP
lite-browser sop run juejin-publish --var input_6="新标题" --var input_10="AI"
```

### 4. 自愈更新（解决 AI 只会单纯新增的问题）

当页面发生改版或步骤执行异常时，**严禁另起新名（如 juejin-2, juejin-final）**，重新操作后直接原地更新：

```bash
# 原地自愈更新：版本自动递增（v1.0.0 -> v1.0.1），保留历史统计与调度频次
lite-browser done --name "juejin-publish" --reason "适配掘金新版分类选择器与必填标签"
```

### 5. 任务委派与脱机后台执行 (Task Delegation)

遇到耗时较长、无需阻塞当前对话的浏览器自动化任务时，直接委派给后台异步运行：

```bash
# 异步委派任务（立即返回 Task ID，脱机执行）
lite-browser delegate juejin-publish --var input_6="深度解析" --var input_10="架构" --headless
# 🚀 任务已成功委派至后台运行！
# 🆔 任务 ID: task_1727221234_ab12
# 📄 运行日志: ~/.lite-browser/tasks/logs/task_1727221234_ab12.log

# 查看所有委派任务状态
lite-browser task list

# 查看指定任务详情与执行结果
lite-browser task status task_1727221234_ab12

# 查看任务运行日志
lite-browser task logs task_1727221234_ab12 --tail 50
```

### 6. 团队 SOP 共享与规范流通

```bash
# 导出 SOP 为规范 JSON
lite-browser sop export juejin-publish --file ./juejin-publish.json

# 团队成员导入该规范（支持存入当前项目的 ./.lite-browser 代码库中，或全局环境）
lite-browser sop import ./juejin-publish.json --scope project

# 校验 SOP 契约合法性
lite-browser sop validate ./juejin-publish.json
```

### 7. MCP 插件化集成 (Model Context Protocol)

`lite-browser` 内置符合 JSON-RPC 2.0 规范的 MCP STDIO 服务端，可无缝挂载为 Claude Code、Cursor、Windsurf、Zed 或 DeepSeek Harness 的原生 Tool 插件：

#### 配置示例 (`~/.claude/mcp.json` 或 AI 工具配置文件):
```json
{
  "mcpServers": {
    "lite-browser": {
      "command": "lite-browser",
      "args": ["mcp"]
    }
  }
}
```

挂载后，AI 即可直接调用以下 18+ 浏览器控制与 SOP 工具：
- `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_hover`, `browser_press`, `browser_select`
- `browser_scroll`, `browser_wait`, `browser_screenshot`, `browser_eval`, `browser_cdp`
- `sop_match`, `sop_run`, `sop_list`, `sop_save`
- `task_delegate`, `task_status`

---

## 编程式 SDK 调用

除了命令行，`lite-browser` 提供完备的 TypeScript / ESM SDK：

```typescript
import { LiteBrowser } from 'lite-browser';

// 1. 快速启动或连接浏览器
const browser = await LiteBrowser.open('https://example.com', { headless: false });

// 2. DOM 交互
const snapshot = await browser.snapshot();
await browser.click('@1');
await browser.type('@2', '搜索内容');
await browser.press('Enter');

// 3. 匹配并执行 SOP
const matched = LiteBrowser.recipes.matchSOP({ intent: '发布掘金' });
if (matched.matched) {
  console.log(`命中 SOP: ${matched.matched.name}`);
}

// 4. 委派后台异步任务
const task = LiteBrowser.tasks.delegate('juejin-publish', {
  variables: { input_6: '我的新文章' },
  headless: true,
});
console.log(`已委派任务: ${task.id}`);
```

---

## CLI 命令速查表

| 指令 | 说明 |
|---|---|
| `lite-browser open <url> [flags]` | 打开目标网页建立会话 (`--headless`, `--profile`, `--temp`) |
| `lite-browser snapshot [--json]` | 获取交互元素列表（@编号） |
| `lite-browser click <@id\|sel>` | 点击元素 |
| `lite-browser type <@id\|sel> <txt>` | 输入文本 |
| `lite-browser hover <@id\|sel>` | 悬停元素上方 |
| `lite-browser press <key>` | 触发按键事件 (Enter, Tab, Escape...) |
| `lite-browser select <@id\|sel> <val>` | 选择下拉选项 |
| `lite-browser upload <@id\|sel> <file>` | 上传文件 |
| `lite-browser scroll [up\|down] [px]` | 滚动页面 |
| `lite-browser screenshot [path]` | 视口截图 |
| `lite-browser eval "<code>"` | 控制台执行 JavaScript |
| `lite-browser cdp <method> [json]` | 发送底层 CDP 协议 |
| `lite-browser done --name <name> [flags]` | 沉淀或自愈更新 SOP (`--scope global\|project`) |
| `lite-browser sop list` | 查看所有 SOP、版本与运行统计 |
| `lite-browser sop match <url\|intent>` | 上下文智能匹配 SOP |
| `lite-browser sop run <name> [--var k=v]` | 确定性执行 SOP 并累计统计 |
| `lite-browser sop export <name> [--file]` | 导出 SOP 规范为 JSON |
| `lite-browser sop import <file> [flags]` | 导入 SOP 规范 (`--scope`) |
| `lite-browser sop validate <name\|file>` | 校验 SOP 结构完整性 |
| `lite-browser sop schedule <name> [flags]` | 更新调度与频次 |
| `lite-browser sop delete <name>` | 删除 SOP |
| `lite-browser delegate <name> [flags]` | 委派 SOP 至后台异步脱机执行 |
| `lite-browser task list [--limit N]` | 查看委派任务清单与状态 |
| `lite-browser task status <id>` | 查看委派任务详情与结果 |
| `lite-browser task logs <id> [--tail N]` | 查看委派任务运行日志 |
| `lite-browser cookie export [domain]` | 导出当前 Cookies |
| `lite-browser cookie import <file>` | 导入 Cookies |
| `lite-browser cookie clear` | 清理 Cookies |
| `lite-browser profile list` | 列出持久化 Profiles |
| `lite-browser mcp` | 启动 MCP STDIO 插件服务 |

---

## 许可证

[MIT License](LICENSE) © 2026 webkubor
