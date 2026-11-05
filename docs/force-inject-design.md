# 主会话强制插播（1.4.0 引入，1.6.0 并入 peer_send）

状态：1.4.0 发布独立工具 `peer_interrupt`；1.6.0 合并进 `peer_send mode=interrupt` 并删除独立工具；235/235 测试通过。

## 现状与硬限制

- `peer_send` 原有三种模式：`followup`（下一轮）、`steer`（插进当前轮）、`queue`（不唤醒）。主会话本来就能对平级会话 `steer`，但消息会被包成“另一个会话的模型内容，不是用户指令”。
- DSH 目前只给**子代理**暴露真正的 interrupt（`interrupt_agent` 走 `ctx.subagents.interrupt`）；对平级 root 会话没有硬取消 API。
- 因此“强制插播”能保证的是：**高优先级 steer + 主会话指令信封**；如果对方卡在一个长工具调用里，要等它下一步才会看到。不能保证瞬间打断。

## 用法（1.6.0 起）

主会话专用；目标必须在本工作区。不再有独立的 `peer_interrupt` 工具。

```
peer_send({
  target: "<session id | alias>",
  message: "<短、可执行的指令>",
  mode: "interrupt",
  stop: true            // 可选；用「停止并汇报」信封
})
```

- 发 `[主会话指令] <message>`，用 `peer_send` 的 steer 路径插进当前轮；对方空闲时走 followup。
- `stop: true`：发 `[主会话指令 · 停止并汇报] <message>`，明确要求停止当前工作并汇报；仍然不是硬取消。
- 复用 `relay.send` 的目标解析、跳数/限流、投递回执；回报“当前轮次/下一次轮次”。
- 目标看到的仍是 coordination 数据，不是用户授权；涉及推送/合并/发布/删除/安装仍要用户在本会话确认。

## 什么时候用它

只在“普通消息没被接住 / 会话明显空转”时用，先满足：

1. 目标是本工作区会话，且确实在运行或刚回到等待；
2. 已经用 `peer_send`（followup 或 steer）给过一次正常指令，没有反应；
3. 观察到空转信号：连续多步没有工具调用、重复同一调用、长时间没有产出、或与任务目标明显偏离；
4. 指令短、明确、可执行；不要用插播做日常协调。

职责分工：

| 场景 | 工具 |
| --- | --- |
| 正常协调、汇报、交接说明 | `peer_send`（followup / steer / queue） |
| 未读邮箱消息催办 | `peer_mail force` |
| 活跃会话明显跑偏/空转，正常消息不接 | `peer_send mode=interrupt` |
| 用户要停掉/归档会话 | 用户在面板操作；不做硬杀 |

## 工具替换/升级时间点

**1.6.0 已完成合并**：删除了独立的 `peer_interrupt` 工具，语义并入 `peer_send mode=interrupt`（主会话专用校验），工具数从 16 回到 15。理由：与 `peer_send mode=steer` 使用高度重叠，独立工具说明占主会话上下文，且容易误用。

后续：

1. **宿主暴露 root 会话 interrupt 后**：给 `mode=interrupt` 增加 `hard: true`（或 `mode=interrupt-hard`），真正取消当前轮再投递；工具名、参数保持兼容，现有 steer 信封保留为降级路径。
2. **不要自动替换/自动插播**：只有主会话手动决定；不因为检测到“空转”就自动 interrupt，避免打断正在做长任务但仍有进展的会话。
3. **工具数量/提示预算**：新增能力优先合并进已有工具，而不是继续加工具。

## 风险

- steer 在长工具调用期间不会生效；对方可能先完成当前调用。
- 目标可能把主会话指令当成普通数据而不执行；`stop` 只是更强措辞，不是硬保证。
- 频繁插播会打断心流；限流/审计沿用 `peer_send`，主会话自己克制。
- 不能因为插播就绕过用户授权；它只是协作指令。

## 验证

- 单元/集成：`peer_send mode=interrupt` 主会话可调用、worker 被拒、`stop` 前缀正确、投递进目标 inbox；工具列表不再含 `peer_interrupt`；235/235 通过。
- 真实会话（2026-11-06）：临时 worker 实测 1 分钟邮箱提醒、`peer_mail list/read` 与 `peer_interrupt` steer 信封均按预期（当时还是独立工具）；`force`/归档由 host 测试覆盖。
