# 通知邮箱（1.4.0）设计稿

状态：1.4.0 发布 MVP；1.5.0 发布第二阶段（5 分钟批量短通知、`/relay mail` 命令、token 统计）。

## 目标

- 把「公共通知」的全文从每个会话的上下文里挪到一个插件邮箱；并行开发的 AI 只收到一行短通知，需要细节时用 `peer_mail` 自己读。
- 主会话和 worker 共用同一个邮箱视图；主会话能读全部，worker 只读自己工作区/发给自己的。
- 关键消息仍然直接送达：提问、blocked、合并冲突、当前发布失败、安全/凭据类。
- 手机通知只保留「需要人处理」的类别，成功类默认不响。

## 非目标

- 不替代 `peer_report`：主会话仍需要收到工作汇报；MVP 不把汇报正文邮件化，只把「公共通知」先搬进去。
- 不做跨工作区广播。
- 不存 token、密码、登录验证码等敏感内容；正文落库前做一次长度和敏感片段过滤。

## 现状与痛点

- `lib/watch.js` 的核验结果在 `flush` 时整段发给创建者/主会话，并可能发手机通知；一段 CI 结果通常 300–800 tokens。
- build 发布、版本线更新、看板变化这类公告对大多数并行会话没有即时价值，但每个会话都收到全文。
- 结果：并行会话越多，重复上下文越大；真正需要读全文的往往只有主会话或一两个相关 worker。

## 数据模型

```json
{
  "id": "m_<base36>",
  "at": 1793912345678,
  "kind": "watch|build|version|board|system",
  "severity": "info|warn|error",
  "scope": { "type": "workspace|role|session", "id": "<groupKey|main|worker|sessionId>" },
  "group": "<workspace group key>",
  "from": "<sessionId|plugin>",
  "subject": "CI 42108077808 成功（v1.3.1）",
  "body": "完整通知正文（≤ 8 KB）",
  "refs": [{ "kind": "ci", "runId": "42108077808", "url": "https://..." }],
  "eventKey": "watch:5f6a6058:success|release:v1.3.1",
  "readBy": { "<sessionId>": 1793912400000 },
  "createdAt": 1793912345678,
  "archivedAt": null
}
```

- `eventKey` 用来去重：同一个 watch 的同一个结果、同一个 release/tag 只写一条。
- `readBy` 按会话记；新主会话继承工作区的未读，不会因为旧会话读过而消失。
- `scope=workspace` 的所有会话可见；`session` 只给目标会话；`role=main` 只给主会话。

## 存储

- 默认放插件数据目录（与 `watches.json`、`handoffs.json` 同级的 `mailbox.json`），按 `group` 过滤；不往用户仓库的 `.agents/` 里写新文件，避免污染工作树。
- 追加写入 + 原子替换；带 `.bak` 留底；与看板一样用一个短锁避免并发写坏。
- 上限：每工作区 500 条 / 30 天；超出或过期的已读条目移到 `mailbox-archive.jsonl`，不直接删。
- 可选：`/relay mail export` 把当前工作区邮箱导出到 `.agents/mailbox/`，需要用户显式触发。

## 投递策略

| 事件 | 直接送达 | 邮箱 | 手机通知 |
| --- | --- | --- | --- |
| `peer_ask_user` 提问 / blocked | 是（全文） | 同时留档 | 是 |
| 合并冲突 / 当前发布 CI 失败 / 安全凭据 | 是（全文） | 同时留档 | 是 |
| 核验 CI 成功 / ref 完成 | 否 | 是 | 否 |
| 核验失败/超时（2 小时内） | 摘要直接送 | 是 | 是 |
| 旧失败（>2 小时） | 否 | 是 | 否 |
| build 发布 / 版本线更新 | 否 | 是 | 否 |
| 看板变化（非冲突） | 否 | 是 | 否 |

短通知格式（发给目标会话）：

```
[协作邮箱 · <workspace>] 2 条新消息：CI 42108077808 成功（v1.3.1）；build330 已发布。
用 peer_mail read 查看全文；最新 id m_xxx。
```

- 同一个会话在 5 分钟窗口内只发一条短通知，累计条数和最新标题；失败/冲突不受窗口限制，立即送。
- 短通知里必须带足以行动的一行结果（成功/失败、tag/run id），否则每个 AI 都会去读全文，反而更贵。

## 工具 `peer_mail`

模型入口，和 `peer_watch` 同一层注册；工具说明保持短。

```
peer_mail({
  action: "list" | "read" | "peek" | "mark",
  ids?: string[],          // read/mark 用
  limit?: number,          // list/read 默认 5，上限 20
  unread?: boolean,
  kind?: "watch|build|version|board|system",
  since?: number,
  workspace?: string       // 仅主会话/侧栏面板需要
})
```

- `list`：只返回 id、subject、at、kind、unread，不返回 body；便宜。
- `read`：返回 subject + body + refs，标记当前会话已读；总输出上限 8 KB，超出给 `more` 指针。
- `peek`：subject + 一行摘要。
- `mark`：标记已读/未读/归档；主会话可标记工作区，worker 只能标记自己的 readBy。
- `send` 暂不开放给模型；插件内部用 `publish()`，用户用 `/relay mail send`，避免变成绕过汇报的私聊通道。
  实现后（1.4.0）：主会话模型可以用 `send`/`force`；用户命令 `/relay mail` 提供 list/read/archive 与 7 天统计（1.5.0）。
