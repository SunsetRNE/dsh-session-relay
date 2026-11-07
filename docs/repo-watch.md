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
