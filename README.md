# lite-browser

**极致轻量、零常驻、可沉淀的 AI 浏览器操控工具** —— 专为 AI Agent 与自动化脚本设计。

零依赖、冷启动 < 20ms、支持 DOM 候选元素编号、8 大原子动作与任务轨迹 Recipe 自动沉淀回放。

[![Bun](https://img.shields.io/badge/runtime-Bun_1.4+-black?style=flat-square&logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## 为什么需要 lite-browser

| 痛点（Ego Lite / 传统浏览器 Agent） | **lite-browser（自研轻量解法）** |
|---|---|
| 磁盘占用几百兆，常驻 8~10 个进程吃 1GB 内存 | **单二进制文件（~60MB 内嵌 Bun），零常驻后台进程** |
| 启动耗时数秒，经常 taskspace 满或截图卡死 | **冷启动 19ms，直接原生 WebSocket 驱动 Chrome CDP** |
| 每次执行都在做重复探索，Token 消耗大且易幻觉 | **成功一次自动沉淀为 Recipe，二次回放 300ms 确定性直达** |
| 复杂黑盒闭源 Mach-O，出了问题无法排查 | **100% TypeScript 源码，完全透明可控** |

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

## 核心工作流

### 1. 交互与探索（快思考友好）

```bash
# 打开目标网页
lite-browser open https://www.baidu.com

# 提取可视区域候选元素（编号为 @1, @2 ...）
lite-browser snapshot

# 在指定元素中输入并点击
lite-browser type @1 "CortexOS"
lite-browser click @2

# 截图保存（可喂给本地 mlx-vlm 审查）
lite-browser screenshot /tmp/search-result.png
```

### 2. 任务沉淀（一次成功，永久复用）

当一次探索执行成功后，将其**沉淀为命名 Recipe**：

```bash
# 沉淀当前会话的动作轨迹并自动提炼变量
lite-browser done --name "baidu-search" --desc "百度关键词检索流程"

# 查看所有已沉淀的 Recipe
lite-browser recipe list
```

### 3. 高速回放（零大模型开销，秒级直达）

第二次执行时，无需大模型分析 DOM，直接确定性回放：

```bash
# 直接回放并动态传入参数
lite-browser recipe run "baidu-search" --var input_1="广州天气"
```

---

## 8 大原子动作

- `open <url> [--headless]`
- `snapshot [--json]`
- `click <@id|selector>`
- `type <@id|selector> <text>`
- `scroll [up|down] [amount]`
- `wait [seconds]`
- `screenshot [path]`
- `close`

---

## 架构

```
lite-browser CLI (TypeScript)
      │
      ├──> 原生 WebSocket ──> Google Chrome CDP (Port 9222)
      │                            │
      │                            ├──> DOM 元素编号 (@1, @2)
      │                            └──> 鼠标/键盘原子事件注入
      │
      └──> Recipe Engine ──> ~/.lite-browser/recipes/*.json
                                   │
                                   └──> 确定性秒级回放 (Zero LLM)
```

## 许可证

[MIT License](LICENSE)
