# GitHub 地图票与 issue 多流程态接入评估

状态：评估稿修订（2026-11-06，按用户本地为准/未知态方向）。2026-11-06 晚：R1 的 `issues` 单向投影、`labelSync`、`mapIssues`（sub-issues 不可用时正文 tasklist 降级）已落地（`lib/issuesync.js` + `/relay sync`，默认开关关、测试用 mock、未实际写 GitHub）；`projectStatus` 仍待做。

范围：为 relay 后续接入两类能力做决策准备——(1) GitHub 上的「地图票」（map issue + 子票 + 依赖边）；(2) issue 的多种流程态（triage / ready / doing / done 等）。本文按用户 2026-11-06 的决策修订：**relay 任务库为唯一事实源/校准点，GitHub 只做投影；因 IP 访问 GitHub 不稳，同步必须支持未知态、自动重试和主会话接管。** 本文只评估，不把 GitHub 变任务库事实源，也不恢复上游 Deck。

材料别名（下文用短路径引用）：

- `DECK` = `/root/.dsh/plugin-install-operations/completed/b1137cfe-1da0-4cad-9895-518d9627d4c3/delete-source`（已卸载的 `dsh-mattpocock-skills-deck` 1.9.0-beta.33 源码）
- `RELAY` = `/root/dsha-session-relay`

---

## 0. 结论先行

1. **推荐 L：本地为准的单向同步。** relay 任务库是唯一事实源/校准点；GitHub 只是投影。本地 claim / done / split / archive 不依赖网络，网络失败只影响投影，不影响本地任务。
2. **必须把「未知态」作为一等状态。** 超时、连接重置、DNS/IP 被挡、gh 退出码不明时，链接票进入 `unknown`，不能当成功，也不能改本地任务状态；由插件自动重试。
3. **自动重试 + 主会话接管。** 每仓库串行、指数退避 + 抖动；连续 3 次失败或 `unknown` 超过 10 分钟，主会话接管并给用户发一次网络提示（每仓库每小时至多 1 次）。用户可 `/relay sync off`。
4. **M（只读镜像）保留为可选诊断/对照，不再是前置必经。** 原「A 只读镜像」的读回核对能力被吸收进 L 的 reconcile；M 只用于人工对照和排障，默认关闭。
5. **C（双向同步）暂不做。** L 发现远端人工改动时只进 `conflict`，由主会话选择 local-wins / remote-wins / detach；默认不自动 close/reopen。
6. **流程态仍与执行态分离。** GitHub 投影用 open/closed + `relay:*` 标签；本地继续用 derived state 和可选 `stage`，不用 GitHub closed 反推 relay merged。
7. **审批门（用户 2026-11-06 定）**：relay 任务进入 `merged` 投影/关闭 GitHub issue 前必须有代码审批记录（`approval: pending|approved`，由用户或主会话显式记录，不自动批准）；顺序固定为「代码审批 → 合并 → 合并总结 → 关 GitHub issue」。GitHub 关闭默认只由人/主会话显式做，`closeOnTerminal` 保持默认 `false`。
8. 成本粗估（含测试，不含评审）：L **10–14 人日**；M **3–5 人日**；C **18–26 人日**。S1 同步骨架 **5–7 人日**，排期在 **2.0.0 之后**（用户 2026-11-06 定）。
9. **最大风险**：把 `unknown` 当成功、重试不幂等导致重复建票，或用远端 closed 反推本地 merged、未审批就关票导致误关/误归档。网络不稳是常态，设计必须允许「长时间不同步但本地正确」。

---

## 1. Deck 的任务模型

### 1.1 对象种类（issue / map / spec / bug / map-ticket）

Deck 把「票」拆成六个位置，而不是一个通用 issue。`DECK/deck/rules/object-kind.js:24` 的 `OBJECT_KIND_RULES` 是单一真源：

| kind | contractType | 类型标签 | 父级规则 | 隐藏标记 | 含义 |
|---|---|---|---|---|---|
| `map` | `map` | `wayfinder:map` | 无父级，顶层容器 | 无 | 探索地图本体；正文放 Destination / Notes / Decisions / 迷雾 |
| `map-ticket` | `issue` | 必须四选一 `wayfinder:research/prototype/grilling/task` | 必须挂 `map` | 无 | 地图上的一张决策工单 |
| `spec` | `spec` | 无（分诊标签 `ready-for-agent`） | 无父级，顶层容器 | `spec` | 实施规格容器 |
| `spec-ticket` | `issue` | 无（分诊标签 `ready-for-agent`） | 必须挂 `spec` | `ticket` | 规格拆出的实施票 |
| `bug` | `issue` | `bug` | 可有父级 | 无 | 缺陷票 |
| `issue` | `issue` | 无 | 可有父级 | 无 | 普通票 |

关键约束（`object-kind.js:118` 附近）：

- `kind` 必填，旧的 `kind=task` / `kind=ticket` 被明确拒绝，并给出迁移话术。
- 只有 `map-ticket` 收 `label`，且只能是四个 `wayfinder:*` 之一；其它 kind 把类型标签塞进 `labels` 会被拒。
- `map` / `spec` 是顶层容器，不收 `parentKey`；`map-ticket` / `spec-ticket` 必须带 `parentKey`。
- 类型标签由 kind/label 决定，`labels` 只放分诊标签（例如 `ready-for-agent`、`needs-triage`）。

对 relay 的含义：relay 现在只有「任务」一种对象，靠父子树和详情段承载语义；如果直接照搬六种 kind，会让 `peer_task` 的参数和看板表格迅速变重。**建议只引入一个可选 `kind` 元数据（`task` 默认 / `map` / `map-ticket` / `bug` / `spec` / `spec-ticket`），不把它做成新的工具枚举。**

### 1.2 wayfinder 四类与分诊五态

`wayfinder` 技能把地图工单分成四类（`DECK/bundled-skills-zh/wayfinder/SKILL.md`）：

| 标签 | 类型 | 谁来做 | 解决方式 |
|---|---|---|---|
| `wayfinder:research` | AFK | 代理/子代理 | 读文档、API、知识库，把事实翻出来 |
| `wayfinder:prototype` | HITL | 人 + 代理 | 做便宜粗糙的原型，供人反应 |
| `wayfinder:grilling` | HITL | 人 + 代理 | 对话盘问；默认类型 |
| `wayfinder:task` | HITL 或 AFK | 人/代理 | 做一件必须先做掉的人工操作，为某个决定解除阻塞 |

分诊（`DECK/bundled-skills-zh/triage/SKILL.md`）另有一套五态标签：

| 状态标签 | 含义 |
|---|---|
| `needs-triage` | 需要维护者评估 |
| `needs-info` | 等报告者补充信息 |
| `ready-for-agent` | 已写清楚，可以交给 AFK 代理 |
| `ready-for-human` | 需要人来实现 |
| `wontfix` | 不会被处理 |

加上类别角色 `bug` / `enhancement`；每张分诊过的票应恰好一个类别 + 一个状态。状态流转：无标签 → `needs-triage`；可去 `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`；`needs-info` 在报告者回复后回 `needs-triage`。地图工单只带 `wayfinder:*`，不带 `ready-for-agent`——它们是决策，不是实现工作。

对 relay 的含义：这五态是**分诊阶段**，不是 relay 的「执行/合并」状态。relay 目前没有「等人补信息」这类阶段；直接复制五个标签会造成两套状态。建议只取其中真正需要的 `triage / ready / hold / dropped` 四态，且作为独立 `stage`。

### 1.3 边：parent 与 blockedBy

Deck 只有两类结构边：

- `parent`：子票挂到地图/规格容器；GitHub 原生 sub-issue，旧 gh 回退为正文 `Part of #<parent>`。
- `blockedBy`：这张票被哪些票阻塞；`{from:"D3", to:"D1"}` 表示 D3 的 Blocked by 里加 D1，即 D3 被 D1 阻塞、要先做 D1。GitHub 原生 issue dependencies；旧 gh 回退为正文 `Blocked by: #n`。

`DECK/deck/shell/edge-landing.js` 和 `DECK/deck/rules/edge-landing.js` 把「写后读回」做成硬要求：

- 写边后重新读票，按 `parentKey` / `blockedBy` 判断落点。
- 落点分类：`native`（原生层级/原生依赖边）、`peer-link`（平级链接）、`body-line`（正文行）、`file-note`（票文件注释）、`contract`（契约字段，分不出原生还是平级）、`missing`（读回来没有）、`unsupported`、`unknown`。
- 正文里出现票号不等于边已建好；`missing` / `unknown` 不能当成功。
- 批量写阻塞边前先做环预检（`DECK/deck/shell/edge-landing.js` 的 `precheckBlockBatch`），有环拒整组。
- 建整张地图骨架用 `deck_map_plan_create`，以 `planId` 记录中间态，失败/中断后可带同一个 `planId` 续跑（`DECK/deck/tools/map-plan-create.js:20`、`:218`）。

