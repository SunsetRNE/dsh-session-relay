# 维护指南：设计、坑与审阅边界

这份文档回答三个维护问题：为什么插件这样设计、哪些问题以前已经踩过、改动该找谁看。它记录的是仓库当前的约定；宿主 DSH 或 `dsh-session-query` 升级后，先跑测试并重新核对对应契约。

## 1. 总体结构

插件分成四层，改动时先判断落在哪一层：

- `lib/core.js`：纯逻辑层。负责 `/relay` 参数解析、目标解析、别名、限流、防循环、消息封装和纯数据格式。这里不应读取 Host 服务或文件。
- `lib/inspect.js`：会话日志分析层。把 `sessionQuery.readSession()` 的完整原始事件整理成轮次、工具调用、文件改动、输出和可搜索文档。它只读，不唤醒会话。
- `lib/impl.js` / `lib/settings-route.js`：Host 适配层。`impl.js` 连接会话、工作区、看板和 `sessionQuery`；`settings-route.js` 给已登录的本机面板提供只读查询和用户动作。模型工具和用户面板必须在这一层区分权限范围。
- `lib/client.js`：浏览器面板层。通过 `/api/dsha-session-relay` 取数据，不直接读文件或 Host 服务。面板逻辑改完通常刷新即可；外壳、注入字段和 bundle patch 改动需要重启 DSH。

`lib/index.js` 是尽量稳定的外壳：负责把实现复制到 `.gen/<代次>`、注册命令/工具/路由，并在 `/relay reload` 时热替换 `impl.js` 及依赖。不要把业务逻辑塞回外壳，否则热重载和状态接管会变复杂。

## 2. 为什么搜索这样设计

### 2.1 搜索使用完整原始日志

`peer_inspect` / `/relay search` 使用 `sessionQuery.readSession()`，而 `peer_inspect view=digest`（原 `peer_workspace` 的最近对话摘要，1.11 起 `peer_workspace` 已并入 `peer_list`）使用 `readSurface()`。这是有意区分的：

- `readSession()` 是完整原始事件，能保留工具参数、工具结果、错误码、文件改动、轮次结束原因和 reasoning，适合审计和精确搜索。
- `readSurface()` 是当前模型表层，压缩或替换后的旧消息可能已不在其中，适合给主会话看“当前上下文摘要”，不应替代完整审计搜索。
- 不要直接把宿主新增的 `searchEvents` 结果替换本地分析。官方搜索的语义字段、surface 和范围与插件的 richer contract 不完全相同；插件还需要工具/文件/失败码/推理等本地分析结果。

### 2.2 工作区范围以侧栏工作区为主

模型搜索只能查调用方所在工作区；用户面板可以查当前工作区或全部侧栏工作区。工作区会话按最近活动排序，默认最多扫描 25 个，最多允许 60 个，结果中的 `skipped` 必须展示给用户。看板中已经可见但侧栏同步稍晚的会话也纳入可搜索集合。

搜索是只读的：它不能唤醒会话、恢复冷会话或改变看板。每个会话的完整日志读取受并发上限约束；读失败要保留为该组错误，不应因为一个冷会话失败而丢掉其它会话结果。

### 2.3 匹配器的安全取舍

默认是字面量、不区分大小写；`regex=true` 时限制正则长度并拒绝明显的嵌套量词/重复交替分组。字面量搜索按完整文档扫描，不能只扫前缀，否则大回复尾部的关键词会被静默漏掉；用户正则只扫每段前 `SCAN_LIMIT`（100 万字符），因为嵌套量词检查只是启发式，超长工具结果配合回溯正则会长时间占住 Host 主线程。若以后引入更复杂的正则，优先使用安全正则引擎或独立进程，不要在 Host 主线程执行未经限制的 backtracking 正则。

### 2.4 结果是“数据”，不是指令

会话原文、标题、工具参数和搜索片段都来自模型/用户日志，不能信任。渲染到 `<session-inspect>`、`<session-search>` 或面板之前要转义 `<`、`>`、`&` 和属性引号，防止关闭包装标签或伪造指令。新增输出路径时沿用 `escapeXml()` 和现有 `frame()`，不要直接拼接原文。

## 3. 以前踩过的坑

