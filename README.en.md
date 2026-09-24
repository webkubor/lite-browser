# lite-browser

**Ultra-lightweight, zero-daemon, embodied self-evolving AI browser control engine** —— Designed for AI Agents, instant automation, and team collaboration.

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg?style=flat-square)](package.json)
[![MCP](https://img.shields.io/badge/MCP-Plugin_Ready-purple.svg?style=flat-square)](src/mcp.ts)
[![Protocol](https://img.shields.io/badge/protocol-Chrome_CDP-blue.svg?style=flat-square)](https://chromedevtools.github.io/devtools-protocol/)
[![Architecture](https://img.shields.io/badge/architecture-Zero_Daemon-success.svg?style=flat-square)](README.en.md)
[![Cold Start](https://img.shields.io/badge/cold_start-%3C20ms-orange.svg?style=flat-square)](README.en.md)
[![Platform](https://img.shields.io/badge/platform-macOS_%7C_Linux-lightgrey.svg?style=flat-square)](README.en.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## Why lite-browser?

- ⚡ **Millisecond Cold Start**: < 20ms startup, pure native WebSocket direct to Chrome CDP. No heavy Playwright/Puppeteer overhead.
- 🍃 **Zero Persistent Daemon**: Single-file native binary (~60MB embedded Bun). Zero background memory consumption, no leaked processes.
- 🔄 **Embodied SOP Self-Evolution**: Record once into a standard SOP. Future runs hit automatically via semantic matching in 300ms with **0 Token waste**. Auto-heals in-place upon page redesigns (v1.0.0 → v1.0.1) — **never creates junk duplicate scripts**.
- 🚀 **Asynchronous Task Delegation**: Offload long-running scraping or publishing jobs to detached background workers with a single command.
- 🔌 **Seamless Plugin Ecosystem**: Built-in Model Context Protocol (MCP) server. 1-click integration with Claude Code, Cursor, Windsurf, Zed, and other AI systems.

---

## ⚡ One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## 🎯 Quick Entrypoint

Just three simple steps to explore, crystallize, and delegate browser tasks:

```bash
# 1. Open page & interact (DOM elements automatically numbered as @1, @2 ...)
lite-browser open https://juejin.cn/editor/drafts/new
lite-browser snapshot
lite-browser click @1
lite-browser type @2 "Article Title"

# 2. Crystallize into a standard SOP (hits automatically on subsequent requests)
lite-browser done --name "juejin-publish"

# 3. Delegate to detached background execution (returns immediately with task ID)
lite-browser delegate juejin-publish --headless
```

---

## 🔌 AI Plugin Setup (MCP)

Add `lite-browser` to your Claude Code / Cursor / Windsurf config (e.g. `~/.claude/mcp.json`):

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

Once added, your AI agent can natively drive the browser, match existing SOPs, and delegate automation tasks.

---

## 📖 Command Help

All flags and detailed options are encapsulated inside the CLI:

```bash
lite-browser --help
```

---

## License

[MIT License](LICENSE) © 2026 webkubor