`frontier`（可接）的定义：**未关闭 + 没有人认领 + 所有阻塞项都已关闭**。地图快照按这个口径统计 `open/closed/frontier/blocked`（`DECK/deck/tools/map-snapshot.js:18`）。

对 relay 的含义：relay 的 `dependsOn` 与 `blockedBy` 方向相同（A dependsOn B = A 被 B 阻塞），但「阻塞解除」的终态集合不同：Deck 只看 blocker `closed`；relay 要求 blocker 已 `merged/abandoned/archived`（`RELAY/lib/impl.js:2628` 附近）。镜像时必须保留这个差异，不能直接拿 GitHub closed 当 relay 可派发。

### 1.4 状态：open/closed + progress + closeReason

Deck 的「状态」不是单一字段，而是四层：

1. **平台状态**：`open` / `closed`（`DECK/tracker/contract/vocabulary.js:5`）。
2. **progress**：正文 `## 进度` 区里的结构化记录，`{percent: 0..100, note, updatedAt, entries}`；没写时是 `{percent:null,...}`，不是 `null`（`DECK/deck/tools/issue-get.js:82`）。
3. **closeReason**：关票时和 `close:true` 一起用；地图子票写进正文 Answer 段并在地图 Decisions so far 补指针，实施票追加评论，旧布局写 Close reason 行；规格/地图容器只记状态，原因忽略（`DECK/deck/tools/issue-patch-definition.js:38`）。
4. **关闭守卫**：关规格必须在同一次调用里带收口核对评论，且实施票全关；重开只能由人在后端做，工具不支持 `close:false`（`DECK/deck/tools/issue-patch-definition.js:5`、`:37`）。

对 relay 的含义：relay 的 `status` 是看板文本 + claims + git 推导，信息量比 GitHub 的 open/closed 大。**不要把 GitHub 的 closed 直接映射成 relay 的 `merged`**；最多映射成一个只读的 `githubState` 展示字段。

### 1.5 后端：GitHub / 本地 .scratch / GitLab

Deck 把后端抽象成 `github` / `markdown` / `gitlab`：

- 后端选择顺序：用户手动选择 > 锚文件 > 自动识别；`deck_context` 必须先确认 workspace 与 backend，没有 backend 就停（`DECK/deck/tools/context.js:27`）。
- GitHub：票是 issue；地图是 `wayfinder:map` 标签的 issue；子票是 sub-issue；阻塞是原生 dependency；旧 gh 回退正文行。
- 本地 Markdown：`.scratch/<effort>/map.md`、`.scratch/<effort>/issues/<NN>-<slug>.md`、`.scratch/<feature>/spec.md`；认领写票里的 Assignees 行；一个票一个文件（`DECK/deck/tools/context.js` 的 `LOCAL_HOWTO_SUFFIX`）。
- GitLab：另一套后端，子票与阻塞用隐藏标记承载，正文可见行不再当判据（`DECK/CHANGELOG.md:86` 附近）。

读取路径上，Deck 做了三层降级：

- 主路 GraphQL；配额耗尽走 REST（`DECK/CHANGELOG.md:259` 附近）。
- 只探「人正在看的那一个工作区」：无变化时 60/120/300/600 秒退避，面板活跃时 5/25/50 秒退避，不在后台全量扇出。
- 列表有封顶（GitHub issue 500、PR 1000），撞上限会明确说「清单可能不全」。

对 relay 的含义：relay 不需要三后端抽象；先只支持「当前工作区 origin 对应的 GitHub 仓库」，失败时明确降级，不要为了多后端把 15 个工具的描述撑大。

### 1.6 权限：push / triage

`DECK/README.md:40` 写得很清楚：

- 建标签、改票需要仓库 `push` 权限；
- 改指派、流转标签需要 `triage` 权限；
- 账号只有只读权限时，仓库被标成只读：改票、打标签、流转不可用，浏览与刷新照常。

`deck_context` 返回 `repo.permissions = {push, triage}`；只读时会建议 fork 到自己名下，再把工作区 origin 指向 fork（`DECK/deck/tools/context.js:129` 附近）。Deck 只认 origin，不代改配置。

对 relay 的含义：relay 已经有 GitHub 身份层（`RELAY/lib/github.js:62` 的 `GitHubIdentity`，`requireIdentity` 在 `:201`），但它只管登录、锁定账号、换号报警和审计，**目前不调用任何 issue 接口**。接入前必须明确：relay 用哪台机器的哪个 gh 账号写票；所有写操作都要过 `requireIdentity`，并记审计。M 只读镜像应允许「没锁定账号但 gh 可用」的降级路径，避免把浏览也锁死。

### 1.7 在办与预算

- **在办**：`deck_issue_report` 在开始处理、切换、完成时各报一次；只记账，不带表。跨会话在办表由 `deck_work_route` 读（默认近 24 小时，`includeStale:true` 看近 30 天）。认领本身由 assignee 表达。
- **预算**：`deck_context` 返回 `quota`：每次调用点数/请求数、每小时点数/请求数、单次最多建多少子票（`DECK/deck/tools/context.js:155`）。本地后端不出站，不需要额度；GitHub 有 GraphQL/REST 配额与限流闸。
- **写后读回**：所有写操作都带读回校验；回执里的 `ok` 不代表 UI 已变，必须重新读。

对 relay 的含义：relay 已有「派发预算」和「唤醒预算」，但没有「GitHub 调用预算」。L 必须把 gh 调用纳入现有的限流/审计，不要每个任务写操作都同步打一次 GitHub。

### 1.8 右侧面板的信息架构

按 `DECK/README.md:46-118` 和 `DECK/lib/client.js` 的界面字符串，Deck 右侧面板大致是：

| 区域 | 内容 | 交互 |
|---|---|---|
| 任务列表 | 探索地图、实施地图、普通 ISSUE；可接 / 阻塞 / 已关闭 KPI；状态、类型、标签、assignee、关键词过滤；按创建/编号/标题/更新排序；部分加载提示 | 点开地图详情、单票详情；一键注入 prompt；刷新；失败横幅 |
| 地图详情 | 像素风卡片墙；可接 / 已认领 / 被阻塞 / 已关闭分组；层号与进度；Destination / Notes / Decisions so far / Not yet specified / Out of scope；子票计数与「还有 n 张没取到」 | 卡片行动菜单（接手/执行/研究/原型/讨论/补充）；`frontierOnly` 只看可接；`detail=thin` 只看薄行 |
| 单票详情 | 描述、验收、进度、评论、父子/阻塞关系；只读提示；「在跟踪器打开」 | 关闭、复制链接、跳原票 |
| 技能页 | 内置技能列表与详情；一行讲清用途 | 注入到对话框 |
| 新建需求 | 「探索流程」和「实施流程」二选一 | 弹窗引导到 wayfinder / to-spec / to-tickets |
| 后端与环境 | GitHub / 本地 Markdown / GitLab 切换；环境逐项自检（10/10）；仓库权限与只读提示 | 刷新；登录；fork 建议 |
| 在办表 / 胶囊 | 跨会话在办票；当前会话在办；可接/BUG/诊断分流；刷新 | 状态栏胶囊、在办表浮层 |

可借鉴的 UI 原则：

- **薄列表 + 按需详情**：列表只回键、标题、状态、标签、认领、阻塞；正文和评论按需取。对应 Deck 的 `detail=thin` / `issue-get body=excerpt`。
- **明确的 partial / unknown 状态**：子票没取全、REST 降级、配额耗尽、读回没成功，都在 UI 上如实说，不把不完整当完整。
- **权限横幅**：只读仓库直接标出来，不让用户点了才发现不能写。
- **frontier 视图**：不只列「所有 open」，而是列「可接」；这是地图票真正有用的视图。
- **懒加载**：面板正文第一次打开才加载；隐藏时不轮询；只在可见时刷新。
- **写后读回**：任何写操作的回执都附落点证据，不能只报「成功」。

不该照搬的 UI 见第 6 节。

---

## 2. relay 现状

### 2.1 事实源与存储

