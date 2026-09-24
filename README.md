# lite-browser

**极致轻量、零常驻、具身自进化的 AI 浏览器操控工具 (v1.0.0 MVP)** —— 专为 AI Agent 与自动化脚本设计。

零依赖、冷启动 < 20ms、支持 DOM 候选元素编号、8 大原子动作与 **SOP 元数组生命周期自进化引擎**。

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg?style=flat-square)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 解决的核心痛点

| 传统浏览器 Agent / 工具 | **lite-browser (自研轻量解法)** |
|---|---|
| 磁盘占用几百兆，常驻后台吃 1GB 内存，taskspace 频繁超限 | **单文件原生 Mach-O（~60MB 内嵌 Bun），零常驻后台进程** |
| 启动耗时数秒，依赖庞大 Playwright/Puppeteer 链路 | **冷启动 19ms，纯原生 WebSocket 驱动 Chrome CDP** |
| **AI 只会无脑新增**：每次探索产生冗余脚本，从不自愈更新 | **SOP 元数组管理 + 语义匹配 + 版本自增（v1.0.0 → v1.0.1）** |
| 重复消耗 LLM Token，每次探索不稳定且易幻觉 | **一次成功即沉淀为标准 SOP，二次执行 300ms 确定性直达** |
| 无法评估稳定性，缺乏执行统计 | **内置 Schedule 调度统计（频次、累计执行、成功率计数）** |

---

## 架构特性

```
lite-browser CLI (TypeScript + Bun Mach-O)
      │
      ├──> 原生 WebSocket ──> Google Chrome CDP (Port 9222)
      │                            │
      │                            ├──> DOM 元素编号 (@1, @2 ... 自动过滤视口外与不可见元素)
      │                            └──> 8 大原子操作 (open, click, type, scroll, wait, shot, eval, close)
      │
      └──> SOP 具身自进化引擎
            ├──> 元数组注册表 (~/.lite-browser/recipes/*.json)
            ├──> 智能语义与 URL 模式匹配 (lite-browser sop match)
            ├──> 版本升级与变更日志 (SemVer + changelog)
            └──> 调度与频次统计 (runCount, successCount, lastRunAt)
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
# 打开目标页面（支持有头与无头模式）
lite-browser open https://juejin.cn/editor/drafts/new

# 提取当前可视交互元素（自动生成 @1, @2 ... 精简编号）
lite-browser snapshot

# 在指定元素中输入文本与点击
lite-browser type @1 "端点、协议、API——调 AI 模型时那三个总被搞混的词"
lite-browser click @3

# 截图核验
lite-browser screenshot /tmp/juejin-draft.png
```

### 2. SOP 智能沉淀与元数组补充

当一次任务探索完成，使用 `done` 命令沉淀为标准化 SOP，自动提炼动态参数与匹配规则：

```bash
lite-browser done \
  --name "juejin-publish" \
  --desc "掘金文章录入、分类标签选择与发布流程" \
  --intent "发布掘金" \
  --domain "juejin.cn" \
  --frequency "daily"
```

生成具备完整元数组的 SOP 规范：
```json
{
  "name": "juejin-publish",
  "version": "1.0.0",
  "description": "掘金文章录入、分类标签选择与发布流程",
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
# 🎯 命中 SOP: "juejin-publish" (v1.0.0) [置信度: 80%]
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

---

## CLI 命令速查表

| 指令 | 说明 |
|---|---|
| `lite-browser open <url>` | 打开目标网页建立会话 |
| `lite-browser snapshot [--json]` | 获取交互元素列表（@编号） |
| `lite-browser click <@id\|selector>` | 点击元素 |
| `lite-browser type <@id\|selector> <txt>` | 输入文本 |
| `lite-browser scroll [up\|down] [px]` | 滚动页面 |
| `lite-browser screenshot [path]` | 视口截图 |
| `lite-browser done --name <name> [flags]` | 沉淀或自愈更新 SOP |
| `lite-browser sop list` | 查看所有 SOP、版本与运行统计 |
| `lite-browser sop match <url\|intent>` | 上下文智能匹配 SOP |
| `lite-browser sop run <name> [--var k=v]` | 确定性执行 SOP 并累计统计 |
| `lite-browser sop schedule <name> [flags]` | 更新调度与频次 |
| `lite-browser sop show <name>` | 查看完整 JSON 契约 |
| `lite-browser sop delete <name>` | 删除 SOP |

---

## 许可证

[MIT License](LICENSE) © 2026 webkubor
