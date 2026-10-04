# RFC 001: Lite-Browser 结合 jev-ultrafast 极速自动化引擎架构方案

## 1. 背景与动机

[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 提出了当前 Web Agent 领域响应最快、成本最低的执行范式（在 Google Flights 真实交互中实现 7.1 秒端到端完成多步航线检索，中位数 CDP 协议调用从 1,092 次骤降至 101 次）。

`lite-browser` 作为自研第一公民级轻量浏览器引擎，拥有单二进制（19ms 极速冷启动）、多 Agent 隔离与登录态复用（`--agent` / `--reuse`）、SOP 自进化沉淀（`sop match/done`）等工程护城河。

将 `jev-ultrafast` 的极速决策与状态机内核吸纳进 `lite-browser`，能够补齐 `lite-browser` 在「动态自主探索（Autonomous Exploration）」模式下的交互延迟短板，打造兼具「确定性 SOP 秒级重放」与「极速自主目标达成」的双核浏览器引擎。

---

## 2. Jev-Ultrafast 核心工程突破深度解析

| 核心创新 | Jev-Ultrafast 实现方案 | 对 Lite-Browser 的价值 |
|---|---|---|
| **单往返推测分发 (Speculative Fan-out)** | 单次模型请求同时预测 Operation（CLICK / TYPE / SELECT 等）与各个动作的 Target Heads，两个决策仅消耗一次网络 RTT。 | 终结传统 Agent「先问做什么、再问点哪里、最后问填什么」的多轮慢往返。 |
| **原子级快照与活体引用** | `WeakMap` + `Map` 缓存 DOM 节点；采用 Chromium 原生 `checkVisibility({checkOpacity: true, checkVisibilityCSS: true})` 替代耗时的 CSS 计算。 | 彻底消除 `lite-browser dom.ts` 中 `getComputedStyle` 造成的全量 Reflow / Layout Thrashing。 |
| **前置遮挡与新鲜度防护** | 在 CDP 事件派发前，通过 `document.elementFromPoint(x, y)` 验证目标是否被浮层/弹窗遮挡；通过 `pageKey` 与 `guard` 检测 DOM 漂移。 | 根治 Agent 交互中因 Toast、浮层遮挡或 DOM 异步重绘导致的「幽灵点击」和「Stale Element」异常。 |
| **自适应微沉降 (Adaptive Micro-Settle)** | 拒绝硬编码 `sleep`。通用交互至多等待 2 个动画帧 (rAF, ~32ms) 或 50ms；Combobox 针对下拉选项探测上限 200ms。 | 消除 `actions.ts` 中生硬的 `setTimeout`，将单步动作耗时压缩至十毫秒级。 |
| **控件路由与文本生成解耦** | 主决策头仅负责选控件，文本生成通过轻量上下文委托给极速小模型（DeepSeek/Mercury/Qwen），输出严格受限为 JSON。 | 降低长上下文 Token 消耗，文本生成极速响应且零格式幻觉。 |

---

## 3. Lite-Browser 与 Jev 的优劣互补矩阵

```text
┌───────────────────────────────────────┐   ┌───────────────────────────────────────┐
│        lite-browser 现有护城河         │   │       jev-ultrafast 极速引擎能力       │
├───────────────────────────────────────┤   ├───────────────────────────────────────┤
│ • 19ms Bun 单二进制冷启动，零后台常驻     │   │ • 7.1s 极速端到端自主探索循环          │
│ • 多 Agent 会话隔离 (--agent)          │   │ • 推测式单往返多头预测 (Speculative)    │
│ • 跨会话免扫码登录态复用 (--reuse)       │   │ • 原生 checkVisibility 原子快照       │
│ • 登录墙/验证码交接状态机 (Handoff)      │   │ • elementFromPoint 实时遮挡穿透检测   │
│ • SOP 沉淀与自进化 (确定性 0 Token 重放) │   │ • rAF 自适应微沉降 (无盲目 sleep)      │
│ • 原生 MCP / CLI 接口规范              │   │ • 动作/文本双模型解耦                  │
└───────────────────────────────────────┘   └───────────────────────────────────────┘
                                    ▼ 融合目标 ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           Lite-Browser 2.0 终极全貌                               │
│                                                                                   │
│  1. 任务到达 -> SOP 命中? -> [是] -> 300ms 确定性回放 (0 Token)                   │
│                           -> [否] -> 启动 Jev 内核极速探索 (7s 端到端，极低消耗)  │
│  2. 探索成功 -> 自动生成/自愈 SOP (lite-browser done) -> 下次直接命中确定性回放     │
│  3. 遭遇登录墙/人机 -> 触发 lite-browser Handoff 交接协议，无缝人工干预后继续          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 三阶段落地演进路线图

### 第一阶段：底层执行器与快照引擎重构 (Jev Snapshot & Fast Settle)
- **目标**：直接提升现有 CLI / MCP 基础指令的响应速度与稳健性。
- **任务项**：
  1. 重写 `src/dom.ts`：
     - 引入 `window.__lite_fast__` 活体节点缓存（`WeakMap` + `Map`）。
     - 使用 `el.checkVisibility()` 替代 `getComputedStyle()`。
     - 完善 Accessible Name 计算（处理 `aria-labelledby`, `labels`, `placeholder`, `childNodes` 过滤）。
  2. 增强 `src/actions.ts` 执行前置守卫：
     - 执行 `click` / `type` 前通过 `elementFromPoint(x, y)` 进行遮挡判定与可见性核验。
     - 引入 `pageKey` 与 `guard` 防重入与 DOM 漂移。
  3. 引入自适应微沉降（Adaptive Micro-Settle）：
     - 将原有的静态等待改造为 2-rAF (~32ms) 与 combobox option 动态探针（上限 200ms）。

### 第二阶段：引入极速自主探索循环 (`lite-browser auto / act`)
- **目标**：无需外部 Agent 逐步一问一答，本地一键自主达成复合页面目标。
- **任务项**：
  1. 新增指令 `lite-browser auto <goal> [--url <url>]`。
  2. 移植 TypeSafe/Speculative 动作空间生成算法（`action_space`）。
  3. 动作决策模型与文本填充模型解耦（支持配置极速推理端点，如本地 Ollama / DeepSeek-V3 / OpenRouter）。
  4. 支持步数与安全预算熔断，保障不可逆动作可控。

### 第三阶段：SOP 自进化与多 Agent 生态闭环
- **目标**：自主探索结果直接沉淀为 SOP，并与多 Agent 身份无缝集成。
- **任务项**：
  1. `auto` 执行成功后，自动组装动作轨迹并提示或自动触发 `RecipeEngine` 原地沉淀为 SOP。
  2. 遇到登录墙或交互阻断时，直接触发 `lite-browser` 现有的 `handoff` 机制，通知人类接管。
  3. 保持 `--agent` 和 `--reuse` 的环境上下文隔离，确保多 Agent 协作时各探索任务互不干扰。