- 任务库事实源在插件数据目录：`<插件数据目录>/tasks/<workspace-group>/`（`RELAY/lib/taskstore.js:42` 的 `ensureTaskStore`）。
- 布局：`.agents/TASKS.md`（表格 + 详情段）、`.agents/claims/<号>/`、`.agents/TASKS-archive.md`、`.agents/task-events.jsonl`、`.agents/backups/ops/`、`graph.json`、`meta.json`。
- 工作区里的 `.agents/TASKS.md` / `claims/` 是**只读导出快照**（`RELAY/lib/taskstore.js:160` 的 `exportTaskStore`），不是事实源。
- 首次导入自动；`/relay task import --force` 才把手改过的快照镜像回任务库（`RELAY/lib/taskstore.js:70`），覆盖前备份。
- `graph.json` 只存父子与依赖：`{ version: 1, tasks: { [id]: { parentId, dependsOn[] } } }`（`RELAY/lib/taskgraph.js:8`、`:59`）。

### 2.2 任务字段

`RELAY/lib/tasks.js:75` 的 `parseTaskDoc` 读表格；表头是：

| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |
|---|---|---|---|---|---|
| `T1` | `P1` | 标题 | `.agents/worktrees/...` | 是/否 | 自由文本 + 时间 + 人 |

认领目录才是认领事实源：`claims/<号>/owner` 写会话 id + UTC 时间，`done` / `abandoned` 写结论；`statusFor` 生成表格里的状态文案（`RELAY/lib/taskops.js:316`）。表格写「待认领」但 claims 存在时，以 claims 为准。

### 2.3 状态词与推导

`RELAY/lib/tasks.js:33` 的 `TASK_STATES`：

| 状态 | 含义 | 主要来源 |
|---|---|---|
| `open` | 待认领 | 无 claim，状态空或写待认领 |
| `dead` | 持有者已失效 | 会话不存在/归档/最后一轮出错或中断 |
| `stale` | 持有者久未活动 | 空闲超过 `STALE_IDLE_MS`（6 小时） |
| `live` | 进行中 | claim 存在，持有者活着 |
| `queued` | 待合并 | 有交付提交但不在 origin/main |
| `partial` | 部分合入 | 部分提交在 main、部分不在 |
| `likely` | 疑似已合入 | main 上有提交提到任务号但交付提交对不上 |
| `merged` | 已合入 | 交付提交在 main 或文字写明已合入 |
| `abandoned` | 已放弃/作废 | `abandoned` 文件，或提交被 revert |
| `unknown` | 状态不明 | 有状态文本但推不出来 |

`classifyTasks` 在 `RELAY/lib/tasks.js:304`；它把表格行、详情段、claims、git 只读索引、持有者会话状态对起来。**relay 的「状态」是推导结果，不是可随手改的枚举**。

### 2.4 树、依赖、归档、导入导出

- **split**：`peer_task action=split id=<父> subtasks=[...] [serial]` 建 `<父>.1…`，写 `graph.json`；`serial` 让子任务串行依赖前一个（`RELAY/lib/impl.js:2584`）。
- **dispatch**：带 id 派发整棵子树；不带 id 派发依赖已满足的待认领/进行中任务；`dependsOn` 必须 `merged/abandoned/archived` 才放行；`mode=auto/wake/spawn`；`limit` 默认 3、上限 8（`RELAY/lib/impl.js:2618`）。
- **父任务自动完成**：子任务全部终态后，父任务写成「已合入（子任务全部完成）」（`RELAY/lib/impl.js:2693`）。
- **归档**：终态 `merged/abandoned` 超过 `taskArchiveAfterDays`（默认 7 天），或活动库超过 `taskStoreMaxActive`（默认 500）时，先归档最老的终态任务；归档段超过 `taskArchiveMaxBytes`（默认 1 MiB）移入 `tasks-archive.jsonl` 冷存（`RELAY/docs/task-store-design.md` 第 4 节；`RELAY/lib/taskstore.js:101`）。
- **导入/导出**：`/relay task import --force` 覆盖前备份；`/relay task export` 随时重导出；事实源不变（`RELAY/lib/impl.js:2168`、`:2200`）。

### 2.5 面板与工具

- 面板页：`overview / board / search / ops / mail`（`RELAY/lib/client.panel.js:1707`）。
- 任务区在「看板」页的一个可折叠 `TasksSection`：展开时读一次纯文本报告（约 2KB），不自动刷新；归档是「先预览拿 planId，再执行」（`RELAY/lib/client.panel.js:1085`）。
- 前端按需加载：`client.panel.js` 第一次打开「协作」标签/设置/侧栏时才下载；不往输入框挂常驻组件（`RELAY/CHANGELOG.md:217`、`:241`）。
- 模型工具 15 个 `peer_*`；工具说明尽量短；没有每轮都要遵守的「上报在办」规则。
- 基线：v1.10.0，243/243 测试；测试串行 `node --test --test-concurrency=1 test/*.test.js`。

### 2.6 GitHub 现状

- `RELAY/lib/github.js` 只做身份：登录、锁定账号数字 id、换号报警、审计；`requireIdentity` 在 `:201`。
- 没有 issue 读写；没有 repo 权限探测；没有 GitHub 票号 ↔ relay 任务号的链接表。
- 没有 `sync.json`、出站队列、`/relay sync`；这些是 4A 的目标架构，尚未实现。
- 容器环境实测：`gh --version` 是 2.103.3；`gh issue list --json ...` 可用（空仓库返回 `[]`）；`gh repo view` 因 PATH 里没有 git 可执行文件失败。**后续实现要走 `gh api` / 包装脚本，不能假设 `gh repo view` 可用**。

---

## 3. 字段映射表

| 概念 | Deck / GitHub | relay 现状 | 能否直连 | 转换与备注 |
|---|---|---|---|---|
| 票号 | `#123` / issue number | `T123`（可带前缀、可 `T123.1`） | 否 | 不能相等映射；必须建链接表 `relayId ↔ issueNumber` |
| 标题 | `title` | 表格「任务」列 | 单向上行 | L 只把本地标题写上去；GitHub 标题被改只进 `stale`/`conflict`，不自动覆盖 relay |
| 正文 | `body`（Markdown） | 详情段 `### T...` + 备注 | 部分 | relay 详情是自由文本；不建议整段双向覆盖 |
| 容器 | `wayfinder:map` issue / `spec` | 父任务 + 子任务（`parentId`） | 部分 | 地图容器可映射为父任务；但 relay 父任务会自动完成，需防误关 |
| 子票 | sub-issue / `parentKey` | `parentId`（split 生成 `.1`） | 部分 | GitHub 子票 id 与 `T1.1` 不同；需链接表 |
| 阻塞边 | `blockedBy`（原生 dependency 或正文行） | `dependsOn`（graph.json） | 方向同 | A dependsOn B = A 被 B 阻塞；但解除条件不同（见 4.4） |
| 平台状态 | `open` / `closed` | derived `open/live/merged/...` | 否 | 只记 `remoteState`；GitHub closed 不能直接当 `merged` |
| 流程态 | `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` | 无 | 否 | 建议新增独立 `stage`，不替换 derived state |
| 类型 | `wayfinder:*` / `bug` / `spec` / `map` | 无 | 否 | 建议只存可选 `kind` 元数据，不进入表格列 |
| 认领 | GitHub assignee（人） | `claims/<号>/owner`（会话 id） | 否 | 语义不同；L 不写 assignee，只读展示 |
| 同步标记 | 正文 `<!-- relay-task:T12 -->` + 标题 `[relay T12] ` | 无 | 否 | 只用于幂等搜索/读回；不写进 `TASKS.md` |
| 同步状态 | GitHub open/closed + labels | 无；将存 `sync.json` 的 `queued/in-flight/synced/stale/conflict/unknown/failed` | 部分 | 单向投影；`unknown` 不反推本地 |
| 进度 | 正文 `## 进度` 的 percent/note | 状态文本 / 详情备注 | 部分 | 可只读展示；不建议为进度改任务库 schema |
| 关闭原因 | `closeReason` | `done` / `abandoned` 文本 | 部分 | relay 的 done 文本包含提交号与可合并性，信息更多 |
| 评论 | issue comments | 详情段备注 + `task-events.jsonl` | 否 | relay 没有评论模型；不要为镜像造评论表 |
| 标签 | 类型/分诊标签 | 优先、需要构建、工作树 | 否 | P1、是/否 没有 GitHub 等价物；不要硬塞 label |
| URL | issue URL | 无 | 否 | L/M 可展示「打开原票」 |
| 归档 | GitHub 不归档（closed 保留） | `TASKS-archive.md` + 冷存 | 否 | GitHub closed 不应触发 relay 归档 |
| 权限 | push / triage | 本机 gh 身份 + 审计 | 部分 | relay 是单机单账号，不是每会话一个 GitHub 身份 |
| 预算 | Deck `quota`（点数/请求/子票上限） | 派发预算 + 唤醒预算 | 否 | L 需新增 gh 调用限流，不复用 Deck 的 quota 模型 |

