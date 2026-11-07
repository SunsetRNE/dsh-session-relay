# dsh-session-relay 2.1.0

2.1.0：仓库守候（核心）。会话可以只读盯一个 GitHub 仓库的 issue/PR，有符合规则的新动态时，在会话空闲时被叫醒处理；支持观察、活跃时段、每小时上限、本机 ack 与可解释诊断。

## 亮点

- **仓库守候**：`peer_repo_watch` 工具登记；默认 120 秒轮询，标签/作者/指派/关闭/草稿/机器人过滤，活跃时段与每小时上限，观察模式；只读 gh，模型没有 GitHub 写入口。
- **空闲唤醒**：忙时只排队、不推进水位；唤醒消息带条目、URL、目标和完成标准。
- **收口**：模型本机 ack；用户在侧栏「仓库守候」卡片点「在 GitHub 打 ack 标签」才写 `relay:ack`。
- **诊断**：列表与卡片显示上次轮询/唤醒、延后原因、最近过滤原因、上次错误。
- **延后**：Gitee、自动隔离 worktree、卫星环与完整守候面板留给 2.2.0。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.1.0.tgz`。

## 升级

- 新增 `repo-watches.json`（插件数据目录），不影响旧任务库；
- 仓库守候默认不开，只有主动 `peer_repo_watch action=start` 才轮询；
- 2.0.0 的既有能力不变。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.1.0/CHANGELOG.md
- 设计：`docs/repo-watch.md`
