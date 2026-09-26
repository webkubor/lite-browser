# CHANGELOG

## [1.4.0] - 2026-09-26

> **一句话摘要**：Agent 交接协议（人在环中的状态机与退出码契约）+ 外部脚本纳入沉淀体系的 `exec` 通道 + 资产发现。

### 🤝 Agent 交接协议 (Handoff Protocol) —— 本次核心
- **会话阶段状态机 (`SessionPhase`)**：新增 `idle → launching → acting → awaiting_human → done/failed` 显式阶段，任何命令都能读到「现在到底卡在哪一步」，不再靠 Agent 自己猜。
- **加权登录墙探测 (`AUTH_PROBE_SCRIPT`)**：通过 URL 登录路径 (+3)、密码输入框 (+3)、二维码 (+2)、登录/注册文案 (+1) 正向加权，配合「退出登录 / Sign out」(-4)、头像 (-1)、会话 Cookie (-1) 负向扣分；总分 `>=3` 判为未登录，`<=0` 且有负向信号判为已登录，否则 `unknown`。**避免把「页面里有个登录链接」误判成登录墙。**
- **`awaiting_human` 一等公民**：新增 `lite-browser await-human` 与 `delegate --await-human <秒>`，阻塞轮询直到人类完成登录/扫码/验证码，或超时退出。
- **退出码契约**：`0=正常 1=执行错误 2=参数错误 3=需要人类介入 4=等待人类超时`。调用方 Agent 可以直接 `case $?` 决策，不必解析自然语言输出。
- **交接卡片渲染**：`snapshot` / `whoami` / `status` 输出统一附带阶段、登录态、待办与下一步建议（`phase` / `auth` / `needs` / `nextAction`）。
- **委派任务可续跑**：`DelegatedTask.status` 新增 `awaiting_human`，人类介入后 Worker 自动续跑后续步骤；等待人类超时**不再误判为失败**，新增 `lite-browser task retry <id>`。
- **登录域分为「已验证」与「仅访问过」**：`--reuse` 只认探测确认过的域，历史上按域名猜登录态导致「复用成功但页面仍是登录墙」的假阳性被消除。

### ✨ 新增特性 (What's New)
- **`lite-browser exec -- <命令>`**：让自写在仓库里的 CDP / Python / Shell 脚本经由动作层执行，从而被轨迹引擎记录、最终由 `done` 自动沉淀为 SOP。**这是外部脚本进入沉淀体系的正式通道**，不需要手工注册。
- **`lite-browser sop adopt <name> --script <路径> --intent "..."`**：一次性收编历史脚本（补救通道，不是常规路径）。支持 `--args "collect all"` 传入子命令/开关，以及 `--frequency weekly` 一次定好调度 —— 真实脚本几乎都带子命令，不带参数的收编只是一条跑不起来的壳子。
- **资产发现 (`discoverAssets`)**：`sop list` 会扫描 `sop/`、`docs/`、`scripts/`、`bin/`，把「项目里已经存在但没纳入索引」的自动化资产列出来 —— 索引不到 ≠ 没做。只读，不写任何文件。带域名的资产优先展示、脚本优先于文档、默认展示 25 条（`--json` 取全量）。
- **`lite-browser status`**：一眼看全当前 Agent 的会话、阶段、登录态与在跑任务。
- **MCP 工具扩充**：新增 `browser_status`、`await_human`、`run_script`。

### 🐛 缺陷修复 (Bug Fixes)
- **修复编译版二进制无法拉起委派 Worker**（长期存在的发布级缺陷）：旧代码 `spawn(process.execPath, [process.argv[1], '_task_worker', ...])` 在单文件编译产物下会把 `/$bunfs/root/lite-browser` 重复插入 argv，Worker 启动即打印 USAGE 并退出，**委派功能在正式二进制上等于不可用**。新增 `selfEntryArgs()` 按编译/非编译两种运行时分别推导入口参数。
- 修复 `sop run --dry-run` 输出 `undefined 步`（导入的 JSON 没有 `stepCount` 字段）。
- 修复 `sop run --dry-run` 污染成功率统计（dry-run 不再计入 `recordRun`）。
- 修复资产扫描把脚本 shebang 当成描述，导致列表里每个脚本的说明都是 `#!/usr/bin/env node`。
- 修复多会话并存时连接歧义：新增会话改为按 Agent 分文件存放（`~/.lite-browser/sessions/<agent>.json`），不再共用全局单文件；存在多个活跃会话时抛出明确的歧义错误而非随机连接。
- 修复 `open()` 会把 `awaiting_human` 阶段冲掉、CLI 硬编码 `profile='default'`、`delegate` 未透传 agent/port/profile 等交接相关缺陷。
- 修复空轨迹时 `done` 的报错不知所云：现在明确说明「自写 CDP 脚本对动作层不可见」，并给出两种修法。