- **工作区 `turn` 过滤丢失**：解析器已收到 `--turn`，跨会话执行时却没把它传给 `searchSession`，导致命中其它轮次。现在 workspace 和单会话都要求非负安全整数，并有端到端回归。
- **工具错误码搜不到**：失败结果可能没有文本，只有 `data.error.name/code`；如果只搜 `message.content`，`TOOL_TIMEOUT` 会显示在 tools 视图却搜不到。错误码和错误名现在进入 error 文档。
- **坏 JSON 参数搜不到**：工具参数解析失败后不能只留下空对象；必须保留 `rawArgs`，否则原始参数里的关键词丢失。
- **assistant 中断时工具调用丢失**：`assistant/message` 里的 `tool-call` block 可能已写入，但后续 `tool/call` 事件没有落盘。分析器先记录孤立调用，之后看到正式 `tool/call` 时按 call id 合并，避免重复。
- **面板搜索和看板范围耦合**：搜索“全部工作区”不应改变看板当前工作区，也不应触发看板重新加载。`BoardPage` 的 `scope` 与 `searchScope` 必须是两个状态。
- **live 日志缓存过期**：完整日志有短 TTL 是为了避免连续查看反复解压大文件，但新事件到达时必须失效对应缓存；否则几秒内会看到旧结果。
- **面板查询参数不校验**：空查询、浮点/负数轮次、超出会话/命中上限、`scope=all` 同时带 workspace 都应在路由层拒绝，不能静默裁剪后返回误导结果。
- **路径/工作区软链陷阱**：不要把 DSH 工作目录或插件加载路径做成软链。工作目录检查不跟随软链，reload 可能报 `ENOTDIR`；仓库应使用真实目录。
- **外壳与实现边界**：改 `lib/client.js` 是面板热更新；改 `lib/impl.js` 需 `/relay reload`；改 `lib/index.js`、`package.json` 的 `dsh` 字段或 `cordis.patch.yml` 需要重启 DSH。
- **面板 / 侧栏 chunk 缓存（2026-11-07 实锤；当晚更正重启结论）**：`lib/client.js` 是网页入口，DSH 的客户端热更新会重拉；`/relay reload` 只换服务端实现和 staged 的 lib 文件。
  - 只改 `lib/client.panel.js`：必须同步改一行 `lib/client.js`（注释即可），并把 `PANEL_KIT` 与 `client.panel.js` 的 `KIT_VERSION` 一起加 1；否则浏览器继续用旧面板——`/relay reload` 提示正常，但页面完全没变（邮箱裸文本就是这样复现的）。
  - 只改侧栏正文：外壳与每个 chunk 都按当前 KIT 命名（如 `lib/client.sidebar41.js`、`lib/client.sidebar.tasks41.js`），同步改 `lib/client.js` 的 `SIDEBAR_CHUNK` / `SIDEBAR_KIT`，并把外壳与**全部** chunk 的 `KIT_VERSION` 一起加 1（外壳会校验每个 chunk，落单的 chunk 会显示 stale 行）；KIT 一升就换文件名，浏览器拿到的是新 URL，不会命中旧 chunk 的 immutable 缓存。若沿用固定文件名 `client.sidebar.js`，WebView 可能一直命中旧缓存（2026-11-09 实锤：即使重启 DSH、整页刷新也不换 chunk）。
  - 侧栏拆分（T13 起）：外壳 `client.sidebar<KIT>.js` + `client.sidebar.shared<KIT>.js` + `client.sidebar.<页签><KIT>.js`；`<页签>` ∈ sessions / tasks / handoff / map / prs / branches / issues / mail / more / settings。首次打开只拉「外壳 + 共享件 + 当前页签」；hover 页签 200ms 预取；宿主按 `require.async('./client.sidebar.*.js')` 的相对 chunk 路由取文件（文件必须放在 `lib/` 且名字匹配 `client.*.js`）。共享件字段变了同样整体 bump KIT。
  - `lib/client.js` 本身：2026-11-07 本机实测，DSH 进程 11:23Z 启动、11:29–11:32 改的 `client.js` / 侧栏 / 面板都在页面里直接生效，**没有重启 DSH**；先等热更新或整页刷新，不要默认要求重启。宿主没开客户端热更新、页面仍旧时才重启。
  - `lib/index.js`、`package.json` 的 `dsh` 字段、`cordis.patch.yml`：仍然必须重启 DSH（服务端外壳 / 启动期注册）。
  - 验证顺序：等客户端热更新 / 整页刷新（需要时 `/relay reload` 换实现）→ 仍旧则重启 DSH；不要反复改业务文件“试”。`PANEL_KIT === client.panel.js KIT_VERSION`、`SIDEBAR_KIT === 外壳 / 每个 chunk 的 KIT_VERSION`、`SIDEBAR_CHUNK` 与外壳文件名一致，已有测试覆盖。
  - **stale 屏（2026-11-08 补，2026-11-09 换文件名根治）**：提示「协作面板刚更新过」时，入口 `client.js` 已热更新、页面里的侧栏 chunk 还是旧版；**关掉右侧栏标签不会重载已加载的 chunk**，必须**整页刷新**。整页刷新后仍提示 → `/relay reload` → 再整页刷新；仍不行才重启 DSH。若仍卡住，多半是 WebView 钉住了固定文件名的旧 chunk；现在侧栏外壳与每个页签 chunk 都按 KIT 命名（如 `client.sidebar41.js`），换版本即换 URL，不会再命中旧缓存。stale 屏显示实际 / 期望 KIT 并提供「刷新整个网页」按钮。
