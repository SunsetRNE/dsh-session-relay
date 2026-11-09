# 协作流程的 UI 补强（设计稿）

状态：A / B / C 已实现（2.4.3 已发布，T14 工作树 `t14-ui-flow`，基线 81f19b1）；票子驾驶舱（T15）在 2.4.4 未发布分支 `t15-ticket-cockpit` 上实现，见 §9。目标是把「主会话 / 工作会话 / 用户」的协作流程从聊天和文档搬进面板，让流程状态可见、下一步可点，同时不放松授权边界。实现位置见 §8。

## 1. 现在 UI 里已经有的流程

| 流程 | 所在位置 | 现状 |
| --- | --- | --- |
| 版本线 | 设置页编辑保存；会话页 / 概览摘要 | 可编辑，只读摘要；无发布进度 |
| 看板分组 | 需要处理 / 可合并 / 进行中 / 久未活动 | 状态来自插件分类 |
| 合并队列 | 会话卡片 `队列 #N` 胶囊、声明 `合并：可合并` | **只读**，不能在 UI 批准或排队 |
| 任务阶段与审批 | 任务页详情 | stage 展示；审批按钮（用户） |
| 交接 | 交接页 / 面板交接卡 | 起草、确认、失败回退 |
| 提问 | 面板问答 | `peer_ask_user` 的等待与回答 |
| 邮箱 / 同步 / 仓库守候 | 邮箱、更多、设置 | 各有用户动作 |

## 2. 缺口

1. **合并批准不在 UI 里**：用户只能在聊天里说“可以合并”，主会话说“收到”后再跑 git；看板上的 `#N` 只是标签，没有“批准 / 打回 / 稍后”。
2. **发布流程不可见**：版本线是自由文本；测试、打包、push、tag、Release、市场这几步只在 `docs/release-checklist.md` 里，面板不知道当前走到哪。
3. **主会话下一步靠记忆**：看板给了分组和计数，但没有“先回答提问，再合并 #1，再准备发版”的动作顺序。
4. **审批入口分散**：任务审批、问答、交接确认、合并批准、发版批准分散在不同页面；用户没有一个统一的“等我批”视图。

## 3. 设计原则

- **UI 只记录用户决定 + 通知主会话，不执行 git/gh 写操作**：推送、合并、tag、Release 仍由主会话在用户批准后执行，授权边界不变。
- 批准动作走现有面板用户动作通道（`settings-route`），只写插件存储、邮箱和唤醒；不改声明文件、不跑命令。
- 只读数据（版本、tag、Release、附件 sha）由服务端从 `package.json` / git / `gh` 读，缓存后展示；读失败显示“未知”，不猜。
- 所有新文案进 `docs/ui-copy.md`；KIT 按现有规则 bump（侧栏正文/面板各自 touch + KIT）。

## 4. 候选功能

### A. 合并流水线 + 批准（P1，小-中）

看板卡片和「可合并」分组里，把 `队列 #N` 变成一条小流水线：

```
可合并 → 已批准 → 已合入 → 随 vX.Y.Z 发布
```

- `可合并` 条目右侧给用户三个动作：**批准合并** / **稍后** / **打回（带理由）**。
- 批准后：写一条 `merge-approval` 记录（工作区、会话、sha、时间、用户），唤醒主会话（复用现有投递/邮箱），卡片变「已批准，等主会话合并」。
- 打回：记录理由，唤醒工作会话（`peer_send`），卡片留在可合并并标注打回原因。
- 合并后由版本线/提交事实自动进入 `已合入`；发布后进入 `已发布`。
- 边界：UI **不跑 git merge**；主会话收到“已批准”后仍需自己核验、合并、更新声明。

数据：服务端新增用户动作 `merge-approve` / `merge-reject`（写插件数据 + 投递）；board 快照增加 `approvals`；客户端按 sha/会话匹配渲染。测试覆盖动作权限、重复批准、sha 变化失效、过期清理。

### B. 发布状态卡（P1，中）

位置：设置页新增「发布」区，或会话页版本线卡下方。

