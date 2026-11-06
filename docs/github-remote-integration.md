# GitHub 远端接入：仓库开关、issue 多状态、PR 审核与合并

状态：设计稿（2026-11-06）。承接 `docs/github-issues-eval.md`（本地为准、unknown 态、审批门、地图票投影），
只补充它没覆盖的三块：**仓库级能力/开关**、**issue 多状态里的「审查」段**、**PR 审核与合并流程**。

一句话：**relay 任务库仍是唯一事实源；GitHub 是投影 + 只读事件来源；任何远程写入都必须先由人打开对应仓库开关。**

## 0. 结论先行

1. **三层接入，不混在一起**
   - R0 只读：探测仓库能力、展示 PR/issue 状态、本地记 `stage` 与 `approval`（**不写 GitHub**）。
   - R1 投影：本地任务 → issue/labels/评论（按开关出站，unknown/重试，沿用 S1）。
   - R2 事件：GitHub PR review/merge、issue 状态 → 只读投影回 relay（不反推本地事实）。
2. **开关只由人开**：仓库能力探测是只读的；`issues`、`mapIssues`、`closeOnTerminal` 等开关默认全关，只能在面板里由用户点开，模型和主会话都不能替用户开（可以建议）。
3. **不假装仓库有该能力**：探测不到/没权限就显示「不可用/未知」，对应开关禁用并说明原因（例：main 没开分支保护时，PR 审核门只能靠本地审批记录，不能声称 GitHub 强制）。
4. **「审查」是 relay 的本地状态段**，不是把 GitHub review 当事实：PR 的 review/check 只作只读证据；本地 `approval` 由用户或主会话显式记录后才算过门（沿用 4A.9）。
5. **合并永远要用户明确同意**：relay 可以准备队列、展示可合并、写合并总结；真正 merge 到 main 仍按本工作区规则由用户批准后执行。

## 1. 现状与缺口

2026-11-06 只读探测（`SunsetRNE/dsh-session-relay`）：

| 能力 | 实测 |
|---|---|
| issues | 开（`has_issues=true`） |
| projects | 开（`has_projects=true`） |
| 合并方式 | merge/squash/rebase 都允许 |
| 合并后删分支 | 关（`delete_branch_on_merge=false`） |
| main 分支保护 | **未开**（404）→ 没有 required reviews/checks |
| 标签 | 10 个 |
| 开放 PR | 0 |
| sub-issues API | 未能确认（无 issue 可测；可能不支持）→ 设计必须允许降级 |

relay 现有缺口：任务没有 `stage`（只有推导 state）、没有 `pr` 关联、没有 `approval` 字段落地、没有仓库能力/开关概念、没有 PR 事件表。

## 2. 仓库能力探测（只读）

每个工作区 origin 解析出 `owner/repo` 后，探测结果缓存在插件数据目录：

```
repos/<owner>__<repo>.json
{
  "probedAt": 0,
  "repo": { "hasIssues": true, "hasProjects": true, "defaultBranch": "main",
            "merge": { "merge": true, "squash": true, "rebase": true }, "deleteBranchOnMerge": false },
  "protection": { "state": "none|on|unknown", "requiredReviews": 0, "requiredChecks": [], "enforceAdmins": false },
  "labels": ["..."], "subIssues": "supported|unsupported|unknown",
  "permissions": { "push": true, "admin": true, "triage": true }
}
```

- 只读，不改仓库；403/404/网络失败分别记 `unknown`/`none`，**不猜**。
- 探测是「展示开关可用性」的依据，不是「自动开启」的依据。
- sub-issues：先探测对应 endpoint；不支持时地图票降级为「父 issue 正文 tasklist + `wayfinder:*` 标签」，能力字段标 `unsupported`。

## 3. 仓库开关（人开）

存插件数据目录，按仓库（`owner/repo`；同仓库多工作区共享）：

```
repos/<owner>__<repo>.json
{
  "version": 1,
  "repo": "owner/repo",
  "probedAt": 0,
  "probe": { ... },
  "switches": {
    "issues": false, "mapIssues": false, "prLink": false,
    "approvalGate": true, "closeOnTerminal": false,
    "labelSync": false, "projectStatus": false
  },
  "switchesUpdatedAt": 0, "switchesUpdatedBy": "user"
}
```

`autoMerge` 不提供：relay 永不自动合并。