- **侧栏折叠入口（2026-11-08 二次修复）**：地图 / PR / 分支 / 问题折进「更多」的入口只能在窄侧栏出现；宽侧栏已经有这些页签，再列一遍就是重复。宽度由 `ResizeObserver` 量侧栏 root 后加 `dshaSv_wide` / `dshaSv_narrow`（断点 620px），不要退回 CSS 容器查询——部分 WebView 旋转后不重算，会出现宽屏露快捷入口 / 窄屏露折叠页签的回归。宽屏隐藏快捷入口用 `.dshaSv_wide .dshaSv_foldOnly{display:none}`，窄屏隐藏折叠页签用 `.dshaSv_narrow .dshaSv_foldTab{display:none}`；入口 section 仍挂 `dshaSv_foldOnly`。`test/sidebar.test.js` 同时断言渲染类名、宽度 class 与 CSS 规则；改这块先跑侧栏用例。
- **发布物约束**：不发 npm；每个 GitHub Release 只挂一个 `.tgz`，插件管理器按唯一附件安装。
- **每步注入的上下文要短且稳定**：协作上下文每一步都进模型提示，慢模型尤其吃亏。
  - 旁观会话（本组有主会话、本会话未加入）只拿一行版本线摘要（`OBSERVER_LINE_LIMIT`）、一行插件核验（`mainBriefLine`）和一行看板计数（`boardBrief`）；没有主会话时照常给完整看板段。
  - 版本线的来源声明由 `renderLine` 统一加一次；模型照抄进正文的那一行由 `lineBody` 去掉，不要再在别处追加同一句。
  - 版本线是手写快照会过期；`mainRefLine` 注明“以插件核验为准”，版本线 `main=<sha>` 与 origin/main 不一致时 `lineDriftNote` 提示（主会话被要求 `peer_line` 更新）。
  - 上下文里不放每轮会变的时间（fetch / tag 查询时间）；需要时间的给人看的输出（`/relay decl`）传 `stamp: true`。新增上下文行时同样避免时间戳和计数抖动。
  - 注入段的固定说明用英文短句（`coordinatorContext`、`workerContext`、`observerContext`、`renderLine`、`mainRefLine` 上下文版、`boardContext`/`boardBrief`、上下文预算、核验、交接草稿提示）；数据保持原文（版本线正文、汇报、看板条目与状态词、声明计数），因为 `/relay board`、面板和交接快照共用它们。工具用法写在工具说明里，不在每步注入里重复。
  - 旁观会话的版本线被截断；全文用 `peer_line` 不带参数读取（任何根会话可读，只有主会话能写）。

### 3.1 用户不在时（0.18）

