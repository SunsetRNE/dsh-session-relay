# 工作项共用 UI / 懒加载（P1a 共用层 + P1b 按页签拆 chunk）

状态：T12 P1a 设计稿（未实现）；P1b 只做设计，不落地。
基线：分支 `ui-longtext`，`SIDEBAR_KIT 37 / PANEL_KIT 8`。约束：不改服务端、不写 GitHub、右栏与嵌入面板共用同一套组件。

## 1. 目标

对齐地图票 / 子票、issue、PR 三类"工作项"的展示与交互：同一套状态胶囊、字段行、详情外壳；点开才拉详情（hover 预取、in-flight 去重、abort、短 TTL 缓存）；跨页 `openWorkItem({ kind, id })` 直接切到对应页签并打开详情。

## 2. 共用件（放 `client.sidebar.js`，经 `export` 给同一 chunk 内各页使用）

### 2.1 `WorkItemChips({ kit, item })`

纯展示，无请求。字段映射：

| 字段 | 来源 | 渲染 |
| --- | --- | --- |
| kind | `item.kind`（map/issue/pr） | `dshaSv_pill`（标签） |
| 状态 | map: `kind/stage/approval`；issue: `state`；PR: `draft/merged/reviewDecision` | 状态胶囊（`data-tone` ok/warn/error/中性） |
| owner | `owner/ownerLabel`、`author`、`assignees` | `dshaSv_metaChip`（mono，title 全文） |
| 分支/提交 | `branch`、`commit` | `dshaSv_metaChip`（mono，7/8 位） |
| issue/PR | `issue`、`pr.number/url` | `dshaSv_pill` + 外链图标；有 url 才出链接 |

长文本一律两行截断 + `title` 悬停；chip 数超过 6 个时收成 `+N`。

### 2.2 `useLazyDetail({ kit, key, params, ttlMs = 60_000, enabled = true })`

返回 `{ data, error, loading, open, prefetch, invalidate }`。

- 模块级 `inflight = new Map<key, Promise>`：同 key 并发只发一份；后到调用复用同一 Promise。
- 模块级 `cache = new Map<key, { at, value }>`：`Date.now() - at < ttlMs` 直接用；`invalidate(key)` 由写操作（PR 审批/评论/关闭重开）调用。
- `open()` 立即拉（有缓存则先用缓存再后台刷新）；`prefetch()` 只在 hover/focus 时调用，不改变 UI loading。
- 每次请求带 `AbortController`；组件卸载 / key 变化 / `close()` 时 abort，不影响其它复用同一 Promise 的调用方（共享 Promise 不绑定单方 signal，调用方用 alive 标记过滤结果）。
- 数据形状统一为 `{ kind, id, chips, fields, actions, body }`，各 kind 自己映射；P1a 的 issue 详情先用列表字段 + 外链，评论留 `comments: null` 槽位给 P2。

### 2.3 `WorkItemDetail({ kit, open, chips, fields, body, actions, onClose })`

- 覆盖层：`position:fixed; inset:auto 0 0 0` 抽屉（移动端友好），或宽栏右侧面板内浮层；`z-index` 高于侧栏、低于 DSH 原生模态。
- 头部：`WorkItemChips` + 关闭按钮；正文 `dshaSv_stack`（字段行 = label + 胶囊/等宽芯片）+ 可选自定义 body（PR 文件改动/评论、map 子票列表）。
- 动作区固定在底部（`dshaSv_taskActs`）；ESC / 点遮罩关闭；打开时记录触发元素，关闭后还原焦点。
- 右栏与嵌入面板同一组件：嵌入面板内浮层相对面板视口定位（用 `position:fixed` + 现有侧栏 z-index 即可，不做 portal）。

## 3. 各页接入

