# dsh-session-relay 2.0.0

2.0.0：右侧边栏 4 页签 + Deck 视觉；任务看板接入本地阶段 / 审批与 GitHub（issue 单向投影、同步队列、PR 只读、Projects Status 写回）；新增指令模板与全文搜索；全插件文案与反馈按 UI 基准线统一。

## 亮点

- **右侧边栏**：会话 / 任务 / 交接 / 动态 4 个主页签；首屏只拉轻量快照，重字段后台补水；任务页只补轻量任务板，切页 / 开详情不再闪烁；动态页地图按父 / 子任务树展示（阶段、依赖、issue 号）。设置页集中版本线、模型、常设授权、自动置顶、开发者模式、空闲重启、模板与 GitHub。
- **任务看板**：可接 / 进行中 / 已结束分组与详情；本地 `stage` / `approval`，`/relay approve|reject` 记录审批（只有用户能批）；任务可关联 PR（只读）；宽屏左右主从。
- **GitHub（默认关，只由用户操作）**：`/relay repo` 只读探测仓库能力；`issues` 开关打开后任务变化单向投影成 issue（marker 幂等、unknown 退避、重启恢复）；`closeOnTerminal` / `labelSync` / `mapIssues`；同步队列可立即同步 / 回填 / 暂停 / 重试 / 解除；Projects Status 可写回（只写 Status，不关票不合并）。
- **协作**：指令模板 `/relay tpl`（设置页同一份存储，可编辑 / 重命名 / 删除）；全文搜索 `/relay search` 搜本工作区最近 25 个会话；通知取走时限与待收队列背压；成功 / 进行中反馈用动画（脉冲 / 转圈 / ✓），错误仍用文字。
- **UI 基准线**：全插件文案压缩、语义合并、边界提示独立；数据变化只给变化的行 1.5s 高亮。见 `docs/ui-copy.md`。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 范围见 `package.json`）。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.0.0.tgz`；或下载附件后导入。不要同时挂第二个压缩包。

## 升级

- 旧任务库按增量字段读取：缺 `stage` / `approval` 的任务照常显示，不丢数据。
- `issues` / `repo` / `sync` / `projectStatus` 等 GitHub 开关默认关，不打开不会自动写 GitHub。
- 改完执行 `/relay reload`（改了 `lib/index.js` / `package.json` 时重启 DSH），面板刷新即可。真机建议先过一遍侧栏 4 页签、模板、搜索与任务详情。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.0.0/CHANGELOG.md
- 设计、已知坑与审阅边界：`docs/maintenance-guide.md`
- 命令速查：`/relay help`