- **存储**：常设授权存在协调状态的工作区分组里（`coordination.json` 的 `groups.<id>.delegation`，与版本线同级）；主会话提问和唤醒预算在 `away.json`（`lib/away.js`，没给 `awayPath` 时与 `statePath` 同目录，测试只给 `statePath` 也不会写到家目录）。提问每个工作区最多 20 个待答、同一问题去重，已结束的只留 10 个。
- **只由用户做的动作**：建任务看板（面板 `task-init`、`/relay task init`）、常设授权（面板 `delegate` / `delegate-clear`、`/relay delegate`）、回答 / 忽略提问（`ask-answer` / `ask-dismiss`）、解除唤醒暂停（`unattended-resume`、`/relay wakes resume`）。没有对应的模型工具；`peer_task` 的动作枚举里没有 init。建看板的目录由插件按工作区推出（主会话目录 → 侧栏登记路径），不收面板传来的路径；`/`、`/root`、家目录拒绝，上层已有看板也拒绝；从不执行 `git init`。
- **`peer_ask_user`**：只给本工作区主会话（根会话）。发一条手机通知，失败不抛给模型；不阻塞、不等答案。用户点选后以用户来源（hop 0）发 `[用户在面板选择] <问题> → <选项>` 给现任主会话（已交接就给新主会话）；`about` 指向的工作会话不直接通知。
- **唤醒预算语义**：`deliver()` 统一判定。来源不是用户（`source.kind !== 'user'`，或显式 `origin`）、目标不在运行、模式不是 `queue` 的投递算一次唤醒，按目标所在工作区记，滑动一小时，默认 16（`unattendedWakesPerHour`，0 不限）。到上限：改成 `queue`、返回 `budgetQueued`、工作区进入暂停（暂停期间不放行；满一小时自动解除，或用户「继续」），每次暂停只发一次手机通知。`peer_spawn` / 认领拉起在建会话前就拒绝（`wake_budget`）。插件自己的提醒（核验结果、推送链）传 `origin: 'plugin'`，不计数也不被拦：它们频率有界，暂停时也要能叫醒主会话。判定在内存里同步完成再写盘，投递时序不变（汇报合并器的测试依赖这一点）。
- **跳数**：主会话档 `coordinatorMaxHops` 默认 8 → 24（成本由每小时唤醒上限兜底），普通 3 不变；工作会话发给本工作区主会话也用这一档。
- 主会话上下文新增的行都只随用户修改 / 提问增减 / 暂停变化，不带时间与计数抖动；没设常设授权时只有一句固定的 `peer_ask_user` 提示。

## 4. 这类改动该找谁看

本仓库没有 `CODEOWNERS`，历史提交也都是同一发布身份提交；因此这里按职责分工，而不是把个人名字硬编码进文档。发起审阅时应明确标注需要哪一类 reviewer。

### A. 会话日志、搜索和 Host 逻辑 reviewer

适用于：`lib/inspect.js`、`lib/impl.js`、`lib/core.js`、`sessionQuery` 适配、缓存、工作区范围、权限边界。

审阅重点：

- `readSession` 与 `readSurface` 是否混用；是否保留 `inheritedEventCount` 等宿主元数据契约。
- 模型只能看本工作区，用户命令/面板的全部范围是否仍只走登录连接。
- 冷会话、归档会话、子代理、侧栏尚未同步会话的召回和错误分类。
- 取消信号、读失败、缓存失效、并发上限和输出预算。
- 工具参数、错误名/错误码、孤立 tool-call、轮次过滤是否仍可搜索。

### B. 面板/前端 reviewer

适用于：`lib/client.js`、面板请求参数、React 状态、加载/取消/空结果/错误结果、会话跳转。

审阅重点：

- 搜索范围状态不能改变看板范围；组件卸载和重复查询要 abort/丢弃旧结果。
- 结果中的会话标题、工作区名、片段不能造成 DOM/标签注入。
- 移动端窄屏、长文本、无结果和单组读失败是否可理解；`skipped`、总命中与显示命中是否区分。
- 旧宿主没有新 route 时，面板应显示可重试错误而不是整块崩溃。

### C. Host 路由/安全 reviewer

适用于：`lib/settings-route.js`、`lib/index.js`、连接守卫、权限和参数验证。

审阅重点：

- GET 只读搜索是否仍经过登录连接守卫；全部工作区绝不能从模型工具入口绕过范围。
- Origin 校验和 POST 写操作边界不能被只读接口改坏。
- 错误响应只返回稳定 `error`/`message`，不要把异常 stack 或完整宿主路径返回给面板。
- 选项上限与后端实际 clamp 保持一致。

## 5. 修改后的最小验证清单

```sh
npm test
```

至少再人工检查：

1. `/relay search --kind error TOOL_TIMEOUT` 能命中失败码。
2. `/relay search --turn N <关键词>` 不会命中其它轮次。
3. 面板搜索当前工作区/全部工作区切换不会改变看板范围；点击结果能打开会话。
4. 查询空字符串、非法轮次、全部范围带 workspace 都收到清晰错误。
5. 冷会话、读取失败、无结果、超出默认 25 会话时，结果仍说明扫描/跳过/失败信息。
6. 含 `</session-inspect>`、`</session-search>` 的日志原文只作为转义后的数据显示。

发布前仍按 README 的流程执行 `npm test`、用户确认后的 `/relay reload`、提交/推送和 GitHub Release；本次文档和代码变更本身不自动推送或发版。