### 3.1 流程态映射（建议）

把「流程态」与「执行态」分开，是本文最重要的设计建议：

| Deck/GitHub 流程态 | relay `stage`（建议） | relay derived `state`（继续保留） | 说明 |
|---|---|---|---|
| 无标签 / `needs-triage` | `triage` | `open` | 还没分诊，不应被 dispatch |
| `ready-for-agent` | `ready` | `open` | 可分派；默认值（没有 stage 时等价于 ready） |
| `needs-info` / `ready-for-human` | `hold` | `open` 或 `live` | 等人/等外部信息；不自动派发 |
| `wontfix` | `dropped` | `abandoned` | 不做；保留原因 |
| （无） | 不存 | `live` / `queued` / `partial` / `likely` / `merged` / `abandoned` | 由 claim、提交、合并推导，不由 stage 决定 |

这样 `peer_task` 不需要新增一堆状态枚举；`stage` 只影响「能不能派发 / 面板怎么分组」，`state` 仍然是事实推导。GitHub 侧的标签/关闭投影见 4A.6。

---

## 4. 冲突点

### 4.1 事实源冲突（最高）

Deck 以 GitHub 为事实源；relay 的 1.8 设计已明确「插件为唯一事实源，工作区文件只读导出」（`RELAY/docs/task-store-design.md` 开头三条）。如果接入 GitHub 时让它参与写任务状态，就会出现两个事实源：

- GitHub 上有人手动 close / 改 label / 改 assignee；
- relay 里有人 claim / done / abandon / split；
- 两边都“看起来对”，但派发、归档、父任务自动完成会按不同事实走。

**结论：本地任务库是唯一事实源；GitHub 只能做投影。L 只做本地→GitHub 单向投影，`unknown` 不反推本地；C 的双向同步不在当前范围。**

### 4.2 认领语义冲突

- relay：认领 = 本地会话 id（`claims/<号>/owner`），一个会话一个 owner，带接手链；没有「人」的概念。
- GitHub：assignee 是 GitHub 用户（人）；Deck 把 assignee 就当认领。

relay 的所有会话共用同一台机器的 gh 账号，把 owner 写成 assignee 只会得到「同一个账号认领了所有票」，没有区分度。**L 不写 assignee；只读展示「GitHub 指派给谁」作为附加信息。**

### 4.3 状态语义冲突

- relay 的 `merged` 需要交付提交在 origin/main 上，`queued/partial/likely` 区分「写了完成但没合/只合了一部分/疑似合了」。
- GitHub 的 `closed` 只表示票关了，可能是完成、重复、不做、误关。
- Deck 的 `closeReason` 是自由文本，且不同 kind 落在不同位置（Answer / 评论 / Close reason 行）。

**不能把 GitHub `closed` 映射成 relay `merged`。** L/M 的读回里都建议显示两个状态：「GitHub: closed」+「relay: 待合并/已合入/…」，让用户看到差异。

### 4.4 依赖方向与终态集合冲突

- 方向一致：`dependsOn` = `blockedBy`，A 依赖 B 即 A 被 B 阻塞。
- 终态不同：Deck 的 blocker 只要 `closed` 就解除；relay 要求 blocker `merged/abandoned/archived`。GitHub 上 close 一张票，relay 不会因此认为依赖满足。
- 环处理：Deck 批量写前预检；relay 的 `graph.json` 目前没有显式环检测（`split serial` 天然线性，但手工 `dependsOn` 可能成环）。镜像只读不需要改，L 写回前需要补。

### 4.5 票号与父子结构冲突

- relay 子任务 id 是 `<父>.1`；GitHub 子票是独立 issue number。不能用 `T1.1 == #2` 这种假设。
- relay 父任务在子任务全终态后自动 `merged`；如果 GitHub 地图容器被镜像成 relay 父任务，可能被自动完成，而 GitHub 地图还开着。
- 必须建链接表，并给「自动完成」加来源判断：只有 relay 自己 split 出来的子任务才触发自动完成，镜像来的不触发。

### 4.6 标签与字段冲突

relay 的表格列「优先 / 需要构建 / 工作树」在 GitHub 没有直接对应；Deck 的类型/分诊标签在 relay 也没有。硬映射会造成：

- `P1` 被写成 `priority:high` 之类的自定义 label，和仓库现有 label 冲突；
- `需要构建` 被写成 label，污染 issue 列表；
- `wayfinder:*` 被写进 relay 的 `status` 文本，破坏状态推导。

**建议：relay 侧只存可选 `kind` / `stage` 元数据；GitHub 侧只读识别 `wayfinder:*` / `bug` / `ready-for-*`，不把 relay 的优先级写回 GitHub。L 的投影标签见 4A.6。**

### 4.7 导出快照与 243 个测试

- `.agents/TASKS.md` 是导出快照，第三方工作区/脚本会读；加列、改表头、改状态文案都可能破坏兼容。
- `test/taskstore.test.js`、`test/taskops.test.js`、`test/taskboard.test.js`、`test/tasks.test.js` 对格式、导入导出字节、归档、claims 有断言。
- 任何 GitHub 链接信息都不应写进 `TASKS.md` 表格；放在插件库的独立文件 `sync.json` 里（见 4A.1），导出时忽略。

### 4.8 权限与身份冲突

- relay 的 gh 身份是「本机共用、可锁定账号」；Deck 的权限是「当前工作区仓库的 push/triage」。
- relay 的模型工具可能被任何工作会话调用；L 的出站写必须限定为插件自己的同步队列（不接任意会话的自由写），并过 `requireIdentity` + 审计；主会话/用户可暂停、重试、跳过。
- 私有仓库只读也需要凭据；M 只读镜像也不能假设匿名可读。

### 4.9 并发与外部编辑

- relay 的锁只管本地任务库（`withBoardLock`）；GitHub 上的改动不受这个锁约束。
- 如果 C 双向同步，必须处理「同一票两边同时改」「GitHub 评论/标签改完 relay 又覆盖」；没有 webhook 的容器环境只能轮询，延迟和冲突都难避免。

### 4.10 归档与删除

- relay 会把终态任务移入归档/冷存；GitHub issue 不会消失。
- M 只读镜像如果按 GitHub 列表全量展示，会把 relay 已归档的任务重新显示出来；需要「归档墓碑」过滤。
- L 写回时，relay 归档不应自动关闭 GitHub issue；关闭 GitHub issue 也不应自动归档 relay 任务。

---

## 4A. 本地为准的同步架构（用户 2026-11-06 定）

> 本章是用户决策后的目标架构，不是现有实现。现有 relay 只有任务库和 GitHub 身份，没有 `sync.json`、出站队列或 `/relay sync`。

### 4A.1 事实源与文件

- **唯一事实源**：插件数据目录里的 `tasks/<workspace-group>/`；工作区 `.agents/TASKS.md` 仍是只读导出快照。
- **本地操作不等网络**：claim / done / abandon / split / 派发 / 归档全部先写本地任务库；同步队列只做后台投影，不阻塞、不回滚本地任务。
- **新增 `sync.json`**：与 `graph.json` 并列，存链接表、出站队列、每条链接票的同步状态；重启后可恢复，不进入每轮上下文。

建议形状（实现时可调整字段名，但语义保留）：

```json
{
  "version": 1,
  "repo": "owner/repo",
  "paused": false,
  "links": {
    "T12": {
      "issue": 123,
      "state": "queued",
      "intent": "create",
      "idempotencyKey": "relay:T12:create:20261106T235900Z",
      "attempts": 0,
      "lastError": "",
      "lastAttemptAt": null,
      "unknownSince": null,
      "remoteState": "open",
      "remoteUpdatedAt": null,
      "lastSyncedAt": null
    }
  },
  "queue": ["T12"]
}
```

- 文件布局：

```text
tasks/<group>/
  .agents/TASKS.md                  # 事实源（表格 + 详情段）
  .agents/claims/<id>/              # owner / done / abandoned
  .agents/TASKS-archive.md          # 归档
  .agents/task-events.jsonl         # 本地事件
  graph.json                        # 父子 + dependsOn
  sync.json                         # 新增：链接表 + 出站队列 + 同步状态
  meta.json
```

- `sync.json` 用原子替换 + 锁写；出站队列按仓库串行消费；任务库的 `TASKS.md` / `graph.json` 不因同步失败而回滚。
- **不导出 `sync.json`**：它是插件库内部状态，不写进工作区快照，避免第三方脚本/旧版本误读。

### 4A.2 每条链接票的状态机

