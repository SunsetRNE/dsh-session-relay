# dsh-session-relay

DeepSeek Harness（DSHA）平级会话互通插件：一个主会话协调多个工作会话，提供版本线公告、指令模板、汇报合并唤醒、任务看板核对、会话检查与主会话交接。

## English

A DeepSeek Harness plugin for coordinating several root sessions. One session is the main (coordinator) session; others report to it with `peer_report`, and reports are batched into a single wake-up. Version 2.0 adds a four-tab sidebar (sessions / tasks / handoff / activity), local task stages and approvals, one-way GitHub issue projection (off by default), PR / Projects read-only links and Status write-back, command templates and full-text search. It adds a `/relay` command, 14 `peer_*` model tools, a notification mailbox (public notices land in a per-workspace mailbox; notices are batched per session within 5 minutes, and `/relay mail` lists/reads/archives them with a 7-day token ledger), `peer_send mode=interrupt` (main-only nudge), a version-line notice every worker sees, a `.agents/TASKS.md` task board with claims, main-session handoff and session wake/takeover, read-only session inspection and search, and a web panel. Subagent reports are filed separately and never change the parent session's status. Phone notifications use the DSHA device bridge and are unavailable elsewhere. Run `/relay help` for the full command reference.

## 功能

- `/relay` 命令：新建 / 打开会话、指派编号、群发指令、版本线、模板（`/relay tpl`）、接手与唤醒、主会话交接、任务看板（`/relay tasks`、`/relay task update --stage`、`/relay approve|reject`）、会话检查与全文搜索（`/relay inspect`、`/relay search`）、GitHub（`/relay repo`、`/relay sync`、`/relay task pr`）。完整用法见 `/relay help`。
- 任务看板写操作：`/relay task new|claim|takeover|handoff|release|done|abandon|update`（模型用 `peer_task`），加锁写 `.agents/TASKS.md` 与 claims，格式同看板认领规则。
- 任务派发（1.9）：`peer_task action=split` 拆父子任务（可串行依赖），`action=dispatch` 按任务/子树唤醒持有者或拉起新会话，依赖未完成不派；父任务在子任务全结束后自动完成。
- 任务看板（1.8）：任务与认领的事实源在插件数据目录（`tasks/<工作区>/`），仓库里的 `.agents/TASKS.md` / `claims/` 是只读导出快照；终态任务自动归档。
- 任务库维护（1.10）：`/relay task import --force` 把手改过的导出快照重新导入（覆盖前备份），`/relay task export` 随时重导出快照；活动库超过 `taskStoreMaxActive`（默认 500）先归档最老的终态任务，`TASKS-archive.md` 超过 `taskArchiveMaxBytes`（默认 1 MiB）把最老的整段移入 `tasks-archive.jsonl` 冷存。
- 模型工具（14 个）：`peer_list`、`peer_report`、`peer_send`、`peer_spawn`、`peer_alias`、`peer_inspect`、`peer_tasks`、`peer_task`、`peer_mail`，主会话另有 `peer_line`、`peer_assign`、`peer_handoff`、`peer_ask_user`、`peer_watch`。`peer_send` 的 `mode=interrupt`（主会话专用，`stop:true` 用「停止并汇报」信封）取代了 1.4.0 的独立工具 `peer_interrupt`。`peer_list` 默认只列本工作区（`scope=workspace`）；`scope=host` 看本机全部会话需要开发者模式（只读、审计）；主会话用 `declarations=true` 对照工作树声明（原 `peer_workspace` 已并入）。DSH 侧栏归档的会话在工具面按归档处理：`peer_list` 不列，`peer_inspect` / 工作区搜索默认拒绝或跳过，`peer_send` 明确报已归档；要读加 `include_archived=true`。
- 协作邮箱（1.5.0）：核验成功这类公共通知只写进工作区邮箱（插件数据目录 `mailbox.json`），同一会话 5 分钟窗口内的多条通知合并成一条短通知（带最新 id）；需要细节时用 `peer_mail` read，主会话可用 `send`/`force` 推送。用户可用 `/relay mail` 看未读、读全文、归档和查看最近 7 天「短通知 / 全文」统计。失败/超时仍直接送达并响手机。
- 协作面板（Web 客户端）：看板、交接预览、会话唤醒、等你决定的提问、自动置顶、开发者模式开关。
- 右侧边栏「协作」标签（懒加载）：首屏先拉轻量快照，任务看板 / 声明 / 仓库 / 同步等重字段后台补水；之后轮询只拉轻量并合并保留重字段，完整快照在首次 / 5 分钟 / 手动刷新 / 写操作后补一次。正文是 4 个主页签「会话 / 任务 / 交接 / 动态」（视觉参考 [Deck](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)（MIT）的 chip 页签、状态胶囊与列表行），只挂载看过的页签；会话页是本工作区的主会话、版本线、筛选与看板卡片，交接页是起草 / 二次确认 / 历史，动态页放邮箱、地图票卡（顶层任务与子任务，带 #issue、OPEN/CLOSED、阶段与依赖；可直接拆分子任务）、票子列表、关联 PR、仓库状态与同步（PR / 同步只在宽侧栏出现；仓库开关仍只在设置页）；任务页切过去 / 打开详情只补轻量任务板，不触发远端校验。顶栏只留工作区、GitHub 胶囊、刷新与 ⚙ 设置；设置页集中版本线、新建会话模型、常设授权、自动置顶、开发者模式、空闲重启、指令模板、GitHub 账号、仓库开关、同步与核验。
- 指令模板与全文搜索（2.0 T3）：`/relay tpl save|list|show|rm`（设置页同一份存储，可编辑 / 重命名 / 删除、复制用法，模板名小写校验、正文带字数）；`/relay search [--in|--re|--case|--kind|--tool|--turn|--limit] <内容>` 搜本工作区最近 25 个会话的原始日志，按会话分组显示命中并可打开。都只由用户操作。
- UI 基准线（`docs/ui-copy.md`）：全插件文案压缩、语义合并、边界提示独立；成功 / 进行中反馈用动画（脉冲 / 转圈 / ✓），错误仍用文字；数据变化只给变化的行 1.5s 高亮，`prefers-reduced-motion` 下关闭。
- 会话在哪个 checkout：卡片自动显示每个会话的目录、分支、是否在 git 工作树里、从哪个分支哪个提交分叉（worker 没汇报也能看到；官方「更改请求与工作树」新建的会话尤其需要）。只读，按目录缓存 60 秒。
- `/relay wt <会话> [--from <基分支|提交>] [--name <名字>]`：用官方工作树服务给会话建分支与新目录并切过去，不用手动 `git worktree add`；宿主没启用该功能时明确报错。
- 任务阶段与审批（2.0.0 R0）：本地 `stage`（待分诊/可认领/进行中/待审查/暂停/不做）与 `approval`，认领自动进入进行中；阶段只由用户或主会话改，审批只走用户命令 `/relay approve|reject`（模型无审批工具）。
- GitHub 仓库接入（2.0.0 R0）：`/relay repo` 只读探测 origin 仓库能力（issues / projects / 合并方式 / 分支保护 / sub-issues），仓库开关按 `owner/repo` 存、只由用户 `/relay repo on|off <开关>` 或协作面板「交接与核验 → GitHub 仓库」里点，模型没有写入口；开关改动写本地审计。实际远端写入见下面的 issue 投影 / Projects Status，默认关，只有用户打开并触发才写。
- 待收队列背压：每个会话待收消息到 8 条拒绝普通发送（steer 可插队）；≥4 条或最早 ≥5 分钟标落后、≥30 分钟标卡住。`peer_list`、看板和侧栏卡片都会显示「待收 N」，避免会话落后很久没人知道。
- 平级通知取走时限：`peer_send` 默认 3 分钟（`timeout` 可自定义 90s/5m/2h，10 秒–24 小时）；对方实际取走消息（DSH `user/message` 事件按 id 确认）时只销账，不再给发送方发回执消息（避免多唤醒一轮），对方回复也销账。消息一直排队、超过时限仍没被取走时，对方正在运行就由插件把原消息直接插进当前轮（不再提醒发送方）；对方不在运行或 `mode=queue` 才用插队消息提醒发送方，并给**强制通知**（`priority:"urgent"`）或撤回（`action=withdraw`）的下一步。明确不用回复的待命通知用 `expect_reply:false` / `/relay --no-reply`，不发回执也不超时。普通 followup 排队超过 60 秒仍未取走会自动升级为 steer。`peer_report question/blocked` 同样有回复时限；到期时主会话正在运行就自动把整批汇报插进当前轮，不在运行才提醒提问方。主会话收到汇报也只销账、不发消息。`/relay all` 会跳过待收落后/卡住的会话并在结果里列出。
- GitHub issue 投影（R1，本地为准）：`issues` 开关打开后，任务变化会单向投影成 GitHub issue（marker 幂等、unknown 退避重试、重启恢复）；`closeOnTerminal` 打开且合并已审批（或已放弃）才关票；`labelSync` 维护 `relay:*` 标签（缺失自动创建）；`mapIssues` 给父子任务建地图票/子票，sub-issues 不可用时降级为父票正文 tasklist。用户命令 `/relay sync status|flush|backfill|retry|detach|on|off`，模型没有写入口；右侧边栏任务区 / 设置页的同步行显示队列与链接票，并给用户动作按钮（立即同步、回填、暂停/恢复、失败重试、二次确认解除），不新增 gh 轮询。 `projectStatus` 开关打开时，任务详情按需读该任务 issue 的 GitHub Projects Status（只读、2 分钟缓存、不进轮询），并可在任务详情里点「写回 Projects」由用户写 Status（匹配不到选项不写，模型无入口）。默认关、不写 GitHub。
- 任务 PR 只读（2.0.0 R0）：`/relay task pr <任务号> <PR 号|URL>` 把任务关联到 PR，动态页也能点「关联 PR」填任务号 + PR 号 / URL（用户路由，同一份任务库），只读展示 state / 可合并性 / 审批决定 / checks；状态缓存在本地，2 分钟后查看自动刷新（`refresh` 强制、`clear` 解除）。只给号时按当前目录的 GitHub origin 推断仓库。relay 不代开 PR、不代合并，PR 状态不会自动改任务阶段/审批；模型没有关联入口。
- GitHub 账号：未登录时「动态」页显示登录卡（登录 / 设备验证码 / 补权限），顶栏账号胶囊只在已登录时出现，点开进「设置」页管理锁定与权限；登录权限分「基础 / 仓库管理 / 全部」三档，默认仓库管理，按档申请 scope；当前 scope 以小胶囊逐颗显示。换号或退出时胶囊标红、发一次通知，并暂停 relay 自己的 CI 核验。
- 开发者模式（`/relay dev on [小时]`，默认关闭、限时、记审计）：模型可只读查看所有工作区的会话。
- 截图：`screenshots.json` 里列了三张（右侧边栏「协作」标签、概览页的快速交接、新建会话时的模型选择），都是用演示工作区 `/root/relay-demo` 截的、已裁掉无关界面；换图推仓库即可，不用提 PR。
- 维护文档：[设计、已知坑与审阅边界](docs/maintenance-guide.md)；[发版清单](docs/release-checklist.md)；[上架 awesome-dsh-plugin 的公开约定](docs/awesome-dsh-plugin-submission.md)（条目格式、`dsh.bundle`、tarball 两种写法、peer 预发布陷阱、held 标签、本容器的 REST 配方）。

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

