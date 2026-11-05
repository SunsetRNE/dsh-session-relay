# 插件任务库（1.8/1.9）设计与迁移

状态：1.8 已实现（插件任务库 + 导入/导出 + 自动归档）；1.9 已实现（父子/依赖 + split + dispatch）。用户 2026-11-06 已定三条：
1. 插件为唯一事实源，旧 `.agents/TASKS.md` / `.agents/claims` 首次导入，之后**只读导出**（其它工作区/脚本仍能看）。
2. 主会话可以按优先级/依赖**自动派发**，受唤醒预算与派发上限约束，可随时停。
3. 任务支持**父/子 + 依赖**（串行/并行），子任务可单独派发，父任务全子任务完成后自动 done。

## 1. 目标

- 任务、认领、事件、归档全部存在插件数据目录，不再以仓库文件为事实源；仓库里的 `.agents/TASKS.md` 和 `claims/` 是导出快照。
- 自动归档：终态任务到期自动进归档库，活动库保持小；归档可查、不删。
- 工具直接派发：`peer_task action=dispatch` 可按任务/整棵子树唤醒已有会话或拉起新会话；拆分任务按依赖推进。

## 2. 存储（1.8 实际实现）

路径：`<插件数据目录>/tasks/<workspace-group>/`，内部复用现有 markdown/claims 格式（不另造 JSON 任务表，解析/写操作/分类全部沿用）：

```
tasks/<group>/
  .agents/TASKS.md          # 事实源（表格 + 详情段 + 认领规则）
  .agents/claims/<号>/      # owner / done / abandoned（现有形状）
  .agents/TASKS-archive.md  # 归档详情
  .agents/task-events.jsonl # 事件日志
  .agents/backups/ops/      # 每次写操作前的备份
  .archived-claims/<号>/    # 归档后移出的认领目录
  meta.json                 # { importedAt, sourceFile, exportRoot }
```

- 写操作仍是现有 `withBoardLock` + 原子替换，只是路径在插件目录；事件、备份、锁都不再进工作区。
- 父子/依赖在 `graph.json`（`{ [id]: { parentId, dependsOn[] } }`），不塞进 markdown 表格。
- 任务详情、认领链、完成/放弃时间沿用 `parseTaskDoc` / `readClaims` 的既有语义。

## 3. 导入 / 导出

**首次导入**（每个工作区一次，`meta.importedAt` 为空时）：
1. 从会话目录往上找 `.agents/TASKS.md`（现有 `locateBoard`）；
2. 把 `TASKS.md`、`TASKS-archive.md`、`claims/` 复制进插件目录（保留 mtime，终态时间不丢）；
3. `meta.json` 记 `sourceFile`、`exportRoot`、`importedAt`；原文件不动，留作对照；之后不再读它。

**导出**（只读快照，插件写、别人读）：
- 每次写操作后把插件库里的文件复制回：
  - `<workspace>/.agents/TASKS.md`
  - `<workspace>/.agents/claims/<号>/owner|done|abandoned`
  - `<workspace>/.agents/TASKS-archive.md`
- 导出原子写；失败不阻塞插件内的任务状态，下一次写操作重试。
- 导入后若有人手改 `.agents/TASKS.md`，**不会**被读回（源已切换）；需要时用 `/relay task import --force` 重新导入（明确覆盖，带备份）。

## 4. 自动归档

- 终态：`merged`、`abandoned`（沿用现有分类）。
- 条件：终态且 `updatedAt` 超过 `taskArchiveAfterDays`（默认 7 天）；或活动任务数超过 `taskStoreMaxActive`（默认 500）时先归档最老的终态。
- 动作：任务从 `tasks` 移到 `archive`（保留全部字段 + `archivedAt`），追加 `events.jsonl`，重导出 `TASKS.md` / `TASKS-archive.md`。
- 触发：插件 tick（默认每小时一次）+ 每次写操作后顺手清理；归档是幂等的。
- 手动：`/relay tasks archive` 仍可用（预览/执行），底层操作 JSON。
- 永不物理删除；`archive` 超过上限再写 `tasks-archive.jsonl` 冷存。

## 5. 派发（1.9 已实现）

- `peer_task action=split id=<父> subtasks=[...] [serial]`：在父任务下建 `<父>.1…` 子任务，写 `graph.json`；`serial` 让子任务串行依赖前一个。
- `peer_task action=dispatch [id] [mode] [limit] [dry_run]`：
  - 带 `id` 派发整棵子树；不带 `id` 派发依赖已满足的待认领/进行中任务；有子任务的父任务不直接派发（按子任务派）。
  - `mode=auto`：有持有者就唤醒（`deliver`，受无人值守预算），没有就复用 `launchClaimer` 拉起新会话并带任务认领指令；`wake` / `spawn` 可强制。
  - 依赖：`dependsOn` 里的任务必须已 `merged/abandoned/archived` 才派发；否则跳过并说明。
  - `limit` 默认 3、上限 8；`dry_run` 只出计划。
  - 每次派发写 `task-events.jsonl`（谁派、派给谁、mode）。
- 父任务自动完成：子任务全部 `merged/abandoned` 时，把父任务状态改成「已合入（子任务全部完成）」；在子任务 done/abandon 和 dispatch 后触发。
- 不自动插播/不自动轮询：主会话显式调用 dispatch；用户可 `/relay task dispatch …`。
- 失败/预算用尽：保持原状态，不标记已派发；派发结果里列出失败与跳过。

## 6. 看板与上下文

- 面板任务页、`/relay tasks`、`peer_tasks` 全部读 JSON；表格列沿用现有（号/优先/任务/工作树/需要构建/状态），树的缩进用 `parentId`。
- 上下文注入改成插件路径（如 `<task-store group="…"/>` 或 `tasks/<group>/`），不再写“看板文件路径 + claims 目录”；提示语改成“用 peer_task 操作任务库，插件负责导出 TASKS.md”。
- 看板 payload 增加 `tree`（父子）、`dispatchable`（依赖已满足、未指派）摘要，控制体积（≤2 KB）。

## 7. 兼容与迁移

- 其它工作区（DSH-A-mod 等）继续能读导出的 `.agents/TASKS.md` / claims；但**写**必须走插件，否则不会回读（需要时 `--force` 重新导入）。
- 仓库里不要提交 `tasks.json`（在插件数据目录，不进工作树）。
- 迁移期保留 `--legacy` 只读回退：设置 `taskStore: 'legacy'` 时走旧文件读写（一个版本），默认新库；1.10 删除。
- 测试：现有任务测试改为走插件库 + 断言导出文件；新增导入、导出原子性、自动归档、派发预算、父子依赖、失败重试。

## 8. 分期

- **1.8**：taskstore 模块（JSON + 锁 + 导入/导出 + 事件）、看板/`peer_tasks`/`peer_task` 切到任务库、自动归档 tick、兼容开关、测试迁移。
- **1.9**：dispatch（单任务/子树）、split、父子自动完成、派发预算与审计、面板“可派发”区。
- **1.10**：删除 legacy 文件回退；`/relay task import/export` 命令；归档冷存。

## 9. 风险

- 现有测试/worktree 声明大量依赖文件路径与内容；迁移要保证导出字节级接近，否则“别人看到的不一样”。
- 主会话自动派发可能一次拉起多个会话，必须用预算 + `limit` 双约束，且默认 `dry_run` 先看计划。
- 任务库是插件数据，DSH 重装/换机不自动跟随；导出文件是备份而非源。
- 派发失败/预算用完不能进入“已派发”状态，保持 `open` 或 `claimed`，避免任务丢失。