- 只读事实：`package.json` 版本、`HEAD`、`origin/main`、最新 tag / GitHub Release、附件名与 size/sha、市场条目 PR（能读到就读）。
- 阶段条：准备 → 测试 → 打包 → 已 push → 已 tag → 已 Release → 市场 PR → 已上架；每步显示事实或「未知」。
- 动作：「复制发版清单命令」「唤醒主会话准备发版」「打开 Release / 市场 PR」；**没有** push/tag/Release 按钮。
- 读数据失败（无 gh、无网络）显示「无法读取」，不缓存错误为事实。

### C. 主会话「下一步」卡（P1，小）

概览首块或看板顶部：

1. 有待回答 / blocked 的汇报 → 先处理（列表）；
2. 有「已批准」的合并 → 核验后合并；
3. 有「可合并」未批准 → 等用户/提醒；
4. 版本已合并未发 → 准备发版；
5. 发布后未核对 → 安装核对 / 市场。

纯客户端按现有快照 + approvals 排序，每项带一个跳转或「唤醒主会话」按钮；没有事项时显示「暂无待办」。

### D. 「待你批」收件箱（P2，中）

把任务审批、问答、交接确认、合并批准、发版批准聚合成一个用户视角的清单（顶栏角标 + 一页），先做只读聚合，再逐项接动作。合并批准（A）先落地，再做统一入口。

### E. 流程页（Runbook）（P2，小-中）

设置或「更多」里放主会话 / 工作会话 / 发版三段步骤（摘要自 `docs/coordination-playbook.md`），可本地勾选进度，带「打开手册」「复制给会话」；仅前端，不改服务端。

## 5. 建议顺序

- **2.4.3**：A（合并批准 + 流水线）+ C（下一步卡）已实现；B（发布状态卡）也一并放进本轮（设置页「发布」区，gh 只读 + 失败兜底）。
- 视反馈再做 D / E。

## 6. 验收

- 用户能在看板批准合并，主会话收到通知后合并；批准记录在卡片与版本线上一致，sha 变化后旧批准失效。
- 发布卡显示的 tag / Release / 附件 sha 与 GitHub 实际一致；卡上没有任何会直接推送的按钮。
- 主会话下一步卡顺序符合当天实际状态（提问 > 已批准合并 > 可合并 > 发版 > 发布后），空状态明确。
- 用户审批入口最多两步可达；KIT / 测试 / 文案同步更新。

## 7. 开放问题

- 合并批准要不要落成“邮箱通知 + 唤醒”还是“写进汇报板”？建议前者（可追溯、不改变主会话状态机）。
- 发布卡的数据源是否包含市场 PR（要读 awesome-dsh-plugin 的 gh 状态，可能慢）；建议先只读本仓库。
- 批准记录保留多久？建议跟随工作区数据，合并/发布后保留 30 天，过期清理。

## 8. 实现（T14，2.4.3 未发布）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 批准数据 | `lib/core.js` `CoordStore` | `groups.<工作区>.approvals = { <sessionId>: { status, sha, at, by: 'user', reason? } }`；30 天过期、最多 200 条；看板快照带 `approval` 视图。 |
| 批准动作 | `lib/impl.js` `mergeDecision()` + `lib/settings-route.js` | `merge-approve` / `merge-later` / `merge-reject` 用户动作：只写协调状态 + 投递用户消息；不跑 git、不改声明。sha 绑定与幂等在这里判。 |
| 发布事实 | `lib/release.js` + `lib/impl.js` `releaseView()` | 版本推进 / 阶段条 / 清单命令是纯函数；git、package.json、`dist/*.tgz`、`gh release view` 在 impl 读，60 秒缓存，失败写「未知」。路由 `GET ?view=release`。 |
| 面板 | `lib/client.panel.js` | 概览首块「下一步」卡；可合并卡流水线 + 批准 / 稍后 / 打回；主会话卡合并摘要。`PANEL_KIT 9`。 |
| 侧栏 | `lib/client.sidebar.sessions42.js` / `client.sidebar.settings42.js` | 会话卡流水线与批准动作、主会话行计数；设置页「发布」卡。`SIDEBAR_KIT 42`（外壳 + 全部 chunk 同步改名）。 |