## 仓库守候（2.1.0 起，2.2.0 补完整可视化）

会话可以让插件只读盯一个 GitHub 仓库的 issue / PR：有新动态时，插件只在会话空闲时叫醒它，并把条目、目标与完成标准一起带进消息。

- 开启：直接对模型说「守候 owner/name」，或让它调用 `peer_repo_watch action=start repo=owner/name goal="处理这个仓库的 issue"`；同一会话同一仓库重复 start 是更新。
- 过滤：标签白名单 / 排除标签 / 作者白名单 / 仅指派 / 跳过已关闭 / 跳过草稿 / 跳过机器人；另有活跃时段、每小时唤醒上限、单次批量上限与观察模式。
- 收口：模型 `peer_repo_watch action=ack` 只做本机 ack；要让 GitHub 也留痕，由用户在「设置 → 仓库守候 → 触发」里点「在 GitHub 打 ack 标签」写 `relay:ack`。
- 诊断：`peer_repo_watch action=list` 会列出上次轮询 / 唤醒、延后原因、最近过滤原因与上次错误；侧栏「设置 → 仓库守候 → 判定」有同一份原因链。
- 可视化（2.2.0）：输入框左侧卫星环显示本会话守候的运行 / 观察 / 暂停 / 异常；设置 → 仓库守候分总览 / 判定 / 触发 / 设置四页签。
- 存量补报（2.2.0）：登记时可选 `backlogHours`（0–720，默认关），第一次成功轮询把最近 N 小时的存量报一次，之后只报新动态。
- 2.1.0 起只支持 GitHub；Gitee、自动隔离 worktree 仍在 2.2.0 后续。

