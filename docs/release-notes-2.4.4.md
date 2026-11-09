# dsh-session-relay 2.4.4

2.4.4 把协作流程继续做进面板：票子驾驶舱（拉起会话 / 内置技能 / 回填 + 阶段判定）、PR 11 态审核、AI 审核结论自动回写、本地已合入 · 待推送中间态；三个 relay 技能改为随包内置。串行测试 495 全过。

## 亮点

- **票子驾驶舱（T15/T19）**：任务 / 地图票详情显示 holder、分支、工作树、最近汇报；gates 判定（依赖、持有者、阶段、审批、合并、发布）与状态按钮；「拉起会话」把票子完整字段注入首条消息并回填 holder / 分支 / worktree / stage=doing。合并状态按 holder 会话的合并事实显示（origin 已合入 / 本地已合入 · 待推送 / 已批准 / 可合并 / 已发布），版本用待发版本（当前 v2.4.4），任务审批单独标注。
- **内置技能（T15）**：`relay-main` / `relay-worker` / `relay-release` 随包 `bundled-skills/` 提供（rank 600），安装即出现在技能列表；项目 / 用户同名技能仍可覆盖。
- **PR 11 态审核（T16）**：未审核 / 审批中 / 已审核 / 需再审 / 已驳回 / 已拒绝 / 已关闭 / 已忽略 / 已落后 / 待合并 / 已合并，固定优先级链；列表 chip / 筛选 / 计数 / 图例与一句话原因；本地多轮审核记录、忽略 / 拒绝（可取消），head 变化自动需再审；只写本地与审计，不写 GitHub。
- **AI 审核自动回写（T17）**：点「AI 审核」后列表立即刷新并显示「审批中」；审核会话结束后服务端只读会话日志，解析 `【审核结论】pass|must-fix` 自动写本地审核记录，状态自动转「已审核 / 已驳回」；解析不到给「请记录结论」提示，手动补录仍可用。
- **本地已合入 · 待推送（T18）**：合并流水线新增中间态——提交已在 local main、但还没进 origin/main 时显示「本地已合入 · 待推送」，待推送卡片不再给批准动作；push 后转「已合入」，Release 后转「已发布」。
- **任务页「还有 N 条」可展开（T19）**：已结束 / 进行中 / 可接的截断列表可点开展开或收起，不再只是提示。
- **KIT 与页签**：`SIDEBAR_KIT 47` / `PANEL_KIT 10`；右侧边栏仍 9 页签，嵌入「协作」面板 11 页签，数据格式无需迁移。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.4.4.tgz`。

## 升级

- 从 2.4.3 覆盖安装；装好后**整页刷新**（`SIDEBAR_KIT 46 → 47`、`PANEL_KIT 9 → 10`）。如果仍停在 stale 提示，按 `整页刷新 → /relay reload → 重启 DSH` 顺序处理。
- 票子审批 / 合并记录、PR 审核记录（`pr-reviews.json`）都在本地，无需迁移；本地 main 未 push 的提交会显示「本地已合入 · 待推送」，push 后自动转「已合入」。
- 已发布的 2.4.3 tag / Release 保持只读。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.4.4/CHANGELOG.md
- 维护与已知坑：`docs/maintenance-guide.md`
- 协作流程：`docs/coordination-playbook.md`
- 流程 UI 设计：`docs/coordination-ui.md`
- 发版清单：`docs/release-checklist.md`
