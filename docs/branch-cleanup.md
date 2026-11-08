# 遗留分支清理（未发版）

用户 2026-11-08 提出：会话结束后工作树分支留在面板上，上百个分支要逐个收尾。这个子页把「工作树占用的分支」集中起来，多选后一次确认批量移除。

## 入口与范围

- 分支页顶栏出现「清理遗留 N」（N = 分支页数据里被工作树占用的本地分支数），点进去是清理子页；「返回分支」回列表。
- 范围：侧栏登记且有路径的全部工作区；只列被 `git worktree list` 占用、且不是主 checkout 的本地分支。
- 每行：分支名、工作树路径、「已合并 / 未合并」、「干净 / 有改动」、「声明已结束 / 无声明 / 会话未结束」（带会话 id）。

## 可清理条件

只允许同时满足：

1. 工作树在 `<仓库>/.agents/worktrees/` 下；
2. `git -C <工作树> status --porcelain` 为空；
3. 工作树里没有 `.ACTIVE-SESSION`。

`.SESSION-DONE` 或无声明都可以；未合并分支允许删，但界面标红，确认框里必须额外勾选「我确认删除未合并分支」。

## 交互

- 勾选（单条 / 工作区全选 / 顶部全选可清理）；不可清理的行禁用并显示原因（有改动 / 会话未结束 / 不在 .agents/worktrees 下 / 读不到状态）。
- 点「清理选中」→ 页面内确认块列出选中分支与未合并警告 → 勾选未合并确认 → 「确认移除」。
- 结果：已移除 X 个、跳过 Y 个；跳过项逐条显示服务端返回的原因。
- 写后清 `branches:<path>` 缓存并重拉清理视图；成功用顶部脉冲（既有反馈），错误仍用文字。

## 服务端

- `view=branch-cleanup`：遍历登记工作区，`GitHubLists.worktreeBranches()` 返回 `{workspace, repo, branches:[{name, worktree, merged, clean, declaration, session, cleanable, reason}]}`；没有遗留的工作区不返回。
- `action=branch-cleanup`：只由用户点击；要求 `confirm === true`，`items=[{workspaceId, name}]`（≤200，按工作区分组）。
- 服务端不信任列表页状态：逐条重新校验上述 3 个条件，再 `git worktree remove`（不 force）+ `git branch -D`；跳过项不中断其余条目。
- 审计：每条成功记 `branch-delete-worktree`（`batch:true`），整批再记一条 `branch-cleanup`（`removed/skipped/branches`）。
- 模型没有批量清理工具，路由再校验 `user === true`。

## 边界

- 不做定时 / 自动清理；每次都要用户勾选 + 确认。
- 工作树移除后删分支失败：结果明确写「工作树已移除，但删除分支失败」，不重试。
- 主 checkout 的分支（`worktree === 仓库路径`）不算遗留，不列。
- 只处理 `.agents/worktrees/` 下的工作树；外部手动工作树只显示、不可清理。