### ⚠️ 破坏性变更与迁移 (Breaking Changes & Migration)
- 会话文件路径由共享的 `/tmp/lite-browser-session.json` 迁移为 `~/.lite-browser/sessions/<agent>.json`。旧注册表里的 `loginDomains` 会自动迁移为 `visitedDomains`（即**降级为「仅访问过」，不再被 `--reuse` 复用**）。若某站点此前依赖按域名猜登录态复用，请重新登录一次使其被探测确认为 `verifiedDomains`。

### 📦 安装与升级 (Install & Upgrade)
```bash
# 全局更新构建
cd ~/dev/agent-infra/lite-browser && bun run build
# 或通过一键脚本安装
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## [1.3.0] - 2026-09-26

> **一句话摘要**：系统 Chrome 凭据安全解密提取（零密码交互）与富文本多行键盘注入管线。

### ✨ 新增特性 (What's New)
- **系统 Chrome 登录态安全提取 (`cookie pull-system`)**：新增 `lite-browser cookie pull-system [domain]`，支持从 macOS Keychain 动态检索凭据，基于 AES-128-CBC 解密 Chrome SQLite 数据库并剥离 32 字节 HMAC 校验头，日常已登录网站 Cookie 秒级导入 CDP 会话，零扫码交互。
- **富文本多行注入管线**：`type` 原子动作全面重构，新增 `Shift+Enter` (modifier 8) 逐行物理击键调度，彻底解决 Twitter/X、掘金、飞书等基于 Lexical/Draft.js 现代富文本编辑器在多段落输入时被截断或单行覆盖的难题。

### ⚡️ 体验与性能优化 (Improvements)
- **DOM 内容安全清空**：`type` 操作在注入前自动识别 `contenteditable` 容器，通过 `Selection.selectAllChildren` + `document.execCommand('delete')` 执行物理清空，杜绝多次键入时的文本重复追加。
- **轻量编译构建**：Bun 单二进制静态打包耗时仅 197ms，单文件交付，零外部依赖。

### 🐛 缺陷修复 (Bug Fixes)
- 修复 macOS 系统 Chrome Cookie 数据库文件处于活跃锁定状态时读取失败的问题（引入临时 DB 快照隔离读取）。
- 修复多段落富文本键入时回车事件被某些编辑器状态机误判为立即发送的缺陷。

### ⚠️ 破坏性变更与迁移 (Breaking Changes & Migration)
无破坏性变更（100% 向后兼容）。

### 📦 安装与升级 (Install & Upgrade)
```bash
# 全局更新构建
cd ~/dev/agent-infra/lite-browser && bun run build
# 或通过一键脚本安装
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## v1.2.0 (2026-09-25)

**核心突破：多 Agent 身份感知隔离 + 跨 Agent 凭据与登录态智能复用 (免重复扫码) + 全景诊断工具**

### 🤖 多 Agent 身份感知与端口隔离 (Multi-Agent Tenancy)
- **调用者身份感知**：新增 `SessionRegistry.detectCurrentAgent()`，支持从 `--agent <name>` 显式参数、环境变量（`LITE_BROWSER_AGENT`, `ANTIGRAVITY_AGENT`, `CLAUDE_CODE`, `CODEX`, `HERMES`）自动识别调用者身份。
- **端口与 Profile 专属隔离**：为不同 Agent 自动分配独立调试端口（9222, 9223...）与独立 Profile 存储目录（`~/.lite-browser/profiles/agent-<name>`），杜绝 Claude Code 与 Gemini 等多 Agent 并行执行时的端口抢占与数据覆盖。

### 🔑 跨 Agent 凭据与登录态智能复用 (--reuse)
- **免扫码零重复登录**：新增 `--reuse` 标志与 `registry.findByDomain()` 机制。任意 Agent 只要在某平台（如稀土掘金、小红书、GitHub）登录过，后续任意 Agent 均可携带 `--reuse` 直接接管已有登录态与 Cookie，彻底告别重复弹码。
- **平台登录域自动注册**：会话在导航与交互过程中自动提取主域名并关联至 `session-registry.json`，亦可通过 `lite-browser session mark-login <domain>` 手动标记。

### ⚡ 特质性闪电徽章与 Tab 自愈 (Title Badge & Self-Healing)
- **极具辨识度的闪电标识**：浏览器打开或操控网页时，Tab 标题自动注入 `⚡ [lite:<agent>] 原标题`（例如 `⚡ [lite:gemini] 稀土掘金`），并由 `Page.addScriptToEvaluateOnNewDocument` 与 title setter 劫持技术确保 SPA 动态路由切换后徽章依然持久驻留。
- **失效 Tab 自动重连自愈**：若原调试 Tab 被关闭，`connectToSession` 自动扫描当前端口存活有效 Page 并就地自愈重连，避免报错。

