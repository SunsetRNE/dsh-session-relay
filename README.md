# dsh-session-relay

DeepSeek Harness（DSHA）平级会话互通插件：一个主会话协调多个工作会话，提供版本线公告、指令模板、汇报合并唤醒、任务看板核对、会话检查与主会话交接。

## English

A DeepSeek Harness plugin for coordinating several root sessions. One session is the main (coordinator) session; others report to it with `peer_report`, and reports are batched into a single wake-up. It adds a `/relay` command, 14 `peer_*` model tools, a notification mailbox (public notices land in a per-workspace mailbox; notices are batched per session within 5 minutes, and `/relay mail` lists/reads/archives them with a 7-day token ledger), `peer_send mode=interrupt` (main-only nudge), a version-line notice every worker sees, a `.agents/TASKS.md` task board with claims, main-session handoff and session wake/takeover, read-only session inspection and search, and a web panel. Subagent reports are filed separately and never change the parent session's status. Phone notifications use the DSHA device bridge and are unavailable elsewhere. Run `/relay help` for the full command reference.

## 功能

- `/relay` 命令：新建 / 打开会话、指派编号、群发指令、版本线、模板、接手与唤醒、主会话交接、任务看板（`/relay tasks`）、会话检查与搜索（`/relay inspect`、`/relay search`）。完整用法见 `/relay help`。
- 任务看板写操作：`/relay task new|claim|takeover|handoff|release|done|abandon|update`（模型用 `peer_task`），加锁写 `.agents/TASKS.md` 与 claims，格式同看板认领规则。
- 任务派发（1.9）：`peer_task action=split` 拆父子任务（可串行依赖），`action=dispatch` 按任务/子树唤醒持有者或拉起新会话，依赖未完成不派；父任务在子任务全结束后自动完成。
- 任务看板（1.8）：任务与认领的事实源在插件数据目录（`tasks/<工作区>/`），仓库里的 `.agents/TASKS.md` / `claims/` 是只读导出快照；终态任务自动归档。
- 任务库维护（1.10）：`/relay task import --force` 把手改过的导出快照重新导入（覆盖前备份），`/relay task export` 随时重导出快照；活动库超过 `taskStoreMaxActive`（默认 500）先归档最老的终态任务，`TASKS-archive.md` 超过 `taskArchiveMaxBytes`（默认 1 MiB）把最老的整段移入 `tasks-archive.jsonl` 冷存。
- 模型工具（14 个）：`peer_list`、`peer_report`、`peer_send`、`peer_spawn`、`peer_alias`、`peer_inspect`、`peer_tasks`、`peer_task`、`peer_mail`，主会话另有 `peer_line`、`peer_assign`、`peer_handoff`、`peer_ask_user`、`peer_watch`。`peer_send` 的 `mode=interrupt`（主会话专用，`stop:true` 用「停止并汇报」信封）取代了 1.4.0 的独立工具 `peer_interrupt`。`peer_list` 默认只列本工作区（`scope=workspace`）；`scope=host` 看本机全部会话需要开发者模式（只读、审计）；主会话用 `declarations=true` 对照工作树声明（原 `peer_workspace` 已并入）。DSH 侧栏归档的会话在工具面按归档处理：`peer_list` 不列，`peer_inspect` / 工作区搜索默认拒绝或跳过，`peer_send` 明确报已归档；要读加 `include_archived=true`。
- 协作邮箱（1.5.0）：核验成功这类公共通知只写进工作区邮箱（插件数据目录 `mailbox.json`），同一会话 5 分钟窗口内的多条通知合并成一条短通知（带最新 id）；需要细节时用 `peer_mail` read，主会话可用 `send`/`force` 推送。用户可用 `/relay mail` 看未读、读全文、归档和查看最近 7 天「短通知 / 全文」统计。失败/超时仍直接送达并响手机。
- 协作面板（Web 客户端）：看板、交接预览、会话唤醒、等你决定的提问、自动置顶、开发者模式开关。
- 右侧边栏「协作」标签：本工作区的主会话、版本线、看板卡片（按分组筛选、点开看详情）和任务看板（可接 / 进行中 / 已结束分组，点开看持有者、工作树与动作）；正文第一次打开标签才加载，只在标签可见时刷新。
- 会话在哪个 checkout：卡片自动显示每个会话的目录、分支、是否在 git 工作树里、从哪个分支哪个提交分叉（worker 没汇报也能看到；官方「更改请求与工作树」新建的会话尤其需要）。只读，按目录缓存 60 秒。
- `/relay wt <会话> [--from <基分支|提交>] [--name <名字>]`：用官方工作树服务给会话建分支与新目录并切过去，不用手动 `git worktree add`；宿主没启用该功能时明确报错。
- GitHub 仓库接入（2.0.0 R0）：`/relay repo` 只读探测 origin 仓库能力（issues / projects / 合并方式 / 分支保护 / sub-issues），仓库开关按 `owner/repo` 存、只由用户 `/relay repo on|off <开关>` 改，模型没有写入口；当前只存本地、不写 GitHub（远端投影排 2.0.0 之后）。
- GitHub 账号：侧栏顶部账号胶囊点开就地登录卡（登录/补权限/锁定/解除锁定），设置页仍有完整账号面板；登录权限分「基础 / 仓库管理 / 全部」三档，默认仓库管理，按档申请 scope；当前 scope 以小胶囊逐颗显示。换号或退出时标红、发一次通知，并暂停 relay 自己的 CI 核验。
- 开发者模式（`/relay dev on [小时]`，默认关闭、限时、记审计）：模型可只读查看所有工作区的会话。
- 截图：`screenshots.json` 里列了三张（右侧边栏「协作」标签、概览页的快速交接、新建会话时的模型选择），都是用演示工作区 `/root/relay-demo` 截的、已裁掉无关界面；换图推仓库即可，不用提 PR。
- 维护文档：[设计、已知坑与审阅边界](docs/maintenance-guide.md)；[上架 awesome-dsh-plugin 的公开约定](docs/awesome-dsh-plugin-submission.md)（条目格式、`dsh.bundle`、tarball 两种写法、peer 预发布陷阱、held 标签、本容器的 REST 配方）。