| 状态 | 含义 | 典型下一步 | 是否改本地任务状态 |
|---|---|---|---|
| `local` | 还没有 GitHub 链接（同步关闭/未开启） | 开启同步后转 `queued` | 否 |
| `queued` | 有出站意图排队，尚未发出 | 串行消费后转 `in-flight` | 否 |
| `in-flight` | 正在发请求；崩溃/超时可能留下半成品 | 读回成功转 `synced`，否则转 `unknown` | 否 |
| `synced` | 最近一次写已读回并核对一致 | 本地新变更转 `queued`；远端更新转 `stale` | 否 |
| `stale` | 远端有比 `lastSyncedAt` 更新的改动，但还没判冲突 | reconcile 后转 `synced` 或 `conflict` | 否 |
| `conflict` | 远端改动与本地意图冲突（人工关/改、标签被改等） | 主会话选 local-wins / remote-wins / detach | 否，除非主会话显式改本地任务 |
| `unknown` | 这次操作**可能已执行**，但没有可靠回执/读回 | 先按 marker 搜索，再 reconcile 或重发 | 否 |
| `failed` | 明确的非网络失败（参数、权限、404、校验失败等） | 修正后重试；连续失败升级主会话 | 否 |

**`unknown` 的触发**（满足任一即可）：

- 请求超时，且没有拿到响应；
- 连接重置（`ECONNRESET` / `EPIPE` / TLS 中断）；
- DNS 解析失败、IP 被挡、代理/网络不可达；
- `gh` 退出码不明（被信号杀掉、无输出、输出无法解析）；
- 写请求已发出但没有完成读回。

**必须记录的字段**：`intent`（create / update / close / comment / edge）、`idempotencyKey`、`attempts`、`lastError`、`lastAttemptAt`、`unknownSince`、`remoteState`（已知时）、`lastSyncedAt`。

**硬规则**：

- `unknown` **绝不等于成功**；不能把 `unknown` 直接标成 `synced`。
- `unknown` **不改变本地任务状态**；本地 claim / done / archive 照常。
- `unknown` 期间不自动 close/reopen GitHub 票；先 reconcile。
- 只有读回证据（issue 号 + marker + 远端字段）才能把 `unknown` 收敛为 `synced` / `conflict` / `failed`。

### 4A.3 幂等与核对

- **建票 marker**：正文写入隐藏标记 `<!-- relay-task:T12 -->`；标题固定前缀 `[relay T12] `。marker 是认票的第一依据，标题前缀是人工可读的第二依据。
- **重试前先搜**：按 marker + 标题前缀搜索；找到就补链接，不再建第二张；找不到才重新 create。
- **建后读回**：读回 issue 号、marker、标题、状态；不一致转 `conflict`，不硬认。
- **patch / close 幂等**：同值重写视为成功；已经 closed 再 close 视为成功；已经 open 再 open 视为成功。
- **边用集合写**：`dependsOn` / 子票边先算目标集合，再整批写，再读回；远端多出的边不静默删除，进 `conflict` 等主会话决定（local-wins 时才按本地集合收敛）。
- **close 边界**：只有 relay 明确终态（`merged` / `abandoned`）且配置允许时才 close；默认只评论、不 close（见 4A.6）。
- **reconcile**：定期或按需读远端（M 的读路径可复用），更新 `remoteState` / `remoteUpdatedAt`；发现远端更新先转 `stale`，有冲突转 `conflict`。

### 4A.4 重试与升级

- **每仓库串行**：同一仓库同一时刻只跑一个出站请求，避免并发建票和边写乱序。
- **指数退避 + 抖动**：建议 30 秒 → 2 分钟 → 8 分钟 → 30 分钟 → 1 小时封顶，抖动 ±20%；队列持久化，重启继续。
- **升级条件**：连续 3 次失败，或 `unknown` 持续超过 10 分钟 → 主会话接管。
- **主会话入口**：`peer_sync`（计划）或 `/relay sync status|retry|skip|detach|off`；用户可直接 `/relay sync off` 暂停出站（本地任务照常）。
- **通知节流**：每个仓库每小时至多 1 次手机通知；文案说明「网络/IP 不稳、已排队 N 条、可稍后重试或暂停」，不逐条刷屏。没有网络/手机桥时只更新看板状态。
- **暂停语义**：暂停只停出站，不丢队列；恢复后从队首继续，先 reconcile 再发。

### 4A.5 主会话接管语义

主会话只能做这些：

- **查看**：`/relay sync status` 看每条链接票的状态、尝试数、最后错误、排队数。
- **重试**：`/relay sync retry <id>` 或 `retry --all`；重试前先 reconcile。
- **跳过**：`/relay sync skip <id>` 把该条移出队列（保留链接/本地任务），记录原因。
- **解绑**：`/relay sync detach <id>` 断开链接，保留本地任务；不再自动同步该票。
- **暂停/恢复**：`/relay sync off` / `on`。
- **标记知悉**：可以确认「已看到网络问题」，但不能无读回证据把 `unknown` 标成 `synced`。

**冲突处理**（`conflict`）：

- `local-wins`：按本地意图重写并读回；需要 reopen/close 时由主会话显式确认。
- `remote-wins`：接受远端为现状，该字段不再由本地投影（相当于该字段只读）；**不自动覆盖本地任务状态**；如要改本地，主会话用 `peer_task` 显式做。
- `detach`：断开链接，保留两边现状。
- 默认不自动 close/reopen；所有接管动作写审计/事件。

### 4A.6 多流程态投影

GitHub 只是投影，投影规则固定、可审计：

| relay derived state | GitHub state | GitHub labels | 默认动作 |
|---|---|---|---|
| `open` | `open` | `relay:managed` + `relay:open` | 建票/保持 open；不改评论 |
| `live` | `open` | `relay:managed` + `relay:in-progress` | 可选评论「开始处理」；不 close |
| `dead` / `stale` | `open` | `relay:managed` + `relay:in-progress` | 只更新链接状态；等主会话处理，不自动 close |
| `queued` / `partial` / `likely` | `open` | `relay:managed` + `relay:in-progress` | 不 close；可评论待合并说明 |
| `merged` | `closed` | `relay:managed` + `relay:merged` | 已审批才评论结论 + 写合并总结；`closeOnTerminal=true` 且总结已写时才 close |
| `abandoned` | `closed` | `relay:managed` + `relay:abandoned` | 评论原因；`closeOnTerminal=true` 时才 close |
| `unknown`（同步状态，不是 derived state） | 保持上次已知 | 不改 | 不写、不 close；重试/ reconcile |

- **地图**：relay `kind=map` 父任务 → GitHub `wayfinder:map` issue；子任务 → sub-issue；`dependsOn` → `blocked_by`；子票标签 `wayfinder:research|prototype|grilling|task`。
- **frontier 本地算**：仍按 relay 终态集合（`merged/abandoned/archived`）判断依赖是否满足，不用 GitHub closed。
- **GitHub closed ≠ relay merged**：远端 closed 只记 `remoteState`，不反推本地状态。
- `dead` / `stale` 的 `relay:in-progress` 只表示票还开着，不代表有人在做；是否重新认领以本地任务为准。
- **默认只评论、不自动 close**；`closeOnTerminal` 默认 `false`；即使打开，也必须在审批+合并总结之后（见 4A.9）。
- **GitHub Projects 的 Status 字段默认不做**：labels + open/closed 足够；是否启用留作开放问题。

### 4A.7 地图票规则

- 父任务 `kind=map` → `wayfinder:map` issue；子任务 → sub-issue；`dependsOn` → `blocked_by`。
- 本地父任务自动完成仍由 relay 子任务终态触发；投影只反映结果，**GitHub 地图被人工关闭不会自动完成 relay 父任务**。
- 地图子票的 `wayfinder:*` 类型来自 relay 的 `kind`/元数据；没有类型时默认 `wayfinder:task`，不猜。
- 不写 assignee：owner 是会话，不是 GitHub 人。

### 4A.8 离线与权限

- **无 gh / 无 push**：所有出站停在 `queued`，面板明确提示「只排队、未写 GitHub」；本地任务照常。
- **只写当前工作区 origin**：不跨仓库、不猜 fork、不写上游；仓库身份从 origin URL 解析。
- **不写 assignee**：GitHub assignee 是人的概念，relay owner 是会话；只读展示。
- **网络不稳是常态**：允许长时间 `queued`/`unknown`；设计和 UI 都要说清「GitHub 可能落后，本地是准的」。

### 4A.9 审批门与关票顺序（用户 2026-11-06 定）

用户明确要求：**merged 前要仔细审批代码，审批完才能 merged；合并总结之后再关 GitHub issue。** 因此同步投影加一道审批门，不改 relay 现有的「提交在 main 才推导 merged」规则，而是在此之上增加显式审批记录：

