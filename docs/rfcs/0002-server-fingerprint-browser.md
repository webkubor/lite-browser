# RFC 002: lite-browser 服务器指纹浏览器形态重构

## 1. 背景与动机

`lite-browser` 当前是一个**本机工具**：浏览器探测写死 macOS `/Applications`，启动参数面向「真人坐在 Mac 前」设计，核心价值是登录态复用（`--reuse`）、cookie 解密、SOP 自进化、人工接管。

目标形态变了：要在**小内存 Linux 服务器**上长期运行，每个账号一份独立、可复用的**指纹身份**，让目标站点（小红书 / 掘金等重反爬 SPA）认为它是一个真实浏览器会话。

这不是"加个部署说明"，是**产品形态变更**：定位从「本机有真 Chrome 的高速编排」变为「服务器常驻的指纹浏览器」。

---

## 2. 本质矛盾

三条互相约束的事实，构成不可能三角：

```
        小内存服务器
           /    \
          /      \
   真指纹对抗  ——  多账号并发
```

- **真指纹对抗** 要求有真内核：canvas / WebGL / AudioContext 是**读回真实渲染结果**的，API 层 spoof 骗不过 `canvas.toDataURL()`。
- **多账号并发** 要求身份隔离：同一账号出现两套 TLS / HTTP2 指纹，反爬可按账号关联。
- **小内存** 要求引擎数量受限。

### 2.1 实测数据（本机 Chrome 157，RSS 合计）

| 配置 | 进程数 | 总 RSS |
|---|---|---|
| 默认 headless | 11 | 921 MB |
| + `--disable-gpu --disable-software-rasterizer` | 11 | **985 MB（更高）** |
| + `--renderer-process-limit=1 --no-zygote` | 9 | **708 MB** |
| + 深度瘦身 flags | 9 | 794 MB |

结论：**单个无头 Chromium 内存地板 ≈ 700 MB**，flag 压不动。"禁 GPU 用软件光栅"是反直觉的 —— 软件光栅更吃内存。

### 2.2 单进程多 target 的内存实测

| 状态 | 总 RSS |
|---|---|
| 基线（空白页） | 822 MB |
| 开 6 个 target | 818 MB |
| 加载 example.com | 815 MB |

结论：**6 个 target ≈ 1 个 target 的内存**。进程隔离存在（实测 6 个独立 renderer 进程），但内存不翻倍。

---

## 3. 方案对比矩阵

| 维度 | A. jsdom / happy-dom | B. browserr (Servo) | C. 单进程多 BrowserContext（本方案） | D. 多进程（每账号一个 Chromium） | E. 商业云端指纹浏览器 |
|---|---|---|---|---|---|
| 单实例内存 | ~50–150 MB | ~200 MB | **700 MB 固定 + 边际** | 700 MB × N | 0（远程） |
| 真 DOM / 执行 JS | ✅（但 DOM 是假的） | ✅ | ✅ | ✅ | ✅ |
| 指纹可信度 | ❌ 一秒穿帮 | ❌ 缺 API/iframe | ✅ 真内核 + 注入 | ✅ | ✅ |
| 每账号独立代理 | ✅ | ❌ | ✅ **已验证** | ✅ | ✅ |
| 每账号登录态 | ✅ | ✅ | ✅ 快照重放 | ✅ 目录持久 | ✅ |
| 需要额外基础设施 | 否 | 否 | 否 | 否 | **是（花钱）** |
| 代价 | 目标站上价值为 0 | 与 device-passport 完全接不上 | 700 MB 地板 | 内存乘 N | 成本 + 依赖 |

### 3.1 否决墓碑（记下来，防止反复纠结）

