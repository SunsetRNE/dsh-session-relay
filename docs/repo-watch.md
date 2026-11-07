# 仓库守候（2.1.0 核心）

参考 dsh-session-superagent 的「盯仓库 → 空闲唤醒 → 按规则办事 → ack 收口」，2.1.0 只做核心：
只读轮询 GitHub issue/PR、过滤、空闲唤醒、观察模式、本机 ack 与可解释诊断。Gitee、自动隔离
worktree、卫星环与完整守候面板留到 2.2.0。

## 数据与文件

- 状态文件：插件数据目录 `repo-watches.json`（`RepoWatchStore`）；每会话每仓库一条，id 为
  `<owner/repo>#<sessionId>`。
- 轮询：默认 120 秒（60–3600），失败按 30s→1m→2m→5m→10m→30m 退避。
- 每条记录含：过滤配置、观察/开关、活跃时段、批量与每小时上限、seen 水位、lastReported 冷却、
  wakeTimes、lastPoll/lastWake/lastError、lastDeferred、filteredLog、history、lastBatch。

## 一次轮询

1. 活跃时段外 / 绑定会话不在 / 会话 running：只记 `lastDeferred`，不拉 API、不推进水位；
2. `gh api repos/<repo>/issues?state=all&sort=updated&direction=desc&per_page=50` 只读拉取；
3. 过滤：ack 标签吸收；已关闭 / 草稿 / 机器人 / 排除标签 / 标签白名单 / 作者名单 / 仅指派；
   被过滤的条目写 `filteredLog`（最多 8 条，可解释）；
4. 水位 + 冷却：`seen` 之前的跳过；冷却期内的更新 absorbed（推进水位但不唤醒）；
5. 没有 fresh 就结束；观察模式只记 history（reason=observe）；
6. 每小时上限到了记 `lastDeferred.reason=rate`；否则取批量前若干条，`followup` 唤醒；
7. 成功才推进 seen / lastReported / lastWake；失败不推进，留给下一轮。

## ack 与写边界

- 模型工具 `peer_repo_watch action=ack` 只做本机 ack（推进水位），不写 GitHub；
- 用户动作（侧栏卡片「在 GitHub 打 ack 标签」或用户路由 `repo-watch-ack`）才调用 gh 打
  `relay:ack` 标签；标签不存在时自动创建；
- 轮询与写标签前都走 `github.requireIdentity()`，锁定账号不符时拒绝。

## 工具

`peer_repo_watch`：`start`（repo、goal、intervalSec、labels、ignoreLabels、allowAuthors、
onlyAssigned、assignee、skipClosed、skipBots、skipDrafts、activeHours、ackLabel、batchLimit、
maxWakesPerHour、observe）、`update`、`stop`、`list`、`ack`、`check`。

## 已知边界（2.2.0）

- 只支持 GitHub；Gitee 明确拒绝；
- 不做自动 worktree 隔离，wake 消息只给规则与条目，处理仍在当前工作区；
- 没有卫星环与「总览 / 判定 / 触发 / 设置」完整面板，只有侧栏一张守候卡片。

## 2.2.0 完整可视化（已实现）

- **卫星环**：`conversation.composer.dock`（输入框左侧）。只显示本会话的守候；没有守候时不渲染。
  状态色：错误 > 限流延后 > 观察 > 运行 > 暂停；点开悬浮面板可 `检查` / `暂停恢复` / `打开完整面板`（打开侧栏设置里的仓库守候区块）。
  数据走 `view=watch-status&session=<id>`（按会话过滤的紧凑视图，20 秒刷新）。
- **设置区块**：右侧边栏「设置」→「仓库守候」，四个子页签：
  - 总览：状态、间隔、上次唤醒、最近批次、补报状态、快捷动作；
  - 判定：最近记录、过滤原因、延后原因、每小时用量、退避；
  - 触发：检查 / 暂停恢复 / 观察 / 本机 ack / 用户态 GitHub ack 标签 + 登记表单；
  - 设置：间隔、批量、每小时上限、活跃时段、ack 标签、补报小时数、过滤项、停止。
- **存量补报**：`backlogHours`（0–720，默认 0）。登记（或 update 显式传 >0）后第一次成功轮询，
  把最近 N 小时内更新、且不在水位里的条目当 fresh 报一次；忙 / 活跃时段外 / 限流 / 轮询失败保留待补，
  成功一次（唤醒、观察或无新条目）后消耗；唤醒消息首行带「首次补报」。
- 2.1.0 的侧栏「动态」守候卡片已移除；「动态」页更名为「更多」。