- **新增本地字段 `approval`**：`pending`（默认，提交已在 main 但未审批）/ `approved`（用户或主会话显式记录审批通过）/ `rejected`（打回，继续修）。审批人只能是用户或本工作区主会话；模型不能自动批准。
- **面板/看板展示**：提交已在 main 但 `approval=pending` 的票显示「已合并 · 待审批」，不显示为已完成、不参与派发完成统计。
- **投影规则**：只有 `approval=approved` 才写 `relay:merged`、才允许评论合并结论、才允许在合并总结之后 close；`pending` 期间 GitHub 票保持 open，标签用 `relay:review`（待审批）。
- **顺序硬约束**：① 代码审批通过 → ② 合并（提交在 origin/main）→ ③ 写合并总结（本地 task note + GitHub 评论，含提交号、范围、验证结果）→ ④ 关 GitHub issue。任一步缺失就停在当前步，不跳步；关票默认仍由人/主会话显式触发，`closeOnTerminal` 即使打开也只到第 ④ 步、且只在总结存在时执行。
- **abandoned 不受审批门限制**，但仍要评论原因，默认不 close。
- **审计**：审批、合并总结、关票各写一条 task 事件（谁、何时、依据）；GitHub 关票失败按 unknown/重试处理，不重复关。

---

## 5. 接入方案

> 本节按用户 2026-11-06 的决策改写：原「先 A 只读，再 B 单向写」被 L 取代；原 A 的读回核对能力吸收进 L 的 reconcile，M 只保留为可选诊断。GitHub 是投影，不是事实源。

### 5.1 方案 L：本地为准的单向同步（推荐）

**范围**

- 任务库事实源不变；新增 `sync.json` 存链接表、出站队列、每条链接票的同步状态（见 4A.1—4A.2）。
- 本地 claim / done / abandon / split / archive 先写本地，任何网络失败都不阻塞、不回滚；出站队列后台串行消费。
- 建票幂等：正文 `<!-- relay-task:T12 -->` + 标题 `[relay T12] `；重试前按 marker 搜索，避免重复建票。
- 状态投影：open/closed + `relay:managed` / `relay:open` / `relay:in-progress` / `relay:merged` / `relay:abandoned`；地图 `wayfinder:map`，子票 `wayfinder:*`。
- 地图结构：relay `kind=map` 父任务 → map issue；子任务 → sub-issue；`dependsOn` → `blocked_by`；frontier 仍按 relay 终态集合本地算。
- 未知态：超时/连接重置/DNS/IP 被挡/gh 退出码不明 → `unknown`；自动重试；连续 3 次失败或 unknown >10 分钟 → 主会话接管。
- 主会话入口：`peer_sync`（计划）或 `/relay sync status|retry|skip|detach|off`；每仓库每小时至多 1 次网络通知。
- close 默认关闭：只有 `merged` / `abandoned` 且 `githubSync.closeOnTerminal=true` 才 close；默认只评论。
- 不写 assignee；只写当前工作区 origin；不做 GitHub Projects Status（默认）。
- 写后读回：建票/改状态/写边都读回；`unknown` 不能当成功。

**成本（粗估，含测试）**：10–14 人日。

- `sync.json` + 队列 + 状态机（含 unknown）：2–3 人日；
- 幂等建票 + marker 搜索 + 读回：2–3 人日；
- 状态/地图/子票/依赖投影：2–3 人日；
- 重试、升级、通知、`/relay sync` 命令：2–3 人日；
- 假 gh fixtures + 测试 + 手动验证：2–3 人日。

**风险**

- **unknown 误判**：把可能已执行的写当成失败重发，造成重复票；必须 search-before-create + marker + 读回。
- **网络/IP 不稳**：长时间 queued/unknown 是正常态；UI 必须说清「GitHub 落后，本地准」。
- **权限/只读仓库**：写一半失败；需预检 push，不足时全部留在 queued。
- **状态投影误关**：`merged/abandoned` 之外的任何本地状态都不 close；GitHub closed 不反推本地。
- **队列恢复**：崩溃后 in-flight 可能变 unknown；重启必须先 reconcile 再发。
- **测试不能真打 GitHub**：所有 gh 调用必须可注入 fake。

**对现有影响**

- 243 测试：现有任务库测试预期不改；新增 20–30 个同步测试（fake gh、断网、unknown、恢复、幂等、冲突）。S1 子集新增 10–15 个。
- 任务库：只新增 `sync.json`；`TASKS.md` / `graph.json` 不变、不导出；本地任务零影响。
- 权限：需要 push 才能建票/改标签/评论；不写 assignee；写操作过 `requireIdentity` + 审计；无 push 全部 queued。
- 上下文：`/relay sync` 是命令/面板入口，不新增每轮工具；`peer_sync` 只在主会话按需使用。

**验收**

- 断网时本地 claim/done/split 正常；队列持久化，重启不丢。
- 模拟超时/连接重置 → `unknown`；恢复后 reconcile，不重复建票；本地任务状态不变。
- 模拟无网络/无 gh 时全部 queued，面板明确提示；`/relay sync off` 立即停出站。
- 地图父任务/子票/依赖边投影正确；GitHub closed 不改变 relay 父任务。
- 243/243 现有测试 + 新增测试全绿。

### 5.2 方案 M：只读镜像（可选诊断/对照）

**范围**

- 只读模块读当前工作区 origin 的 issue；识别 `wayfinder:map` / `wayfinder:*` / `bug` / `relay:*`；解析父票/阻塞/frontier；只在面板展开或手动刷新时取，60 秒缓存。
- 面板只读折叠区；明确标注「只读镜像，不改变 relay 任务」；不建票、不改 label、不写 assignee、不关票、不导入任务库。
- 可展示「GitHub 现场 vs relay 本地」的差异，用于排障和人工对照；不参与 L 的写决策。
- **M 不是 L 的前置**；L 的 reconcile 复用同一套读路径，但不依赖 M 的 UI。

**成本（粗估，含测试）**：3–5 人日。

**风险**

- 误把镜像当事实源；UI 必须持续标注。
- gh/网络/权限失败；`gh repo view` 在容器里不可用，要走 `gh api`。
- parent/dependency 能力随 gh 版本/仓库开关不同，需要正文行回退。

**对现有影响**

- 243 测试：不改现有断言；新增 8–12 个测试。
- 任务库：零 schema；不写 `sync.json`；不导出。
- 权限：只读；不要求 push/triage。
- 上下文：不新增每轮注入；不新增模型工具。

**验收**

- 面板能看到地图列表、子票、依赖、frontier、流程标签；`.agents/TASKS.md` 字节不变；无 gh/无权限有明确提示。

### 5.3 方案 C：双向同步

**范围**

- 在 L 的基础上加 GitHub → relay 的回读：轮询/手动刷新；GitHub 新建/关闭/改 label/改 assignee 映射回 relay；冲突检测与解决；删除/重开；评论同步。
- 需要：链接表、版本号/ETag、字段级冲突策略、循环抑制、墓碑、审计、迁移。

**成本（粗估，含测试）**：18–26 人日；仅冲突策略与回归测试就至少 5–7 人日。

**风险**

- 两套状态机无法完全对齐；任何自动映射都有信息损失。
- 双向写环、重复评论、误关票、误派发；一个 bug 可能同时污染任务库和仓库。
- 没有 webhook 的容器环境只能轮询；延迟 + 配额 + 冲突更糟。
- 权限 push + triage 都要；单机账号让「谁改的」不可区分。

**对现有影响**

- 243 测试：大概率要改 taskstore/tasks/impl/panel 的断言；新增 30–50 个测试。
- 任务库：可能需要 schema 升级与迁移；导出兼容风险高。
- 权限：读写都要；审计要求最高。

**结论**：2.0 之前不做。

### 5.4 比较表

| 维度 | L 本地为准单向同步 | M 只读镜像 | C 双向同步 |
|---|---|---|---|
| 数据方向 | relay → GitHub，远端只读回执 | GitHub → relay 只读 | 双向 |
| 目的 | 本地任务库投影到 GitHub；网络可延迟/未知 | 人工对照、排障、差异查看 | 以 GitHub 为入口反向改 relay |
| 是否改任务库 | 新增 `sync.json`，主表/graph 不变 | 否 | 可能改 schema |
| 成本（人日） | 10–14 | 3–5 | 18–26 |
| 243 测试影响 | 现有不改，新增 20–30 | 基本不变，新增 8–12 | 大概率要改 |
| 权限 | push；不写 assignee | 读 | push + triage |
| 主要风险 | unknown 误判、重复建票、误 close | 误把镜像当事实源 | 冲突、环、信息损失 |
| 适合阶段 | **现在（S1 5–7 人日）** | 可选诊断 | 暂不 |
| 推荐 | **先做** | **可选** | **不做** |