- **jsdom / happy-dom —— 否决。** `navigator.userAgent` 默认带 `jsdom` 字样，`canvas.getContext()` 直接抛 `Not implemented`，无布局引擎（`getBoundingClientRect()` 全 0）。反爬一行代码识破。目标站全是重反爬 SPA，jsdom 在这些站上价值为 0，却要维护第三个引擎。
- **browserr / Servo 引擎 —— 否决。** 它不说 CDP，device-passport 的 `cdp.ts` adapter 完全接不上；README 明说扫码类验证码 iframe 加载不了；**缺 spoof API 本身是最刺眼的指纹**。它的"轻"是用隐蔽性和兼容性换来的，与本项目目标正好相反。
- **headless + Xvfb（虚拟屏）—— 否决为默认。** 交叉评审（Gemini / Grok）一致结论：Xvfb 在指纹对抗上几乎无额外收益，反而 +50–120 MB 内存、多一个要守护的进程（崩溃 / 掉线 / DISPLAY 环境变量）。仅在某个具体站点硬拦截 headless 残留痕迹时才作为兜底尝试。
- **纯 HTTP 层（device-passport fetch adapter）—— 否决为唯一路径，但保留为补充。** 只用于**无 Cookie 的公开 GET**（静态资源、公开接口预取）。

---

## 4. 选定方案

### 4.1 架构分层

```
┌─ 调度层（常驻，~几十 MB）─────────────────────────────┐
│  账号表：每账号 = { passportSeed, proxy, 磁盘快照路径 }  │
│  调度策略：单活跃页 —— 同时只有 1 个 context 有活页面     │
└────────────────────────────────────────────────────────┘
┌─ 渲染层（常驻 1 进程，~700 MB 固定）───────────────────┐
│  1 个 Chromium 进程（--headless=new）                   │
│  └─ N 个 BrowserContext（每账号一个）                   │
│       ├─ per-context proxyServer（已实测生效）           │
│       ├─ device-passport 指纹注入（CDP plan）            │
│       └─ 登录态 = 内存态，靠磁盘快照导出 / 回灌          │
└────────────────────────────────────────────────────────┘
┌─ 轻量层（常驻，~2 MB/账号）────────────────────────────┐
│  device-passport fetch adapter：无 Cookie 公开 GET       │
└────────────────────────────────────────────────────────┘
```

### 4.2 关键决策与实测依据

| 决策 | 依据 | 实测证据 |
|---|---|---|
| 冷热切换粒度 = **BrowserContext**，不是进程 | 进程数受内存限制，BrowserContext 边际内存 ~20 MB | 6 target 实测 818 MB |
| per-context **proxyServer** 可用 | `Target.createBrowserContext` 接受 `proxyServer` | 死代理端口 → `ERR_PROXY_CONNECTION_FAILED`；直连 context → 正常返回 IP |
| 登录态用**磁盘快照导出 / 回灌** | BrowserContext 是内存态，进程重启即丢 | 导出 A → 销毁 → 新建 B → 回灌 → 读回一致 |
| `--disable-blink-features=AutomationControlled` | 消除 `navigator.webdriver` | 实测 `webdriver: false` |
| `--enable-unsafe-swiftshader` | 否则 `getContext('webgl')` 返回 null，**spoof 根本没机会生效** | 实测未加时 `renderer: null` |
| 指纹注入走 `Runtime.evaluate`（页面已加载后） | `addScriptToEvaluateOnNewDocument` 在实测中未按预期触发 | 直接 evaluate 覆盖 `navigator.platform` 成功 |
| `Network.setUserAgentOverride` 前必须先 `Network.enable` | 否则 UA override 静默不生效 | 实测未 enable 时 UA 未变 |
| 会话类 HTTP 走**页内 `fetch()`** | Node fetch 的 TLS/JA3、HTTP2 指纹、header 顺序与浏览器不同 → 同一账号两套身份 | Codex / Grok 独立指出 |

---

## 5. 代价与放弃的东西

### 5.1 明确放弃

