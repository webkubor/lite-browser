# CHANGELOG

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