| 开关 | 默认 | 作用 | 依赖 |
|---|---|---|---|
| `issues` | 关 | 出站 issue 投影（建票/评论/标签） | has_issues |
| `mapIssues` | 关 | 父任务 → 地图票；子任务 → sub-issue / tasklist | issues + subIssues 或降级 |
| `prLink` | 关 | 任务关联 PR、只读展示 review/check | 仓库可读 |
| `approvalGate` | 开 | merged 前需本地 `approval=approved` | 无（纯本地） |
| `closeOnTerminal` | 关 | 终态后关 issue（仍要用户/主会话显式） | issues |
| `labelSync` | 关 | 写 `relay:*` 标签 | issues |
| `projectStatus` | 关 | 同步 Projects Status 字段 | has_projects |
| `autoMerge` | 关（不允许打开） | — | 保留字段说明「relay 不自动合并」 |

规则：
- 只有用户在面板里能改；模型只能读（`peer_task`/看板展示），改开关的接口不注册为模型工具。
- 每次开关变更写一条审计（谁、何时、旧值→新值）并刷新探测。
- 2.0.0 R0 落地：协作面板「交接与核验 → GitHub 仓库」展示探测结果与开关，只有用户能点；改动追加到插件数据目录 `repos/switch-audit.jsonl`（字段 at / repo / key / from / to / by）。
- 依赖不满足时开关置灰并显示原因（例：「仓库没有开分支保护，PR 审核门只在 relay 本地生效」）。
- 工作区换仓库：开关按 `owner/repo` 独立，不继承。

## 4. issue 多状态：`stage` + 推导 state

本地新增字段 `stage`（可选，缺省空），与现有 derived state 分离：

| stage | 含义 | 进入条件 | 谁改 |
|---|---|---|---|
| `triage` | 待分诊（来源/范围未定） | 人/主会话登记时可选 | 用户 / 主会话 |
| `ready` | 可认领 | 默认；或分诊完 | 用户 / 主会话 |
| `doing` | 进行中 | 认领成功自动置 | 认领会话（自动） |
| `review` | 待审查/待合并 | 提交或 PR 已开，等审批 | 持有会话提议，用户/主会话确认 |
| `hold` | 暂停（等外部） | 需要等人/等信息 | 用户 / 主会话 |
| `dropped` | 不做 | 放弃前 | 用户 / 主会话 |

- derived state（`open/live/queued/merged/...`）继续由表格 + claims + git 推导，不被 `stage` 覆盖。
- `stage=review` 与 `approval` 联动：进入 review 时 `approval=pending`；审批通过改 `approved`；打回改 `rejected` 并回 `doing`。
- 模型不能自动把任务设成 `review` 或 `approved`；只能在汇报里建议，由用户/主会话记录。
- GitHub 投影（开关打开时）：`relay:stage:<stage>` + 既有 `relay:*`；`review` 用 `relay:review`，不写 assignee。

## 5. PR 审核与合并流程

### 5.1 任务 ↔ PR

```
task.pr = { number, url, headSha, base, state, draft, reviewDecision, checks: { passing, pending, failing }, mergeable, mergedAt }
```

- 只读缓存 + 事件表 `prs.json`；每 60–120 秒轮询（标签可见时），失败记 unknown，不阻断本地。
  - 2.0.0 R0 实际实现先按需探测：用户 `/relay task pr <任务号> <号|URL>` 关联时读一次，之后查看任务详情时缓存超过 2 分钟才重读；`refresh` 强制、`clear` 解除。不做后台轮询（轮询留到 S1）。读取用 `gh pr view --json …`（只读 GraphQL），不写 GitHub。
  - 只给 PR 号时用当前目录的 GitHub origin 推断 `owner/repo`；给 URL 时以 URL 为准。
- 一个任务默认只关联一个 PR；重开 PR 以最新为准，旧号记历史。
- PR 不反推任务状态：PR merged 只作为 `approval` + 提交在 main 的证据，本地仍按 4A.9 顺序。

### 5.2 流程（人审）

1. 持有会话写完 → 推分支 → 开 PR（草稿可选）→ `stage=review` 提议 + PR 链接。
2. relay 只读展示：CI 检查、review 决定、可合并性；不代写 review、不代 merge。
3. 用户或主会话审批代码：记录 `approval=approved`（含依据：PR 号/提交/验证结果）。
4. 合并：用户在会话里明确同意后，由主会话执行合并（或用户自己在 GitHub 点）；relay 记录提交号与合并方式。
5. 写合并总结（本地 note + 可选 GitHub 评论），然后按 `closeOnTerminal` 与用户显式确认关 issue。
6. 任一步失败/超时：停在当前步，`unknown` 重试，不跳步。

### 5.3 审批门与仓库能力