## 右侧边栏（2.2.0）

- 9 个页签：会话 / 任务 / 交接 / 地图 / PR / 分支 / 问题 / 邮箱 / 更多；侧栏压到 620px 以下时，地图 / PR / 分支 / 问题 折进「更多」，以列表入口打开，邮箱保持独立。
- 地图：任务地图票子 + 本地票子；问题：远端 issue 列表（搜索 / 指派给我 / 标签筛选）；PR：远端 PR 列表（打开 / 已关闭、筛选与计数、点详情看评审与评论正文、长文折叠，标题可开 GitHub），审批 / 评论 / 关闭 / 重开只由用户点击，可把 PR 关联到本地任务；分支：全部登记工作区的本地 / 远端分支，删除逐条确认（远端要输入分支名，默认分支和当前分支不可删）。
- 邮箱：公共通知全文、标已读 / 归档；更多：同步队列、仓库探测；GitHub 账号与登录只在「设置」里。
- 模型没有 PR 审批 / 评论 / 分支删除的入口；推送、合并、发版仍由用户决定。

## 开发

```sh
# 测试需要宿主的 node_modules，本地软链即可（已在 .gitignore 中忽略）
ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules node_modules
npm test
```

`npm test` 已固定 `--test-concurrency=1`，必须串行跑；偶发 `ENOTEMPTY` 等环境错误先重跑一次并记录原因。

