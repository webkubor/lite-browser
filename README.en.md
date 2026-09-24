# lite-browser

**Ultra-lightweight, zero-daemon, embodied self-evolving AI browser control engine (v1.1.0)** —— Designed for AI Agents, automation workflows, and team collaboration.

Zero external dependencies, < 20ms cold start, viewport DOM element ref numbering (`@1`, `@2`), 12 atomic actions, **SOP self-evolution engine**, **asynchronous task delegation engine**, **team SOP sharing specs**, and **built-in Model Context Protocol (MCP) server**.

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg?style=flat-square)](package.json)
[![MCP](https://img.shields.io/badge/MCP-JSON--RPC_2.0-purple.svg?style=flat-square)](src/mcp.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## Core Pain Points Solved

| Traditional Browser Agents | **lite-browser (Lightweight Solution)** |
|---|---|
| Hundreds of MBs on disk, eating 1GB RAM as background daemons | **Single-file native binary (~60MB embedded Bun), 0 persistent daemons** |
| Multi-second cold start with heavy Playwright/Puppeteer stacks | **19ms cold start, pure native WebSocket direct to Chrome CDP** |
| **Agents only create redundant duplicates without healing** | **SOP meta registry + semantic matching + in-place version bumps (v1.0.0 → v1.0.1)** |
| Repetitive LLM token waste on routine DOM exploration | **Record once into standard SOP; subsequent runs take 300ms deterministically** |
| Hard to share automation recipes across team members | **Dual scopes (`./.lite-browser` in repo & `~/.lite-browser` global) with export/import/validate** |
| Agents blocked while waiting for long automation tasks | **Detached asynchronous task delegation engine (`delegate`, `task list/status/logs`)** |
| Siloed execution across different agent architectures | **Built-in MCP (Model Context Protocol) STDIO server for 1-click plugin integration** |

---

## Architecture

```
lite-browser (TypeScript + Bun Mach-O)
      │
      ├──> Native WebSocket ──> Google Chrome CDP (Port 9222)
      │                            │
      │                            ├──> Viewport DOM numbering (@1, @2 ... invisible/out-of-bounds filtered)
      │                            ├──> 12 Atomic operations (open, click, type, hover, press, select, upload, scroll, wait, shot, eval, cdp)
      │                            └──> State & session persistence (Profile isolation, Cookies export/import/clear)
      │
      ├──> SOP Self-Evolution & Team Collaboration Engine
      │     ├──> Dual-scope meta registry (Global ~/.lite-browser / Project ./.lite-browser)
      │     ├──> Intelligent semantic & URL pattern matching (lite-browser sop match)
      │     ├──> In-place healing upgrades & changelog (SemVer + changelog)
      │     ├──> Team sharing & distribution (sop export, import, validate)
      │     └──> Scheduling & frequency telemetry (runCount, successCount, lastRunAt)
      │
      ├──> Asynchronous Task Delegation Engine
      │     ├──> Detached background execution (lite-browser delegate)
      │     └──> Task audit trails & log streaming (task list, status, logs)
      │
      └──> Open Plugin Ecosystem (MCP & SDK)
            ├──> Model Context Protocol (MCP) STDIO Server (lite-browser mcp)
            └──> Unified TypeScript / ESM SDK Facade (import { LiteBrowser })
```

---

## Installation & Quickstart

```bash
# 1. Compile to single-file native binary
bun run build

# 2. Symlink to PATH
ln -sf $(pwd)/bin/lite-browser ~/.local/bin/lite-browser

# 3. Verify ready
lite-browser --help
```

---

## Key Capabilities

### 1. Interactive Exploration

```bash
# Open page with persistent profile
lite-browser open https://juejin.cn/editor/drafts/new --profile default

# Extract interactive viewport elements with @ID numbering
lite-browser snapshot

# Type and click
lite-browser type @1 "Article Title"
lite-browser click @3

# Hover and keyboard press
lite-browser hover @5
lite-browser press Enter

# Select and file upload
lite-browser select @6 "technology"
lite-browser upload @7 /path/to/cover.png

# Take screenshot
lite-browser screenshot /tmp/screenshot.png
```

### 2. SOP Recording & Self-Evolution

Once a task exploration succeeds, crystallize it into a standardized SOP:

```bash
lite-browser done \
  --name "juejin-publish" \
  --desc "Juejin article publish SOP" \
  --intent "publish juejin" \
  --domain "juejin.cn" \
  --scope "global" \
  --frequency "daily"
```

If the page structure changes or execution hits a snag, self-heal in place:

```bash
lite-browser done --name "juejin-publish" --reason "Updated tags selector"
```

### 3. Task Delegation (Asynchronous Background Runs)

```bash
# Delegate SOP to run asynchronously in background (returns immediately with task ID)
lite-browser delegate juejin-publish --var input_6="Deep Dive" --headless

# Check task status and logs
lite-browser task list
lite-browser task status <task_id>
lite-browser task logs <task_id>
```

### 4. Team Sharing & Project Scope

```bash
# Export SOP specification
lite-browser sop export juejin-publish --file ./juejin-publish.json

# Import into local repository scope (committed into git)
lite-browser sop import ./juejin-publish.json --scope project

# Validate SOP contract
lite-browser sop validate ./juejin-publish.json
```

### 5. Model Context Protocol (MCP) Integration

Plug `lite-browser` directly into Claude Code, Cursor, Windsurf, Zed, or DeepSeek Harness:

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

---

## License

[MIT License](LICENSE) © 2026 webkubor