**边界**：面板没有 push / merge / tag / Release / install 入口；「已合入 / 已发布」只从提交事实和只读 tag / Release 事实推，读不到就写未知。批准记录不等于用户对推送 / 发布的授权；主会话仍需用户在当前会话明确同意后才执行。

## 9. 票子驾驶舱与内置技能（T15，2.4.4）

目标：把「票子 → 拉起会话 → 回填持有者 / 分支 / 工作树 → 阶段与判定」搬进任务 / 地图票详情，技能随插件包提供，不要求用户手装或仓库里放副本。

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 内置技能 | `bundled-skills/` + `lib/bundled-skills.js` + `lib/index.js` | 随包三个技能（relay-main / relay-worker / relay-release）；`ctx.inject(['skills'])` 注册 provider，rank 600，项目 `.dsh/skills` 同名仍优先；没有 skills 服务时安静降级。`package.json` files 包含 bundled-skills。 |
| 技能目录视图 | `impl.ticketSkills()` + 看板 `taskBoard.skills` | 读内置目录 + 项目 `.dsh/skills`（60 秒缓存）；角色默认 main→relay-main / worker→relay-worker / release→relay-release；技能不存在时由 gates 说明。 |
| 判定 gates | `lib/ticket-cockpit.js` `ticketGates()` + `impl.board()` | 每票返回依赖（未结束项）、持有者（live / stale / dead / unknown）、stage 是否允许、approval、技能是否存在、合并批准 sha、Release tag；`launch` / `wake` 各自给 allowed + reason。 |
| 详情动作区 | `client.sidebar.shared44.js` `TicketCockpit` | 任务页与地图票详情共用：holder / 分支 / 工作树 / 最近汇报、判定胶囊、阶段按钮（待分诊 / 可认领 / 进行中 / 待审查）、审批、拉起表单（别称 / 技能 / 模型）。禁用按钮显示原因。 |
| 拉起即填充 | `impl.launchTicket()` + `launchClaimer()` + `claimTicketAtLaunch()` | 用户动作 `ticket-launch`：按 gates 复核后建会话，首条消息带票子完整字段 + 「先加载 <skill> 技能」；锁内登记认领（owner=新会话）、写分支 / 工作树 / stage=doing / launch 记录。 |
| 阶段动作 | `impl.setTicketStage()` + `settings-route` `ticket-stage` | 只写本地 stage（review 自动 pending 审批）；不跑 git、不写 GitHub。 |
| 合并 / 版本事实（T19） | `impl.ticketCommitLocations()` + `ticketGates` | 合并按 holder 会话的合并流水线事实（origin 已合入 / 本地已合入 · 待推送 / 已批准 / 可合并 / 已发布）；版本用 `releaseSummary.nextTag`，只有已发布才显示实际 tag；任务审批与合并分两行。 |
| 任务页展开（T19） | `client.sidebar.tasks47.js` | 已结束默认露 8 条，尾部「还有 N 条，点开展开」是可点按钮；可接 / 进行中与服务端截断同样可点。 |

**边界**：拉起只创建会话并回填认领；不 push、不合并、不打 tag、不发 Release、不安装。UI 的「批准」动作仍只记录并通知主会话。旧快照没有 `gates` 时客户端安静跳过驾驶舱，不崩。


