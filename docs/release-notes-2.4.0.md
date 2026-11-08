# dsh-session-relay 2.4.0

2.4.0 把地图票 / 问题 / PR 三类工作项收进同一套展示与详情：共用状态胶囊、底部详情抽屉与懒加载（打开才拉、hover 预取、同 key 去重、60s 缓存）；嵌入协作面板扩到 11 页签（概览 / 全文搜索独立），页签细节与视觉向右侧边栏统一；侧栏远端列表与看板加载提速；`/relay drop` 支持原始 id 快路径（需 `/relay reload`）；剩余长文本面板继续结构化。串行测试 435 全过。

## 亮点

- **工作项共用详情（P1a）**：`WorkItemChips` / `WorkItemDetail` / `useLazyDetail` 在右侧边栏与嵌入面板共用；地图票 / 子票、问题、PR 都能打开同一套底部抽屉（标题 + 胶囊 + 字段行 + 正文 / 动作槽），关闭按钮 / ESC / 点遮罩都能关，关闭后焦点回到触发元素。
- **详情懒加载**：打开才拉、hover / focus 预取、同 key 并发去重、最后一个调用方释放时 abort、60s 短 TTL；PR 详情与列表 hover 共用缓存，审批 / 评论 / 关闭重开 / AI 审核后清缓存重新拉，不会显示旧状态。
- **跨页与行点击**：`openWorkItem({ kind, id })` 在同一边栏切到地图 / 问题 / PR 并打开目标；问题行点标题 / 摘要 / 空白都能开详情，PR 行空白也能开；行内链接与按钮不误触。任务页只切页签。
- **嵌入面板 11 页签**：概览 / 全文搜索成为独立页签（不再收进「更多」），页签不挤压、横向滚动并给提示，概览页签带 attention 计数；右侧边栏仍 9 页签；嵌入面板 max-width 1080px 居中，视觉与右栏统一。
- **性能与快路径**：侧栏远端列表 5 分钟缓存、并发请求合并、详情悬停预取；kit 引用稳定、只订阅主会话 id、挂载不重复拉取、并发去重；`/relay drop` 原始 id / 短前缀不再 list 全部会话（完整 `session-<uuid>` 也可直接用）。
- **长文本继续结构化**：PR / issue 评论、任务 note、版本线预览、设置说明改结构化行 / 胶囊 / 两行截断。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.4.0.tgz`。

## 升级

- 从 2.3.0 覆盖安装；本次含服务端改动（`/relay drop` 快路径），装好后 `/relay reload`，再整页刷新（侧栏 `SIDEBAR_KIT 38`；`PANEL_KIT 8` 未变，`client.panel.js` 未改）。
- 右侧边栏仍 9 页签；左栏 / 对话「协作」嵌入面板 11 页签；工作项详情是底部抽屉。
- 任务库、邮箱、仓库守候数据沿用 2.3.0 格式，无需迁移。
- 已发布的 2.3.0 tag / Release 保持只读。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.4.0/CHANGELOG.md
- P1a / P1b 设计：`docs/workitem-ui-p1.md`
- 维护与已知坑：`docs/maintenance-guide.md`