### 5.5 推荐

**推荐路线：L（本地为准单向同步）→ S2 地图/状态投影 → S3 stage/可选 Projects；M 只做诊断；C 暂不做。**

为什么原「先 A 再做 B」被取代：

- 用户 2026-11-06 已定：插件作为中转接管，插件数据库是核心/校准，**本地为准**，同时同步 GitHub；IP 不稳不强求成功，必须有未知态。
- 这个决策把「先证明只读，再考虑写」改成「本地先正确，投影允许延迟/unknown」；原 A 的读回回执不是前置门槛，而是 L 的 reconcile 工具。
- 原 B 的建票/边/状态投影范围并入 L；L 比 B 多了 `sync.json`、unknown、重试、主会话接管，所以成本从 8–12 升到 10–14。
- M 保留为只读对照，不作为 S1 依赖；C 仍不做。

---

## 6. 明确不搬的 Deck 做法

### 6.1 已定事实

用户 2026-11-05 已定：**不安装上游 Deck（1.9.0-beta.33）**。原因包括：

- 1.9.0-beta.33 卡顿；
- 与 relay 的初始化、看板、汇报规则冲突；
- relay 已经自研了任务库、认领、派发、汇报合并，不需要再引入一套 issue 工具和面板。

这条不在本文重新讨论；本文只评估「借鉴哪些模型」，不评估「装不装 Deck」。

### 6.2 不搬的具体做法

| Deck 做法 | 为什么不搬 | relay 的替代 |
|---|---|---|
| 往输入框挂常驻组件（胶囊状态栏、在办胶囊） | 违反 relay「不往输入框挂常驻组件」；慢模型/窄屏成本高 | 面板按需展开；需要时 `/relay` 命令 |
| 前端全量/常驻加载、像素卡片墙、复杂动效 | relay 的 `client.panel.js` 是首次打开才下载；常驻入口约 85 KB，正文按需 | 纯文本/轻量列表；CSS 不做像素皮肤 |
| 27 个技能页 + 技能详情 + 注入 prompt | relay 不是技能市场；会撑大包和 UI | 文档里引用技能链接；不内嵌技能库 |
| 「新建需求」弹窗 + 探索/实施二选一 + 自动注入 prompt | 这是 Deck 的引导流程；relay 的任务创建应走 `peer_task`/用户命令，避免隐藏的 prompt 注入 | 可选 `/relay task new` 帮助文案；不自动改输入框 |
| 每轮 `deck_issue_report` 上报在办 | relay 明确不加「每轮都要遵守的上报规则」；现有 claim/done 事件已足够 | claim/done/abandon 写事件；面板按需读 |
| 每轮 `suggest_next_steps` / 建议气泡 | 每轮注入会抖动上下文；relay 的上下文预算很紧 | 不做；需要时用户问 |
| 10 个 deck 工具 + 长描述 | relay 工具说明要短；新增工具会扩大每轮上下文 | 最多加一个 `/relay` 子命令或面板入口；不新增 10 个工具 |
| 三后端抽象（GitHub / 本地 Markdown / GitLab） | relay 只需要当前工作区 origin；多后端会让权限、路径、测试翻倍 | 先只支持 GitHub；失败明确提示，不做 GitLab/本地双实现 |
| 后台全量探测（每个工作区扇出、5 秒活跃拍） | 配额和性能成本高；relay 面板已经按需读 | 60 秒缓存 + 手动/展开时刷新；不后台轮询 |
| GraphQL/REST 双通道 + 复杂限流闸 | Deck 是为大仓库/大面板设计的；relay 的读量小 | 先单通道 `gh api`；失败提示；若真撞限额再加降级 |
| 把 GitHub assignee 当认领 | relay 的 owner 是会话，不是人；单机账号会全部同名 | 只读展示 assignee；不双向写 |
| 把 GitHub `closed` 当完成 | relay 的完成要提交在 main；closed 可能是 duplicate/wontfix | 展示两个状态；不自动归档/不自动派发 |
| 用 label 表达所有流程态 | 会和 relay 的 derived state 打架 | label 只做投影（`relay:*`），不作为状态事实源；`stage` 本地存 |
| 让 GitHub 成为任务事实源 | 与 relay 1.8 的「插件唯一事实源」冲突 | GitHub 只做镜像/投影 |

### 6.3 可以搬的判断

- **薄列表 + 按需详情**：列表只回 8–10 个字段，正文/评论按需取。
- **frontier 视图**：可接 = 未关闭 + 未认领 + 阻塞已解除；比「所有 open」有用。
- **partial / unknown 明示**：不完整就说「这份清单不全」，不假装完整。
- **写后读回**：边和状态写完必须读回，回执不能只写 ok。
- **权限横幅**：只读仓库、缺 push/triage 直接说。
- **懒加载 + 可见时才刷新**：面板隐藏不轮询。
- **地图五区块**：Destination / Notes / Decisions / Not yet specified / Out of scope；relay 可以在只读详情里识别并展示，不必强制写。
- **流程态与执行态分离**：这是 Deck 最值得学的一点；不要把所有状态塞进一个字段。

---

## 7. 开放问题（带默认值，方便一句话确认）

| # | 问题 | 默认值 | 影响 |
|---|---|---|---|
| Q1 | 目标仓库怎么定？ | 当前工作区 `origin`；解析不出就关闭出站 | 决定同步哪个仓库、权限怎么配 |
| Q2 | 同步默认开还是关？ | 默认关；S1 上线后按工作区 opt-in | 避免影响现有工作区 |
| Q3 | 主方案选哪个？ | **L 本地为准单向同步**；M 仅诊断 | 决定本轮切片 |
| Q4 | 同步哪些票？ | 只同步 relay 管理/显式开启的票；不导入全仓库 issue | 避免噪音和误建 |
| Q5 | 地图容器怎么映射？ | relay `kind=map` 父任务 ↔ GitHub `wayfinder:map`；子票 sub-issue；链接表 | 决定父子/自动完成 |
| Q6 | 要不要本地流程态？ | 要，但只加独立 `stage`（`triage/ready/hold/dropped`），不替换 derived state | 决定是否扩展 graph.json |
| Q7 | GitHub assignee 要不要同步？ | 不要；只读展示 | 避免单机账号全同名 |
| Q8 | GitHub open/closed 要不要同步？ | 只记录 `remoteState`；不映射成 relay `merged` | 避免误归档/误派发 |
| Q9 | L 的写回范围？ | 建票/子票/依赖边/状态标签/评论；close 默认关 | 控制风险 |
| Q10 | conflict 默认怎么处理？ | 挂起 `conflict`，等主会话选 local-wins / remote-wins / detach；不自动 close/reopen | 防误关/误重开 |
| Q11 | GitHub closed 要不要触发归档？ | 不触发；归档仍按 relay 终态 + 天数/上限 | 保持任务库规则 |
| Q12 | reconcile/刷新频率？ | 60 秒缓存；面板展开/手动刷新时取；不后台全量轮询 | 控制配额 |
| Q13 | 入口放哪？ | 面板 + `/relay sync`；不加每轮工具；`peer_sync` 仅主会话按需 | 控制每轮上下文 |
| Q14 | 写权限不足怎么办？ | 全部停在 `queued` + 明确提示；不半写 | 避免半写失败 |
| Q15 | 什么时候做？ | bug 收集期后、**2.0.0 发布之后**（用户 2026-11-06 定）；S1 5–7 人日；不阻塞 2.0 | 排期 |
| Q16 | marker 格式？ | 正文 `<!-- relay-task:T12 -->` + 标题 `[relay T12] ` | 决定幂等搜索依据 |
| Q17 | 测试怎么隔离？ | 所有 gh 调用可注入 fake；fixtures 覆盖断网/超时/unknown/恢复/幂等/冲突 | 保证 CI 不打网络 |
| Q18 | unknown 超时/重试阈值？ | 连续 3 次失败或 `unknown` >10 分钟升级主会话；退避 30s/2m/8m/30m/1h + 抖动 | 决定接管时机 |
| Q19 | 通知节流？ | 每仓库每小时最多 1 次；文案带排队数 | 防止刷屏 |
| Q20 | close 策略？ | 只对已审批的 `merged`/`abandoned`；默认只评论；`closeOnTerminal=false`；即使开启也必须在合并总结之后 | 防误关 |
| Q21 | stage 是否上 GitHub label？ | 默认不上；stage 只在本地面板/派发用 | 避免两套状态标签 |
| Q22 | 是否要 GitHub Projects Status？ | 不做；labels + open/closed 足够 | 降低依赖和权限 |
| Q23 | unknown 是否阻塞本地？ | 不阻塞；本地 claim/done/archive 照常 | 保证本地可用 |
| Q24 | 暂停语义？ | `/relay sync off` 只停出站、保留队列；恢复先 reconcile | 防丢队列 |
| Q25 | 出站并发？ | 每仓库 1 个 in-flight；跨仓库可并行 | 防重复建票/边乱序 |
| Q26 | 审批门怎么记？ | 新增 `approval: pending/approved/rejected`；用户或主会话显式记录，模型不自动批准；pending 显示「已合并 · 待审批」 | 决定 merged 投影与关票顺序 |
| Q27 | 合并总结形式？ | 本地 task note + GitHub 评论（提交号、范围、验证结果）；总结存在才允许关票 | 满足「总结之后再关票」 |