1. **放弃"更轻"** —— 700 MB 是地板，不接受 jsdom / Servo 换来的 50–200 MB，因为指纹这一关一票否决。
2. **放弃并发多账号同时在线** —— 2 GB 下安全上限 **1 个活跃页**（1 × 700 MB + ~200 MB 系统余量）。多账号**轮流**被调度，不是同时。这是"单活跃页调度"的由来，不是妥协。
3. **放弃 Node fetch 承载会话类请求** —— 只保留无 Cookie 公开 GET。
4. **放弃 `--reuse` 免登录复用 / cookie pull-system（解密本机 Keychain）** —— 服务器场景没有本机 Keychain 可解密；这两个功能在服务器形态下无意义。
5. **放弃 headless 之外的 Xvfb 默认** —— 保留为兜底选项，不作默认。

### 5.2 保留

- `open / snapshot / click / type / hover / press / select / upload / scroll / wait / screenshot / eval / cdp` —— 原子动作层不变。
- 多 Agent 隔离（`--agent`）—— 在 context 维度上继续成立。
- SOP 自进化 —— 不依赖浏览器来源，仍成立。

### 5.3 推翻条件（量化红线）

本方案在以下任一条达成时**必须重新设计**：

| 指标 | 红线 | 触发动作 |
|---|---|---|
| 单账号活跃时总 RSS | > 1.2 GB | 重查 renderer 进程泄漏 / 改用独立 user-data-dir 策略 |
| Chromium 冷启动到首个可交互页 | > 8 s | 加快照预热 / 改 Chromium 启动 flag |
| 快照导出 + 回灌耗时 | > 3 s | 改增量快照 / 只回灌必要 cookie |
| 单账号 cookie 数量 | > 200 | 分片存储 / 改用 IndexedDB 快照 |
| 风控拦截率 | > 5% | 重查指纹一致性（行为指纹、时区、locale、WebGL 噪声） |
| 需要真同时在线账号数 | > 3 | 需引入第二台机器或云端浏览器（方案 E） |

---

## 6. 落地任务

1. `src/chrome.ts` —— 浏览器探测解耦 macOS（加 Linux 路径：系统 chromium、Playwright Linux 缓存、Google Chrome 官方 Linux 包）；启动参数分平台（Linux 加 `--no-sandbox --disable-setuid-sandbox`）。
2. `src/pool.ts`（新）—— BrowserContext 池：创建 / 复用 / 销毁，per-context 代理，账号 → context 映射。
3. `src/snapshot.ts`（新）—— 账号快照：cookie + localStorage 导出与回灌，磁盘持久化。
4. `src/actions.ts` —— 动作层接入 pool；会话类 HTTP 改走页内 `fetch()`。
5. `src/fingerprint.ts` —— 与 device-passport 打通，**删除自研浅层指纹**（重复造轮子，且 UA 写死 macOS 在 Linux 上自相矛盾）。
6. README —— 改写定位，明确「需要真实 Chrome」「需要登录态」的能力边界（学 browserr 的诚实声明边界）。

---

## 7. 交叉评审记录

| 模型 | 结论要点 | 是否采纳 |
|---|---|---|
| **Gemini**（agy） | Xvfb 对抗指纹无额外收益、只增开销；单进程多 context + 2 活跃页最省；必须改 `/Applications` 硬编码；建议 `Client Hints` 与硬件矩阵自洽 | ✅ 采纳 |
| **Codex**（GPT） | "池化"应降级为**串行执行器**；**fetch 层是最危险一环**（TLS/JA3 两套身份）；canvas 噪声必须 seed 派生且跨会话稳定；profile 登录态会过期需恢复流程 | ✅ 采纳（fetch 限制、单活跃页、快照需含噪声种子） |
| **Grok**（xAI） | 冷热切换粒度应为 BrowserContext；会话类 HTTP 走页内 `fetch()`；`--disable-blink-features=AutomationControlled` 消除 `navigator.webdriver`；建议 Chromium for Testing 固定版本 | ✅ 采纳（flag、页内 fetch） |
| **Claude** | CLI 模型 ID `group/modelgo[1m]` 不可用，本次未产出 | ❌ 未纳入 |

> 四个模型独立得出同一结论：冷热切换粒度是 **BrowserContext** 而非进程；**Node fetch 不能承载会话类请求**。这两条是本次交叉评审最硬的收获，且均被本地实测独立验证。