## 为什么是平级会话，而不是团队 / 子代理

- 单个会话的上下文有限。实际项目里构建号到 300+ 时，一个会话同时背着版本线、看板、代码、测试和汇报，很快会到压缩边缘，早期约束和证据会丢。
- 平级会话每个都有自己的上下文窗口，可以分别承担「调查 / 分析 / 解决 / 验证 / 汇报」，主会话只保留版本线、看板结论和合并判断。
- DSH 的子代理由模型在会话内派生、挂在父会话的树里，用户不能从侧边栏手动拉起一个「帮我调查」的子代理；插件也不直接打开子代理（subagent routing 是宿主独占的）。
- 平级会话是用户可见、可点开、可唤醒 / 接手 / 改派的根会话：出问题能直接接管，做完留下可审计的汇报和提交；子代理随父会话的轮次结束就消失，不适合跨天、跨版本的长任务。
- 不绑定模型厂商：插件只依赖 DSH 的会话与工具接口，Claude、GPT、DeepSeek 等 DSH 能配置的模型都能当主会话或工作会话，也可以混用。

所以 relay 把协作做在根会话之间，而不是把子代理包装成任务板。

## 运行环境

- DeepSeek Harness **0.2.2-rc.1 及以上**（`package.json` 的 `engines.dsh` 与 `peerDependencies` 都是 `>=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-rc.1 <0.3.0-0 || >=0.2.4-rc.1 <0.3.0-0`；写成显式预发布分支是因为 node-semver 只放行「范围里有同元组且带预发布标签的比较符」的预发布版本，否则 0.2.3-rc.1 这类会被静默排除、安装时撞 ERESOLVE）。更老的宿主只保留基本功能：官方「更改请求与工作树」（forge）相关的工作树识别、声明外置等不再保证可用，插件会在声明视图里注明降级，也不再把旧版本作为兼容基准维护。
- 插件依赖的 `@deepseek-ai/dsh-*` 包由宿主提供，不单独安装。
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

**已发布的 Release 和 tag 一律保留，永远不删、不改写**（用户 2026-11-06 定）：插件市场条目、别人的安装记录都可能钉在某个具体版本上，删掉或改写历史版本等于让那些安装直接断链。要修正内容就发新版本，不做撤回。

容器里 `gh` 需要 CA 兜底（DSH 0.2.2-rc.1 起 `DSHA_GH_HOST_ROOT` 指向的目录里没有 CA 包）：手动跑 gh 前先 `export DSHA_GH_CA=/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu/usr/local/share/dsha/ca-certificates.crt`；插件内部已自动兜底。

DSHA 容器里的 `gh` 是 Go 程序，看不到 Ubuntu 的文件、也起不了 git。容器里的包装脚本 `/usr/local/bin/gh`（2026-11-04 起）会自动补 `-R`（从 `git remote` 读）并把文件参数改成宿主机路径，上面几条直接能用。需要 gh 自己调 git 的命令（`gh pr checkout`、`gh repo clone`）仍不可用。旧包装脚本没有这两项时：手动加 `-R SunsetRNE/dsh-session-relay`，文件写 `/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu/root/...`。

## 许可

MIT
