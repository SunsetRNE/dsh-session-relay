# dsh-session-relay 2.4.5

2.4.5 补两处协作体验：对话里的「协作」标签与左侧「会话监督」面板可以切到任一侧栏已登记的工作区看只读监督数据；票子驾驶舱可以把活跃 / 久未活动持有者直接交接给新会话。串行测试 508 全过。

## 亮点

- **协作面板工作区切换（T20）**：嵌入面板（对话「协作」标签 / 左侧「会话监督」）顶栏在已登记工作区 >1 时出现工作区下拉，默认「跟随当前会话」；切走后看板 / 任务 / 邮件 / 搜索按 `workspace` 取数，回复、认领、拉起、接手、改版本线等写动作在前端拦截并提示只读；选择按嵌入 / 会话隔离记在本机，工作区被删除 / 只剩一个时安全回退。右侧栏无会话视角与设置页的原有行为不变；服务端 PR / 问题 / 页签计数等只读视图支持显式 `workspace`。
- **票子驾驶舱「交接给新会话」（T22）**：持有者活跃 / 久未活动时，不用再手动 handoff 再拉起两步——一键交接：建新会话 → 看板 handoff 转认领 → 写 launch（接手自 @old）+ `stage=doing` → 首条消息带接手说明（先读原会话 `.SESSION-DONE` / 看板、别推别的分支）→ 通知原持有者「停止改文件、等唤醒」→ 审计。持有者已失效（dead）仍走原「拉起会话」；依赖未结束 / 审批打回 / 技能不存在仍挡，`doing / review` 等阶段不挡；重复点击幂等，并发不会出现两个所有者；通知失败不回滚交接但会记录。
- **KIT 与页签**：`SIDEBAR_KIT 48` / `PANEL_KIT 11`；右侧边栏仍 9 页签，嵌入「协作」面板 11 页签；升级后需**整页刷新**，本地记录无需迁移。
- 2.4.4 的票子驾驶舱、PR 11 态审核、AI 审核结论自动回写、合并流水线「本地已合入 · 待推送」、任务页「还有 N 条」展开全部保留。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.4.5.tgz`。

## 升级

- 从 2.4.4 覆盖安装；装好后**整页刷新**（`SIDEBAR_KIT 47 → 48`、`PANEL_KIT 10 → 11`）。如果仍停在 stale 提示，按 `整页刷新 → /relay reload → 重启 DSH` 顺序处理。
- 2.4.3 及更早版本直接覆盖安装同样可用，本地任务 / 审批 / PR 审核记录格式兼容，无需迁移。
- 已发布的 2.4.4 tag / Release 保持只读。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.4.5/CHANGELOG.md
- 维护与已知坑：`docs/maintenance-guide.md`
- 协作流程：`docs/coordination-playbook.md`
- 流程 UI 设计：`docs/coordination-ui.md`
- 发版清单：`docs/release-checklist.md`