### 📋 全景会话诊断与注册表运维
- **身份与状态自省 (`whoami`)**：新增 `lite-browser whoami` 指令，输出当前 Agent 身份、CDP 端口、Profile 路径、活跃页面标题/URL、关联登录域及实时端口连通性。
- **多会话注册中心管理 (`session`)**：
  - `session list`：实时表格化展示所有注册 Agent 会话及其在线状态。
  - `session clean`：检测并标记清理失效离线会话。
  - `session remove <agent|port>`：移除指定会话记录。
  - `session mark-login <domain>`：显式标记登录域名。

---

## v1.1.1 (2026-09-25)

### 🐛 缺陷修复与稳定性增强 (Bug Fixes & Hardening)
- **根治输入框文本重复追加 Bug**：重构 `type` 原子动作底层机制，前置执行选中清空，并由模拟逐字击键切换为 CDP 原生标准 `Input.insertText`，杜绝掘金、飞书等富文本/SPA 框架输入时因双重赋值导致文本追加两遍的严重缺陷。
- **构建产物同步**：更新预编译 Mach-O 原生二进制产物至 v1.1.1。

## v1.1.0 (2026-09-25)

**核心突破：开放插件化生态 + 异步任务委派 + 团队 SOP 共享流通 + 极简一行安装**

### 🔌 AI 插件化服务 (Model Context Protocol)
- **原生 MCP 服务端**：内置基于 JSON-RPC 2.0 规范的 STDIO MCP 服务端（`lite-browser mcp`），实现零外部依赖的 AI 插件化接入。
- **18+ 项工具自动注册**：全面暴露 `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_hover`, `browser_press`, `browser_select`, `browser_cdp`, `sop_match`, `sop_run`, `sop_list`, `sop_save`, `task_delegate`, `task_status` 等工具定义与严格 JSON Schema。
- **AI 宿主一键挂载**：支持在 Claude Code、Cursor、Windsurf、Zed、DeepSeek Harness 等各类主流 Agent 系统中通过配置一键接入。

### 🚀 异步任务委派引擎 (Task Delegation)
- **脱机异步运行**：新增 `lite-browser delegate <sopName>` 指令，将长时间执行的浏览器任务剥离至后台子进程异步运行，立即返回 Task ID，彻底解决占用主对话会话的问题。
- **任务审计与排障追踪**：新增 `lite-browser task list`、`lite-browser task status <id>` 与 `lite-browser task logs <id> [--tail N]`，提供任务耗时、执行状态与实时日志检索能力。

### 🤝 团队 SOP 共享与双作用域支持
- **双作用域注册表**：支持代码库本地项目级（`./.lite-browser/recipes`）与用户全局（`~/.lite-browser/recipes`）SOP 存储，团队沉淀的自动化资产可随 Git 代码库一同版本化提交。
- **SOP 规范流通**：新增 `sop export`（导出标准 JSON）、`sop import`（导入团队规范）与 `sop validate`（SOP 语法与步骤合法性校验）。

### 🛠️ 核心交互与会话运维补全
- **基础交互原子动作扩充**：新增 `hover`（悬停）、`press`（按键事件）、`select`（下拉选项）、`upload`（文件批量上传），原子操作增至 12 项，并在轨迹记录与 SOP 引擎中原生支持。
- **运行时修复**：补齐 `launchOrConnect`、`getTitle`、`getUrl` 实现，解决 `open` 指令底层调用异常。
- **持久化 Profile**：引入 `--profile <name>` 参数，支持独立环境隔离，解决 Cookie 与登录状态丢失问题。
- **Cookie 运维**：新增 `cookie export`、`cookie import` 与 `cookie clear` 实用工具。

### ⚡ 极简安装与高信噪比体验
- **一行命令安装**：新增 `install.sh`，支持 `curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash` 一键安装并软链至 PATH。
- **README 减法设计**：重构文档结构，聚焦宣传卖点、一行安装与最简三步使用入口，技术细节内敛至 CLI 与源码。

---

## v1.0.0 (2026-09-25)

**初始 MVP 发布：极致轻量、零常驻、具身自进化的 AI 浏览器操控工具**

- **极速 CDP 链路**：纯原生 WebSocket 直连 Chrome CDP，冷启动 < 20ms。
- **单文件原生二进制**：内嵌 Bun 编译为单文件 Mach-O 可执行程序，零常驻守护进程。
- **DOM 候选元素编号**：自动过滤视口外与不可见元素，生成 `@1`, `@2` 精简候选标号。
- **8 大基础原子操作**：`open`, `click`, `type`, `scroll`, `wait`, `screenshot`, `eval`, `cdp`。
- **SOP 具身自进化引擎**：支持任务轨迹自动提炼、参数变量化抽取、语义模式匹配与版本就地自愈递增（v1.0.0 → v1.0.1）。
- **调度频次统计**：内置 Schedule 调度元数据（累计执行次数、成功率统计与时间戳）。
