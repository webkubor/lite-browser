# lite-browser

**极致轻量、零常驻、具身自进化的 AI 浏览器操控工具** —— 专为 AI Agent、极速自动化、多 Agent 租户隔离与团队协作设计。

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.4.0-green.svg?style=flat-square)](package.json)
[![Multi-Agent](https://img.shields.io/badge/multi--agent-Caller_Aware-blueviolet.svg?style=flat-square)](README.md)
[![Handoff](https://img.shields.io/badge/handoff-Human_in_the_Loop-critical.svg?style=flat-square)](README.md)
[![Zero-Relogin](https://img.shields.io/badge/auth--reuse-Zero_Relogin-success.svg?style=flat-square)](README.md)
[![MCP](https://img.shields.io/badge/MCP-Plugin_Ready-purple.svg?style=flat-square)](src/mcp.ts)
[![Protocol](https://img.shields.io/badge/protocol-Chrome_CDP-blue.svg?style=flat-square)](https://chromedevtools.github.io/devtools-protocol/)
[![Architecture](https://img.shields.io/badge/architecture-Zero_Daemon-success.svg?style=flat-square)](README.md)
[![Cold Start](https://img.shields.io/badge/cold_start-%3C20ms-orange.svg?style=flat-square)](README.md)
[![Platform](https://img.shields.io/badge/platform-macOS_%7C_Linux-lightgrey.svg?style=flat-square)](README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 🌟 为什么选择 lite-browser？

- 🤖 **Agent 身份感知与隔离 (`--agent`)**：自动识别 `Claude Code`、`Gemini`、`Codex`、`Hermes` 等 Agent 调用者身份，分配专属调试端口与独立 Profile，多 Agent 并行执行绝不踩踏端口。
- 🔑 **跨 Agent 登录态零重复登录 (`--reuse`)**：自动记录各平台登录域名（小红书、掘金、GitHub 等）。任意 Agent 只要扫码/登录过一次，其他 Agent 携带 `--reuse` 即可无缝复用已有登录态，彻底告别重复扫码。
- 📋 **全景感知与会话诊断 (`whoami` & `session list`)**：随时洞察当前是哪个 Agent 占用什么端口、跑了哪个页面、具有哪些平台的活跃会话与登录凭据。
- 🤝 **Agent 交接协议 (`status` / `await-human`)**：会话阶段是显式状态机，撞到登录墙会主动置为 `awaiting_human` 并告诉你「需要人做什么」；配合 `0/1/2/3/4` 退出码契约，调用方 Agent 不必猜、不必解析自然语言。
- 🧩 **已有脚本不必重写 (`exec`)**：仓库里现成的 CDP / Python / Shell 脚本经 `exec` 通道执行一次即可被自动沉淀为 SOP；`sop list` 还会把项目里未纳入索引的资产列出来，索引不到 ≠ 没做。
- ⚡ **毫秒级冷启动**：< 20ms 冷启动，纯原生 WebSocket 直连 Chrome CDP，告别笨重的 Playwright/Puppeteer 链路。
- 🍃 **零后台常驻**：单文件原生二进制可执行程序（内嵌 Bun），无后台内存泄漏守护进程。
- 🔄 **SOP 具身自进化引擎**：操作一次即沉淀为标准 SOP。下次任务语义命中，300ms 确定性直达，**0 Token 消耗**；遇页面改版原地自愈升级（v1.0.0 → v1.0.1），**绝不无脑新增垃圾脚本**。
- 🚀 **异步任务委派**：长时间运行的抓取或发文任务，一行命令直接委派后台脱机运行，立即返回任务 ID，主对话零阻塞。
- 🔌 **全生态插件接入**：内置 Model Context Protocol (MCP) 原生服务，无缝接入各类主流 AI 系统。

---

## ⚡ 一行命令安装

```bash
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## 🎯 核心场景与使用入口

### 1. 多 Agent 调用者身份感知与免登录复用 (v1.2.0 新特性)

```bash
# 诊断当前调用 Agent 身份与会话状态
lite-browser whoami

# 显式指定 Agent 身份运行（端口与 Profile 自动隔离）
lite-browser open https://juejin.cn/creator --agent claude-code

# 另一 Agent 调用时智能复用已有掘金登录态（无需重新扫码）
lite-browser open https://juejin.cn/editor/drafts/new --agent gemini --reuse

# 查看所有注册的 Agent 会话与登录域
lite-browser session list

# 清理已退出的失效会话
lite-browser session clean
```

### 2. 网页极速交互与自动化

```bash
# 打开网页建立会话
lite-browser open https://juejin.cn/editor/drafts/new

# 提取视口可交互元素并自动编号为 @1, @2 ...
lite-browser snapshot

# 点击与键入文本（防双重输入的 CDP 原生文本插入）
lite-browser click @1
lite-browser type @2 "文章标题"
lite-browser press Enter
lite-browser screenshot /tmp/post-preview.png
```

### 3. SOP 任务沉淀与后台委派

```bash
# 将交互轨迹提炼沉淀为 SOP（若已存在则原地版本升级与自愈）
lite-browser done --name "juejin-publish" --desc "稀土掘金文章自动发布"

# 委派给后台脱机异步执行（立即返回任务 ID，无需等待）
lite-browser delegate juejin-publish --headless

# 检查后台委派任务状态与日志
lite-browser task list
lite-browser task logs <task_id>

# 查看项目里已有的自动化资产（脚本/SOP 文档），只读不改
lite-browser sop list
```

### 4. Agent 交接协议：人在环中的状态机 (v1.4.0 新特性)

Agent 不该靠猜知道「现在该不该请你登录」。每次命令都会返回一个**显式阶段**和一个**退出码**，
调用方可以直接 `case $?` 分流，而不是解析自然语言输出。

```bash
# 一眼看清：会话阶段 / 登录态 / 在跑任务 / 下一步该做什么
lite-browser status

# 打开一个需要登录的站点：探测到登录墙会自动置为 awaiting_human
lite-browser open https://creator.xiaohongshu.com
# → ⏳ 阶段: awaiting_human   登录态: anonymous
#   👉 需要你做: 请在浏览器窗口中完成 creator.xiaohongshu.com 的登录（扫码 / 账号密码 / 验证码均可）

# 阻塞等待人类完成登录，完成后自动继续
lite-browser await-human --timeout 300
```

**退出码契约**：

| 退出码 | 含义 | 调用方应有的动作 |
| :--- | :--- | :--- |
| `0` | 正常完成 | 继续下一步 |
| `1` | 执行错误 | 读日志排查 |
| `2` | 参数错误 | 修正调用 |
| `3` | 需要人类介入 | 提示用户，然后 `await-human` |
| `4` | 等待人类超时 | 决定重试或放弃（**不是任务失败**） |

委派任务同样继承该契约：`delegate --await-human <秒>` 时任务会停在 `awaiting_human`
并保持存活，人类完成后 Worker 自动续跑剩余步骤；超时用 `task retry <id>` 恢复。

---

## 🧩 让已有脚本进入沉淀体系

沉淀引擎只记录**经过 lite-browser 动作层**的操作。仓库里现成的 CDP / Python / Shell 脚本
若自己直连调试端口，对动作层是不可见的 —— 这不代表活白干了，但 `sop list` 索引不到它。

```bash
# 正式通道：让脚本经由动作层执行一次，之后 done 就能自动沉淀出 SOP
lite-browser exec -- python3 scripts/xhs-collect.py collect all
lite-browser done --name "xhs-collect" --intent "小红书数据采集"

# 补救通道：一次性收编历史脚本（不是常规路径）
lite-browser sop adopt xhs-collect --script scripts/xhs-collect.py --intent "小红书数据采集"
```

---

## 🔌 AI 插件接入 (MCP)

在 Claude Code / Cursor / Windsurf 的配置文件（如 `~/.claude/mcp.json`）中直接加入：

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

配置后，AI 即可原生接管浏览器操作、匹配已有 SOP 或自动委派任务。

---

## 📖 CLI 指令速查表

| 分类 | 命令 | 说明 |
| :--- | :--- | :--- |
| **Agent 管理** | `lite-browser whoami` | 诊断当前调用 Agent 身份、占用端口、Profile 与登录域 |
| | `lite-browser status [--json]` | 会话阶段 / 登录态 / 在跑任务一览（交接协议入口） |
| | `lite-browser session list` | 查看所有注册的 Agent 会话、端口、PID 与登录域 |
| | `lite-browser session clean` | 检测并清理所有已退出的离线/失效会话 |
| | `lite-browser session remove <id>` | 移除指定 Agent 或端口的会话记录 |
| | `lite-browser session mark-login <domain>`| 显式标记当前会话已具备目标平台的登录态 |
| **人类交接** | `lite-browser await-human [--timeout N]` | 阻塞等待人类完成登录/扫码/验证码，完成后自动继续 |
| | `lite-browser resume` | 人类已完成后手动恢复会话并刷新阶段 |
| **基础操作** | `lite-browser open <url> [--agent X] [--reuse]` | 打开网页并分配独立会话（支持登录态智能复用） |
| | `lite-browser snapshot [--json]` | 提取页面可交互元素并标注 `@1`, `@2` 精简标号 |
| | `lite-browser click <@id\|selector>` | 点击指定元素 |
| | `lite-browser type <@id\|selector> <text>` | 输入文本（CDP 原生精确插入） |
| | `lite-browser hover <@id\|selector>` | 悬停在元素上方触发菜单/状态 |
| | `lite-browser press <key>` | 按下按键（Enter, Escape, Tab 等） |
| | `lite-browser select <@id> <value>` | 下拉选择指定选项 |
| | `lite-browser upload <@id> <files...>` | 上传一个或多个本地文件 |
| | `lite-browser screenshot [path]` | 当前页面截图 |
| | `lite-browser cdp <method> [json]` | 直接发送底层 CDP 协议命令 |
| | `lite-browser close` | 关闭连接并清理当前会话 |
| **SOP 进化** | `lite-browser done --name <name>` | 提炼轨迹为 SOP，若已存在自动升级并自愈 |
| | `lite-browser sop list / match / show / run`| SOP 列表、语义匹配、详情查看与执行（`--no-scan` 跳过资产扫描） |
| | `lite-browser sop export / import / validate`| 团队 SOP 规范共享与合法性校验 |
| | `lite-browser sop adopt <name>` | 一次性收编已有脚本为 SOP（补救通道） |
| **外部脚本** | `lite-browser exec -- <命令>` | 让自写脚本经由动作层执行，从而可被自动沉淀 |
| **任务委派** | `lite-browser delegate <name> [--var k=v]` | 将 SOP 委派至后台脱机运行（`--await-human` 允许人类介入） |
| | `lite-browser task list / status / logs / retry` | 委派任务清单、状态查询、日志回放与续跑 |

---

## 🏷️ 核心技术标签 (Keywords & Tags)

`multi-agent` · `session-registry` · `token-reuse` · `login-reuse` · `handoff-protocol` · `human-in-the-loop` · `cdp` · `chrome-devtools-protocol` · `mcp` · `model-context-protocol` · `zero-daemon` · `bun` · `browser-automation` · `sop-evolution` · `embodied-ai` · `task-delegation` · `rpa` · `browser-use` · `claude-code` · `gemini-agent` · `codex` · `hermes` · `playwright-alternative` · `puppeteer-alternative`

---

## 许可证

[MIT License](LICENSE) © 2026 webkubor
