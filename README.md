# dsh-session-relay

DeepSeek Harness（DSHA）平级会话互通插件：一个主会话协调多个工作会话，提供版本线公告、指令模板、汇报合并唤醒、任务看板核对、会话检查与主会话交接。

## English

A DeepSeek Harness plugin for coordinating several root sessions. One session is the main (coordinator) session; others report to it with `peer_report`, and reports are batched into a single wake-up. It adds a `/relay` command, 14 `peer_*` model tools, a version-line notice every worker sees, a `.agents/TASKS.md` task board with claims, main-session handoff and session wake/takeover, read-only session inspection and search, and a web panel. Subagent reports are filed separately and never change the parent session's status. Phone notifications use the DSHA device bridge and are unavailable elsewhere. Run `/relay help` for the full command reference.

## 功能

- `/relay` 命令：新建 / 打开会话、指派编号、群发指令、版本线、模板、接手与唤醒、主会话交接、任务看板（`/relay tasks`）、会话检查与搜索（`/relay inspect`、`/relay search`）。完整用法见 `/relay help`。
- 任务看板写操作：`/relay task new|claim|takeover|handoff|release|done|abandon|update`（模型用 `peer_task`），加锁写 `.agents/TASKS.md` 与 claims，格式同看板认领规则。
- 模型工具（14 个）：`peer_list`、`peer_report`、`peer_send`、`peer_spawn`、`peer_alias`、`peer_inspect`、`peer_tasks`、`peer_task`，主会话另有 `peer_line`、`peer_assign`、`peer_workspace`、`peer_handoff`、`peer_ask_user`、`peer_watch`。
- 协作面板（Web 客户端）：看板、交接预览、会话唤醒、等你决定的提问、自动置顶、开发者模式开关。
- 开发者模式（`/relay dev on [小时]`，默认关闭、限时、记审计）：模型可只读查看所有工作区的会话。
- 维护文档：[设计、已知坑与审阅边界](docs/maintenance-guide.md)。

## 运行环境

- DeepSeek Harness，插件依赖的 `@deepseek-ai/dsh-*` 包由宿主提供，不单独安装。
- 部分功能（设备桥）读取 DSHA 容器内的 `/root/.dsh/.bridge_headers` 与 `/root/.dsh/.bridge_port`，非 DSHA 环境下这些功能不可用。

## 安装

不需要 npm 账号。在 DSHA 的插件管理器里任选一种来源：

- **GitHub Release（推荐，固定版本）**：仓库 `SunsetRNE/dsh-session-relay` 的 Release，每个版本附一个 `dsh-session-relay-<版本>.tgz`。最新版本见 [Releases](https://github.com/SunsetRNE/dsh-session-relay/releases)。
- **仓库链接**：`https://github.com/SunsetRNE/dsh-session-relay` 装 main 最新提交；指定版本用 `https://github.com/SunsetRNE/dsh-session-relay/tree/v<版本>`。
- **本地压缩包**：下载 Release 附件后导入。

## 开发

```sh
# 测试需要宿主的 node_modules，本地软链即可（已在 .gitignore 中忽略）
ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules node_modules
npm test
```

加载方式：`lib/index.js` 是外壳，逻辑在 `lib/impl.js` 及其依赖里。改实现文件后 `/relay reload` 即可生效；`lib/client.js`（面板）改动由宿主热更新，刷新即见；改 `lib/index.js`、`package.json` 的 `dsh` 字段或 `cordis.patch.yml` 需要重启 DSH。

## 打包

```sh
npm pack
```

生成 `dsh-session-relay-<版本>.tgz`，内容由 `package.json` 的 `files` 字段决定。

## 发版

不发布到 npm，发到 GitHub Release（`gh` 已登录即可，手机容器里也能做）：

```sh
npm test
npm pack --pack-destination dist
git tag v<版本> && git push origin v<版本>
gh release create v<版本> dist/dsh-session-relay-<版本>.tgz --title v<版本> --notes-file <说明文件>
```

每个 Release 只挂一个 `.tgz`：插件管理器按 Release 安装时只认唯一一个压缩包附件。

DSHA 容器里的 `gh` 是 Go 程序，看不到 Ubuntu 的文件、也起不了 git。容器里的包装脚本 `/usr/local/bin/gh`（2026-11-04 起）会自动补 `-R`（从 `git remote` 读）并把文件参数改成宿主机路径，上面几条直接能用。需要 gh 自己调 git 的命令（`gh pr checkout`、`gh repo clone`）仍不可用。旧包装脚本没有这两项时：手动加 `-R SunsetRNE/dsh-session-relay`，文件写 `/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu/root/...`。

## 许可

MIT