- **MapTab**：票卡/子票卡整卡可点 → `WorkItemDetail`（依赖、子票、issue 链接、阶段/审批）；保留「拆分子任务」表单与父子分级。数据来自现有 `board.taskBoard.map`，不需要新请求。
- **IssueTab**：行末「详情」→ `WorkItemDetail`（编号/标题/作者/标签/指派/更新时间 + GitHub 外链）；字段来自 `issue-list`，P2 再补评论（`useLazyDetail` 的 `issue-detail` 视图预留）。
- **PrTab**：`详情` 不再内联展开，改为打开 `WorkItemDetail` 外壳，外壳 body 复用现有 `PrDetail`；审批 / 请求修改 / 评论 / 关闭重开 / AI 审核动作与二次确认原样保留；hover 行或「详情」时 `prefetch({ view:'pr-detail', ... })`（现有 5 分钟缓存保留）。
- **跨页 `openWorkItem({ kind, id })`**：`RelaySidebar` 持有 `workItem` state；对 map/prs/issues 设 `focus` prop（`{ kind, id }`），目标页在挂载 / `focus` 变化时打开对应详情并清空 focus。任务页暂不接入（P1a 只跑通三类工作项）。
- 现有独立 URL/数据视图不变；P1a 不新增服务端路由。

## 4. P1b：按页签拆 chunk（只设计，不实现）

现状：`client.sidebar.js` 单 chunk（约 3400 行），一次下载全部页签。目标：首次打开只拉外壳 + 当前页签。

建议拆法（同一 `SIDEBAR_KIT`，每个 chunk 自带 `KIT_VERSION` 并在 `require.async` 后校验）：

```
client.sidebar.js       外壳：TABS/TabBar/RelaySidebar/useBoard/共用件(WorkItemChips/Detail/useLazyDetail)
client.sidebar.shared.js 可再拆：仅共用件；外壳首次加载即拉
client.sidebar.sessions.js
client.sidebar.tasks.js
client.sidebar.handoff.js
client.sidebar.map.js      （+分支/问题可各自 chunk 或合并在 pages2）
client.sidebar.prs.js
client.sidebar.branches.js
client.sidebar.issues.js
client.sidebar.mail.js
client.sidebar.more.js
client.sidebar.settings.js
```

- 加载顺序：外壳先渲染 TabBar 与当前页签的 skeleton；`require.async('./client.sidebar.<tab>.js')` 按需拉取；未访问页签不拉。`seen` 机制沿用，但卸载/回退可释放大 chunk（可选）。
- KIT：外壳与 chunk 各自 `KIT_VERSION`，任何共享 kit 字段变化 → `SIDEBAR_KIT` +1 且所有 chunk 一起 bump；入口 `client.js` touch 一行。chunk 不匹配显示现有 stale 提示（附实际/期望版本）。
- 热更新：DSH reload 后新 chunk 地址带 `?v=<KIT>`（或文件名 hash），避免浏览器缓存旧 chunk；整页刷新兜底提示沿用。本地开发时 `require.async` 失败回退外壳内联的最小加载失败行。
- 预取策略：hover 页签按钮 200ms 后 prefetch 对应 chunk；受 `navigator.connection.saveData` 抑制；嵌入面板与右栏共用同一 chunk 缓存（同一模块加载器）。
- 风险：`useBoard` 仍在外壳（所有页签共用）；`MailTab`/`MoreTab` 与设置页共用 `useRemoteList`，需要先抽 `client.sidebar.shared.js` 再拆页。
- 验收：`node --test` 覆盖入口 stale、按需加载顺序、右栏/嵌入同 chunk 复用；真机点 11 页签首次打开耗时对比。

## 5. 测试计划（P1a）

- chips 映射：map（阶段/审批/依赖）、issue（标签/指派/外链）、PR（草稿/评审结论）。
- `useLazyDetail`：打开才拉、hover 预取、同 key 并发去重、abort、TTL 过期重拉、invalidate。
- 详情外壳：开/关、ESC、action 回调、长字段两行截断。
- 跨页：`openWorkItem` 切页签并打开详情；关闭后回到原列表。
- 回归：`node --test --test-concurrency=1 test/*.test.js`（425 起）；右栏 9 页签与嵌入 11 页签 tab 行为不变。

## 6. 交付顺序

1. `WorkItemChips` + `WorkItemDetail` + CSS（纯展示，先接 issue 行，风险最小）。
2. `useLazyDetail`（先把 PR hover 预取接上，行为不变）。
3. MapTab / IssueTab 详情；PrTab 改共用外壳并回归审批/评论/关闭。
4. `openWorkItem` 跨页；测试与文档。
5. P1b 拆 chunk 另起任务，本轮不实现。