一句话确认示例：

> 已定（用户 2026-11-06）：Q1–Q27 全默认；先做 L；S1 排在 2.0.0 之后；M 仅诊断；C 暂不做。

---

## 8. 下一步最小可做切片

### 8.1 切片 S1：同步骨架（默认关闭，5–7 人日；排期 2.0.0 之后）

**目标**：先只做「本地 → GitHub」的同步骨架：链接表、出站队列、状态机（含 `unknown`）、幂等建票、重试与 `/relay sync status`。不做地图/子票/依赖/状态投影，那些留给 S2。排期：**2.0.0 发布之后**（用户 2026-11-06 定），不阻塞 2.0。

**改动面**

1. 新增 `RELAY/lib/sync.js`（或 `github-sync.js`）：
   - `sync.json` 读写：链接表、出站队列、每条链接票的状态/意图/幂等键/尝试数/错误/unknownSince；原子替换 + 锁；重启恢复。
   - 状态机：`local / queued / in-flight / synced / stale / conflict / unknown / failed`；`unknown` 触发与字段见 4A.2。
   - 队列：每仓库 1 个 in-flight；指数退避 + 抖动；暂停/恢复。
2. `RELAY/lib/taskstore.js`：首次建库/导入时确保 `sync.json` 存在；**不导出**、不写 `TASKS.md`、不改 `graph.json`。
3. 出站写模块（可放在 `RELAY/lib/github-sync.js`）：
   - 建票前按 marker + 标题搜索；建后读回 issue 号和 marker；不重复建。
   - 只处理 `create` 与只读 reconcile；`patch/close/edge` 的完整投影留到 S2（但状态机/幂等接口先定好）。
   - `closeOnTerminal` 默认 false；不写 assignee。
4. `RELAY/lib/impl.js`：
   - `/relay sync status|retry|skip|detach|off|on`；主会话/用户权限；写事件/审计。
   - `peer_sync` 可以后置；S1 先保证命令入口可用。
   - 不新增每轮工具、不进每轮上下文。
5. `RELAY/lib/client.panel.js`：可选一个很小的「同步状态」折叠区（排队数/unknown 数/最后错误）；默认关闭，不阻塞上线。
6. `RELAY/test/sync.test.js` + `RELAY/test/fixtures/sync/*.json`：
   - fake gh：成功、超时、`ECONNRESET`、DNS/IP 被挡、无 push、退出码不明；
   - 恢复 reconcile、重复建票防护、队列持久化、暂停恢复、`unknown` 不改变本地任务。

**明确不做**

- 不做地图骨架 / 子票 / 依赖边 / 状态标签投影（S2）；
- 不做 `stage` / GitHub Projects（S3）；
- 不写 assignee、不自动 close、不改 `TASKS.md` / `graph.json` / 导出快照；
- 不新增每轮上下文、不在输入框挂组件。

**验收**

- 模拟断网/超时：链接票进入 `unknown`，本地任务状态不变；恢复后 reconcile，不重复建票。
- 重启后队列与 `unknown` 可恢复；`/relay sync status` 能看到尝试数、最后错误、排队数。
- `/relay sync retry|skip|detach|off` 可用；`off` 只停出站、不丢队列。
- 无 gh / 无 push：全部 `queued` 并明确提示，本地 claim/done/split 照常。
- 本地任务库/导出快照零影响（`.agents/TASKS.md` 字节不变）；243/243 现有测试 + 新增测试全绿；默认关闭时对现有工作区零影响；测试不打真实网络。

**成本**：5–7 人日。

### 8.2 后续切片

- **S2（6–8 人日，粗估）**：地图骨架/子票/依赖边/状态投影。`kind=map` → `wayfinder:map`；子任务 → sub-issue；`dependsOn` → `blocked_by`；`relay:open/in-progress/review/merged/abandoned` 标签；`merged` 需 `approval=approved`，审批 → 合并 → 合并总结之后才评论并可选择 close；冲突进 `conflict`。
- **S3（2–3 人日 + 可选 2–3 人日）**：本地 `stage`（`triage/ready/hold/dropped`）与可选 GitHub Projects Status；默认不把 stage 写成 label。
- **C（双向同步）**：暂不做。

---

## 9. 证据索引

| 结论 | 文件与位置 |
|---|---|
| 六种对象与标签规则 | `DECK/deck/rules/object-kind.js:10`、`:16`、`:24`、`:118` |
| parent / blockedBy 与落点判定 | `DECK/deck/rules/edge-landing.js:8`、`:83`；`DECK/deck/shell/edge-landing.js` |
| 一次建整张地图骨架/续跑 | `DECK/deck/tools/map-plan-create.js:20`、`:49`、`:218` |
| 地图快照/统计/frontier | `DECK/deck/tools/map-snapshot.js:18`、`:23` |
| 关票原因与进度 | `DECK/deck/tools/issue-patch-definition.js:13`、`:27`、`:38` |
| 权限 push/triage | `DECK/README.md:40`；`DECK/deck/tools/context.js:129` |
| 配额/预算 | `DECK/deck/tools/context.js:155` |
| 在办上报 | `DECK/deck/tools/issue-report.js:29` |
| 右侧面板 | `DECK/README.md:46-118`；`DECK/lib/client.js:1920`、`:2130`、`:54244` |
| wayfinder 四类/frontier | `DECK/bundled-skills-zh/wayfinder/SKILL.md` |
| 分诊五态 | `DECK/bundled-skills-zh/triage/SKILL.md` |
| GitHub 原生 sub-issue / dependency | `DECK/bundled-skills-zh/setup-matt-pocock-skills/issue-tracker-github.md` |
| relay 状态词 | `RELAY/lib/tasks.js:33`、`:304` |
| relay 认领/状态文案 | `RELAY/lib/taskops.js:257`、`:316` |
| relay 任务库/导入导出/冷存 | `RELAY/lib/taskstore.js:42`、`:70`、`:101`、`:160` |
| relay 树/依赖 | `RELAY/lib/taskgraph.js:8`、`:59` |
| relay split/dispatch/父自动完成 | `RELAY/lib/impl.js:2584`、`:2618`、`:2693` |
| relay 面板页/任务区/懒加载 | `RELAY/lib/client.panel.js:1085`、`:1707`；`RELAY/CHANGELOG.md:217`、`:241` |
| relay GitHub 身份 | `RELAY/lib/github.js:62`、`:201` |
| relay 任务库设计 | `RELAY/docs/task-store-design.md` |
| relay 维护约束（上下文预算） | `RELAY/docs/maintenance-guide.md:56` |
| 同步链接表 / 出站队列 / 未知态 / 重试（占位，实现后填行号） | `<插件数据目录>/tasks/<group>/sync.json`；`RELAY/lib/sync.js`（待实现）；`RELAY/lib/impl.js` 的 `/relay sync` 处理（待实现）；`RELAY/test/sync.test.js`（待实现） |

---

## 10. 备注：本轮实际核验

- 容器里 `gh --version` = 2.103.3；`gh issue list --state all --json number,title,state,labels,assignees,url,updatedAt,closedAt` 可执行（当前仓库返回 `[]`，说明这组字段被接受）；`gh repo view` 报 `unable to find git executable in PATH`。
- 这说明 M 只读镜像 / L 的 reconcile 读路径的第一条技术风险不是「gh 没有」，而是「gh 的子命令对 git/PATH 的依赖不一致」；实现应优先用 `gh issue list` / `gh api`，不要依赖 `gh repo view`。
- `sync.json`、出站队列、`/relay sync` 尚未实现；第 9 节只放证据位置占位，落地后补真实文件与行号。
- 本轮未连接真实地图票仓库、未创建任何 issue、未修改 relay 代码、未提交文档。
