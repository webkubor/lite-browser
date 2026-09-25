# lite-browser

**Ultra-lightweight, zero-daemon, embodied self-evolving AI browser control engine** —— Designed for AI Agents, instant automation, multi-agent tenancy, and team collaboration.

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.2.0-green.svg?style=flat-square)](package.json)
[![Multi-Agent](https://img.shields.io/badge/multi--agent-Caller_Aware-blueviolet.svg?style=flat-square)](README.en.md)
[![Zero-Relogin](https://img.shields.io/badge/auth--reuse-Zero_Relogin-success.svg?style=flat-square)](README.en.md)
[![MCP](https://img.shields.io/badge/MCP-Plugin_Ready-purple.svg?style=flat-square)](src/mcp.ts)
[![Protocol](https://img.shields.io/badge/protocol-Chrome_CDP-blue.svg?style=flat-square)](https://chromedevtools.github.io/devtools-protocol/)
[![Architecture](https://img.shields.io/badge/architecture-Zero_Daemon-success.svg?style=flat-square)](README.en.md)
[![Cold Start](https://img.shields.io/badge/cold_start-%3C20ms-orange.svg?style=flat-square)](README.en.md)
[![Platform](https://img.shields.io/badge/platform-macOS_%7C_Linux-lightgrey.svg?style=flat-square)](README.en.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 🌟 Why lite-browser?

- 🤖 **Agent Identity Isolation (`--agent`)**: Automatically recognizes caller agents (`Claude Code`, `Gemini`, `Codex`, `Hermes`). Dynamically allocates dedicated CDP ports and isolated user profiles, preventing multi-agent collision.
- 🔑 **Zero-Relogin State & Token Reuse (`--reuse`)**: Tracks authenticated domain credentials across sessions. Once any agent logs in via QR/auth on a domain, other agents with `--reuse` attach to the authenticated session immediately.
- 📋 **Full Observability (`whoami` & `session list`)**: Real-time diagnostic inspection of active caller agent, bound port, active URL, and authenticated domain credentials.
- ⚡ **Millisecond Cold Start**: < 20ms startup, pure native WebSocket direct to Chrome CDP. No heavy Playwright/Puppeteer overhead.
- 🍃 **Zero Persistent Daemon**: Single-file native binary (~60MB embedded Bun). Zero background memory consumption, no leaked processes.
- 🔄 **Embodied SOP Self-Evolution**: Record once into a standard SOP. Future runs hit automatically via semantic matching in 300ms with **0 Token waste**. Auto-heals in-place upon page redesigns (v1.0.0 → v1.0.1) — **never creates duplicate scripts**.
- 🚀 **Asynchronous Task Delegation**: Offload long-running scraping or publishing jobs to detached background workers with a single command.
- 🔌 **Seamless Plugin Ecosystem**: Built-in Model Context Protocol (MCP) server. 1-click integration with Claude Code, Cursor, Windsurf, Zed, and other AI systems.

---

## ⚡ One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/webkubor/lite-browser/main/install.sh | bash
```

---

## 🎯 Core Workflows

### 1. Multi-Agent Caller Isolation & Zero-Relogin Reuse (v1.2.0)

```bash
# Diagnose caller agent identity and bound session
lite-browser whoami

# Launch with explicit agent isolation
lite-browser open https://juejin.cn/creator --agent claude-code

# Another agent reuses authenticated session without re-scanning QR code
lite-browser open https://juejin.cn/editor/drafts/new --agent gemini --reuse

# Inspect all registered agent sessions
lite-browser session list

# Clean up exited/dead sessions
lite-browser session clean
```

### 2. Fast Interactive Browsing & Inspection

```bash
# Open page and establish session
lite-browser open https://juejin.cn/editor/drafts/new

# Extract viewport interactive elements numbered as @1, @2 ...
lite-browser snapshot

# Click and type text cleanly via CDP native insertion
lite-browser click @1
lite-browser type @2 "My Article Title"
lite-browser press Enter
lite-browser screenshot /tmp/post-preview.png
```

### 3. SOP Crystallization & Task Delegation

```bash
# Crystallize trajectory into standard SOP (auto-evolves if exists)
lite-browser done --name "juejin-publish" --desc "Automated Juejin Publishing"

# Delegate to detached background execution (returns immediately with task ID)
lite-browser delegate juejin-publish --headless

# Check background task status and logs
lite-browser task list
lite-browser task logs <task_id>
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

## 📖 CLI Cheatsheet

| Category | Command | Description |
| :--- | :--- | :--- |
| **Agent Registry** | `lite-browser whoami` | Diagnose caller agent identity, port, profile, and domains |
| | `lite-browser session list` | List all registered agent sessions, ports, PIDs, and login domains |
| | `lite-browser session clean` | Detect and prune dead/exited browser sessions |
| | `lite-browser session remove <id>` | Remove specific agent or port session record |
| | `lite-browser session mark-login <domain>`| Register platform domain authentication status |
| **Actions** | `lite-browser open <url> [--agent X] [--reuse]` | Open URL with port/profile isolation & auth reuse |
| | `lite-browser snapshot [--json]` | Extract interactive elements numbered as `@1`, `@2` ... |
| | `lite-browser click <@id\|selector>` | Click element |
| | `lite-browser type <@id\|selector> <text>` | Precise text insertion via CDP |
| | `lite-browser hover <@id\|selector>` | Hover over element to trigger hover menus/states |
| | `lite-browser press <key>` | Send keyboard key (Enter, Escape, Tab, etc.) |
| | `lite-browser select <@id> <value>` | Select dropdown option |
| | `lite-browser upload <@id> <files...>` | Upload local files |
| | `lite-browser screenshot [path]` | Capture viewport/full screenshot |
| | `lite-browser cdp <method> [json]` | Send raw CDP command |
| | `lite-browser close` | Terminate session and clean up connection |
| **SOP Evolution** | `lite-browser done --name <name>` | Record trajectory into SOP with auto-healing upgrade |
| | `lite-browser sop list / match / show / run`| SOP list, semantic matching, show, and execution |
| | `lite-browser sop export / import / validate`| Team SOP sharing, import/export, and schema validation |
| **Delegation** | `lite-browser delegate <name> [--var k=v]` | Offload SOP to detached background execution |
| | `lite-browser task list / status / logs` | Task list, status inspection, and live logs |

---

## 🏷️ Discovery Keywords & Tags

`multi-agent` · `session-registry` · `token-reuse` · `login-reuse` · `cdp` · `chrome-devtools-protocol` · `mcp` · `model-context-protocol` · `zero-daemon` · `bun` · `browser-automation` · `sop-evolution` · `embodied-ai` · `task-delegation` · `rpa` · `browser-use` · `claude-code` · `gemini-agent` · `codex` · `hermes` · `playwright-alternative` · `puppeteer-alternative`

---

## License

[MIT License](LICENSE) © 2026 webkubor
