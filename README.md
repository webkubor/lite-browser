# lite-browser

**极致轻量、零常驻、具身自进化的 AI 浏览器操控工具** —— 专为 AI Agent、极速自动化与团队协作设计。

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg?style=flat-square)](package.json)
[![MCP](https://img.shields.io/badge/MCP-Plugin_Ready-purple.svg?style=flat-square)](src/mcp.ts)
[![Protocol](https://img.shields.io/badge/protocol-Chrome_CDP-blue.svg?style=flat-square)](https://chromedevtools.github.io/devtools-protocol/)
[![Architecture](https://img.shields.io/badge/architecture-Zero_Daemon-success.svg?style=flat-square)](README.md)
[![Cold Start](https://img.shields.io/badge/cold_start-%3C20ms-orange.svg?style=flat-square)](README.md)
[![Platform](https://img.shields.io/badge/platform-macOS_%7C_Linux-lightgrey.svg?style=flat-square)](README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 为什么选择 lite-browser？

- ⚡ **毫秒级冷启动**：< 20ms 冷启动，纯原生 WebSocket 直连 Chrome CDP，告别笨重的 Playwright/Puppeteer 链路。
- 🍃 **零后台常驻**：单文件原生可执行程序（~60MB 内嵌 Bun），不常驻后台吃内存，彻底摆脱进程泄漏。
- 🔄 **SOP 具身自进化**：一次操作成功即沉淀为标准 SOP。下次自动语义命中，300ms 确定性直达，**0 Token 消耗**；遇页面改版原地自愈升级（v1.0.0 → v1.0.1），**绝不无脑新增垃圾脚本**。
- 🚀 **异步任务委派**：长时间运行的抓取或发文任务，一行命令直接委派后台脱机运行，不卡主对话。
- 🔌 **全生态插件接入**：内置 Model Context Protocol (MCP) 原生服务，无缝接入 Claude Code、Cursor、Windsurf、Zed 等所有主流 AI 系统。

---

## ⚡ 一行命令安装

```bash
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## 🎯 极简使用入口

只需三步，即可完成浏览器自动化探索、任务沉淀与后台委派：

```bash
# 1. 打开网页交互（元素自动精简编号为 @1, @2 ...）
lite-browser open https://juejin.cn/editor/drafts/new
lite-browser snapshot
lite-browser click @1
lite-browser type @2 "文章标题"

# 2. 沉淀为标准 SOP（下次遇到类似任务，自动命中毫秒级直达）
lite-browser done --name "juejin-publish"

# 3. 委派给后台脱机异步执行（立即返回任务 ID，无需等待）
lite-browser delegate juejin-publish --headless
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

## 📖 命令帮助

所有高级参数与完整指令已内敛至 CLI 中，随时输入以下命令查看：

```bash
lite-browser --help
```

---

## 许可证

[MIT License](LICENSE) © 2026 webkubor