- 权限：工作区隔离；`scope=session` 只对目标会话可见；主会话可读本工作区全部；不读别的 workspace。

## 面板

- 「协作」标签新增第 5 个子页「邮箱」；没读时标签上显示数字，和看板/核验的红点分开。
- 列表默认未读 + 最近 20 条；每条显示 subject、时间、来源、refs 按钮（打开会话 / CI 页面）；body 折叠展开。
- 顶部「全部已读」；筛选未读/种类；窄屏单列，宽屏两栏（列表 + 详情）。
- 看板 payload 增加 `mailbox: { unread, latestSubject, latestAt }`，只给摘要；完整列表按需走 `view=mail`，不把全文塞进每轮上下文。
- 侧栏面板同样显示未读数；打开后才拉列表。

## Token 账

- 每条记录 `bodyBytes`；短通知 `noticeBytes`；插件状态页给「本工作区邮箱：N 条未读，最近 7 天短通知 X 条 / 全文 Y 条」。
- 目标：成功类通知不再进入每个会话的上下文；主会话按需读，worker 只在被点名/需要细节时读。
- 如果发现某个 AI 每次都 `read` 全部，说明短通知的行动信息不够，要改短通知，而不是加更多全文。

## 生命周期与安全

- 去重：`eventKey` 唯一；同一事件重复触发只更新 readBy/摘要，不新增。
- 上限/TTL 见存储；归档不删；损坏文件先 `.bak` 留底再重建（和 watches 一样）。
- 正文过滤：长度上限、去掉 `gho_`/`ghp_`/私钥等模式；邮箱不是凭据存储。
- 邮箱内容仍是数据，不是用户指令；工具返回带同样的边界提示。

## 主会话推送时限（2026-11-06 用户补充）

只有主会话能用 `peer_mail send`/`force`；`list/read/peek/mark` 所有会话可用。

- `send` 默认 `deadlineMinutes: 5`，主会话可传 1–60 自定义；只对 `to=session` / `to=workspace` 的未读目标生效。
- 发出时写入 mailbox，同时给目标发短通知；记录 `deadlineAt`、`targets`、`remindedAt`。
- 插件每 30 秒检查一次：到期且仍有目标未读、且未 `force` 的消息，给主会话发一条短提醒：
  `[协作邮箱] 消息 m_xxx「<subject>」已 5 分钟未读（<未读目标>）；用 peer_mail force ids=[...] 强推，或 mark 归档。`
- 提醒只发一次（`remindedAt` 防重复）；主会话可以：
  - `peer_mail force ids=[...]`：把全文直接投给未读目标（正在运行用 steer，空闲用 followup），标记 `forcedAt`，不再提醒；
  - `peer_mail mark ids=[...] archived`：放弃/归档；
  - 或自己用 `peer_send` 处理。
- 这条提醒本身也走短通知，不进每个 worker 的上下文；目的是防止 worker 被重任务拖住、主会话不知道消息没人看。
- 手机通知：超时提醒是否响由主会话的 `notify` 偏好决定，默认只在主会话在线但未处理时提示一次。

## 分阶段

1. **MVP（1.4.0）**：`mailbox.json` + `peer_mail` list/read + `view=mail` + 面板「邮箱」页；先接「核验成功/ref 完成、build 发布、版本线更新」三类；问题/blocked/冲突仍直送。
2. **省 token 第二阶段（1.5.0）**：5 分钟窗口批量短通知（失败/冲突仍直送）、手机通知抑制、`/relay mail` 命令、7 天 token 统计。
3. **扩展**：`peer_report` 摘要化（先测量再决定）、看板变化、按角色订阅、归档/导出。

## 测试

- store：追加、去重、scope 过滤、readBy、TTL、损坏留底、并发锁；主会话可读/强推/归档 scope=session。
- tool：list/read/peek/mark 的输出上限、权限、未读计数、跨 workspace 拒绝。
- 投递：CI 成功只进邮箱 + 短通知；失败直送 + 邮箱；不重复手机通知。
- 批量（1.5.0）：同一目标窗口内多条合并一条、窗口外不合并、失败按次数放弃、reload 后按排期继续；批量短通知不响手机。
- 统计（1.5.0）：bodyBytes / noticeBytes / noticeCount，7 天窗口。
- 命令（1.5.0）：`/relay mail` list/read/archive 的解析与输出。
- UI：看板 payload 的 unread 摘要；邮箱页在 360/480/760/1000/1280 宽度下的单双栏；竖屏/横屏和 composer 高度。
- 回归：235 项现有测试保持全过。

## 已定（2026-11-06）

1. 存储位置：插件数据目录（`mailbox.json`），按 workspace 过滤；不写进工作树。
2. 第一批接入：核验成功 + build/版本公告；问题/blocked/冲突/当前发布失败仍直接送达。
3. worker 的 `peer_mail send`：MVP 只读；`send`/`force` 主会话特有。
4. 保留策略：每工作区 500 条 / 30 天，过期已读自动归档，不直接删。
5. 主会话推送默认 5 分钟时限，可自定义；超时提醒主会话，由它决定是否 `force` 强推。