- `approvalGate` 默认开：没有 `approved` 不显示可合并、不写 `relay:merged`、不关 issue。
- GitHub 有分支保护/必需 review/checks 时：只读展示「GitHub 强制」并阻止在 relay 里误判可合并；没有时明说「仅 relay 本地门」。
- 合并方式以仓库能力为准（merge/squash/rebase）；relay 不猜，用户选择。

## 6. 地图票远端接入

沿用 4A.6/4A.7 的映射，补充能力降级：

| 能力 | 支持 | 降级 |
|---|---|---|
| sub-issues | 父 issue + 子 issue 原生父子 | 父 issue 正文 tasklist（`- [ ] #123`），不假装原生 |
| blocked_by | GraphQL `blockedBy`/`blocking` | 本地依赖为准；issue 正文写「Blocked by #x」，不依赖远端 |
| 状态 | `relay:stage:*` + open/closed | 同上 |
| 关票 | 人/主会话显式 | 不自动 close |

- 地图父任务完成仍由 relay 子任务终态触发；GitHub 上人工关地图不会自动完成 relay 父任务。
- 地图票标签：`wayfinder:map` + 子票 `wayfinder:task|research|prototype|grilling`；没有类型默认 `task`，不猜。
- `projectStatus` 打开时才写 Projects Status；默认不启用。

## 7. 同步与 unknown（沿用 S1）

- 出站队列按开关分流；关闭的开关只保留本地，不出站。
- 超时/断网/gh 退出码不明 → `unknown`，不重放已可能成功的写；按幂等键（repo+task+动作）核对后再重试。
- 网络长期不稳允许 `queued/unknown`，面板如实显示「GitHub 可能落后，本地为准」。
- 主会话接管：`unknown` 超过阈值通知主会话；主会话只核对与重试，不代用户开开关、不代用户批合并。

## 8. 分期

- **R0（放进 2.0.0，本地，不写远端）**：仓库能力探测（只读）、开关面板（只存本地）、任务 `stage`/`pr` 字段、审批记录、PR/review/checks 只读展示、地图降级探测。
- **R1（2.0.0 之后 S1）**：issue/label/评论单向投影 + unknown/重试 + 关票。
  - 2.0.0 未发布前已提前落地：`issues` 投影（建票/评论/关票）、`labelSync`（relay:* 标签，缺失自动创建）、`mapIssues`（地图父票/子票，sub-issues 不可用时正文 tasklist 降级）；`lib/issuesync.js` + `/relay sync`，默认开关关、测试用 mock，未实际写 GitHub。右侧边栏与协作面板已有只读同步队列（快照 `sync`，不新增 gh 轮询）；同步动作按钮已完成；`projectStatus` 已完成只读展示（A）与用户点击写回（B；只写 Status 字段，匹配不到选项不写）。
- **R2**：PR review/merge 事件、地图 sub-issues/blocked_by 投影（能力支持时）。
- **R3（可选）**：Projects Status、组织级设置（需 org owner，当前 DSH-APP 是 member，不做）。

## 9. 已定（用户 2026-11-06）

1. 开关粒度：**按仓库**（`owner/repo`），同仓库多工作区共享，不按工作区；换仓库不继承。
2. `stage` 的修改权：**用户 + 主会话确认**；模型只能在汇报里建议，不能自动置 `review`/`approved`（`doing` 仍由认领自动置）。
3. PR 由谁开：**持有会话**开；relay 不代开。
4. 合并执行：**用户明确同意后主会话执行**；relay 永不动 autoMerge。
5. 关 issue：**用户/主会话显式**；`closeOnTerminal` 默认关。
6. **R0 进 2.0.0**（只读探测 + 开关 + `stage`/`approval`/`pr` 字段 + PR 只读展示），远端写入 S1 仍排 2.0.0 之后。

## 9A. 原开放问题（留档）

1. 开关粒度：按仓库（已定）。
2. `stage` 的修改权：用户/主会话确认（已定）。
3. PR 由谁开：持有会话（已定）。
4. 合并执行：用户同意后主会话（已定）。
5. 关 issue：显式（已定）。
6. R0 进 2.0.0（已定）。

## 10. 验收要点（R0）

- 能力探测：有/无保护、无权限、断网三种情况都有明确状态，不猜。
- 开关：只有用户入口能改；关时不出站；审计可查。
- `stage=review` 与 `approval` 联动：pending 时不算完成、不显示可合并。
- PR 只读：CI 失败/待审/可合并且无审批时，界面分别显示，不误导。
- 地图降级：sub-issues 不支持时用正文 tasklist，能力字段显示降级。
- 测试：现有 267 基础上加开关/能力/stage/PR 只读用例，保持串行全绿。