## 10. PR 多状态审核（T16，2.4.4 未发布）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 状态机 | `lib/prreview.js` | `PR_REVIEW_ORDER` / `PR_REVIEW_STATE` + `prReviewState()`；11 态、优先级链、未知 / stale / 草稿边界，不猜。 |
| 本地记录 | `lib/prreview.js` `PrReviewStore` | `pr-reviews.json` 按 repo#PR 存多轮记录（最近 10 轮）、忽略 / 拒绝标记、AI 审核会话（含 checkedAt / noVerdict）；head 变化即 stale。 |
| 数据 | `lib/githublists.js` + `lib/taskpr.js` | PR 列表 / 详情补 state / mergeStateStatus / reviewRequests / latestReviews / statusCheckRollup / headRefOid；任务 PR 补 commits 最新提交时间。 |
| 用户动作 | `impl.prReviewRecord()` / `impl.prFlag()` + `settings-route` | `pr-review-record` / `pr-flag` 只由用户点：记录结论（绑定当前 head）、忽略 / 拒绝（可取消），写本地 + `pr-review-audit.jsonl`。 |
| AI 自动闭环 | `impl.prReviewLocal()` / `readAiConclusion()` + `lib/prreview.js` `parseReviewConclusion()` | 拉起后强刷 + 乐观「审批中」；会话结束只读日志解析 `【审核结论】` / `【结论原因】`，自动写 `source:'ai'` 记录（幂等，清 aiReview）；解析不到标 noVerdict 并提示手动记录。 |
| 列表 / 图例 | `client.sidebar.prs44.js` | 11 态 chip + 筛选计数（优先级链）+ 状态图例 + 行内原因 / 轮次 / head。 |
| 详情 | `client.sidebar.prs44.js` `PrDetail` | 状态 / 原因 / 轮次 / head / 本地多轮记录 / AI 会话链接；动作区记录结论、忽略 / 拒绝。 |

**边界**：UI 不写 GitHub、不合并、不推送；结论与忽略 / 拒绝只在本机生效。旧快照没有 `review` 字段时保留原胶囊与筛选。


## 11. 嵌入面板工作区切换（T20，2.4.5 未发布）

目标：对话里的「协作」标签与左侧「会话监督」面板可以切到侧栏登记的任一工作区看只读监督数据；默认「跟随当前会话」，切走后不把当前会话视角混进别的看板。右侧边栏「无会话视角」与设置页原有的工作区选择保持不变。

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 视图范围 | `client.sidebar48.js` `boardQuery()` / `boardCacheKey()` | 跟随会话时仍是 `{ view:'board', session }`（与旧版完全一致）；跨工作区时 `{ view:'board', workspace }`，不夹带 session。看板缓存按「会话 / workspace:<id>」分开存，切来切回不串数据。 |
| 下拉 | `client.sidebar48.js` `RelaySidebar` 顶栏 | 仅嵌入面板（`embedded === true`）且已登记工作区 >1 时出现；首项「跟随当前会话 · <本工作区>」，`registered: false` 不出现；跨工作区显示「正在查看其他工作区：只读」提示。 |
| 本机记忆 | `usePersisted`（`dshaSv.ui.v1`） | 键 = `persistPrefix`（`embed-tab:` / `embed-panel:`）+ `viewWs.<会话 id 后缀>`；嵌入上下文 / 会话之间互不覆盖，也不读写无会话侧栏与设置页的 `dshaSr.workspace.v1`。 |
| 安全回退 | `RelaySidebar` effect | 记住的工作区已删除 / 未登记，或已登记工作区只剩一个 → 清掉选择、回到跟随会话；旧服务端没有 `workspaces` 字段时不显示下拉、不报错，照旧按会话取数。 |
| 只读边界 | `RelaySidebar` act 包装 + `LegacyBoardPage` `readOnly` | 跨工作区时写动作（回复、设 / 清主会话、认领 / 拉起 / 接手、退出协作、改版本线、邮箱已读 / 归档等）不发请求并说明原因；只读动作正常。概览 / 搜索额外页签通过 `workspaceId` + `readOnly` 跟随同一次选择。 |
| 只读视图数据 | `impl.viewWorkspace()` + `prListView` / `prDetailView` / `issueListView` / `railCounts` | 显式 `workspaceId` 优先，未登记报 `no_workspace`；不传时仍按 `fromSession` 解析。路由 `GET ?view=…&workspace=<id>` 透传；不带该参数的老调用不变。 |

**边界**：跨工作区是只读监督视角，不提供任何会改动会话或工作区的入口；切回「跟随当前会话」才恢复写动作。不 push、不合并、不 tag、不 Release、不安装。