加载方式：`lib/index.js` 是外壳，逻辑在 `lib/impl.js` 及其依赖里。改实现文件后 `/relay reload` 即可生效；`lib/client.js`（面板）改动由宿主热更新，刷新即见；改 `lib/index.js`、`package.json` 的 `dsh` 字段或 `cordis.patch.yml` 需要重启 DSH。

面板缓存注意：只改 `lib/client.panel.js` 必须同步改一行 `lib/client.js` 并把 `PANEL_KIT` / `KIT_VERSION` 一起 +1；只改 `lib/client.sidebar.js` 也要同步改一行 `lib/client.js`，并把 `SIDEBAR_KIT` / `KIT_VERSION` 一起 +1。改过 `client.js` 本身后本机实测宿主会热更新，等一两秒或刷新即见（2026-11-07 DSH 进程未重启也生效）；只有宿主没开客户端热更新且刷新无效时才重启 DSH。

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

每个 Release 只挂一个 `.tgz`：插件管理器按 Release 安装时只认唯一一个压缩包附件。逐项走 [发版清单](docs/release-checklist.md)（测试、版本号、tag、Release 说明、市场条目、发版后核对）；2.1.0 的 Release 说明草稿在 [docs/release-notes-2.1.0.md](docs/release-notes-2.1.0.md)。

**已发布的 Release 和 tag 一律保留，永远不删、不改写**（用户 2026-11-06 定）：插件市场条目、别人的安装记录都可能钉在某个具体版本上，删掉或改写历史版本等于让那些安装直接断链。要修正内容就发新版本，不做撤回。

容器里 `gh` 需要 CA 兜底（DSH 0.2.2-rc.1 起 `DSHA_GH_HOST_ROOT` 指向的目录里没有 CA 包）：手动跑 gh 前先 `export DSHA_GH_CA=/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu/usr/local/share/dsha/ca-certificates.crt`；插件内部已自动兜底。

DSHA 容器里的 `gh` 是 Go 程序，看不到 Ubuntu 的文件、也起不了 git。容器里的包装脚本 `/usr/local/bin/gh`（2026-11-04 起）会自动补 `-R`（从 `git remote` 读）并把文件参数改成宿主机路径，上面几条直接能用。需要 gh 自己调 git 的命令（`gh pr checkout`、`gh repo clone`）仍不可用。旧包装脚本没有这两项时：手动加 `-R SunsetRNE/dsh-session-relay`，文件写 `/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu/root/...`。

## 许可

MIT
