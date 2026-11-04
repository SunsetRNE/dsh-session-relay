/** 测试用原始事件（形状与 DSH 原始日志一致）。 */
const text = (value) => [{ type: 'text', text: value }]

/** 两轮的原始日志：第 1 轮正常，第 2 轮改文件后因空响应出错。形状与 DSH 原始日志一致。 */
export function sampleEvents() {
  let seq = 0
  const ev = (type, data) => ({ type, seq: seq++, time: 1_700_000_000_000 + seq * 1000, data })
  return [
    ev('session', { id: 'session-x', cwd: '/w', agentPreset: 'standard' }),
    ev('agent-preset/selected', { agentPreset: 'cordis' }),
    ev('turn/start', { turn: 1 }),
    ev('step/start', { turn: 1, step: 1 }),
    ev('user/message', { content: text('找回协作插件'), source: { kind: 'user' }, role: 'user' }),
    ev('user/message', { content: text('运行时上下文 cwd=/w'), source: { kind: 'runtime-context' }, role: 'user' }),
    ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '先列插件' }, { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] } }),
    ev('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'ls /root', description: 'list' }) }),
    ev('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', content: text('dsha-session-relay'), isError: false } }),
    ev('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'session_search', arguments: JSON.stringify({ query: '协作' }) }),
    ev('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c2', content: text('Error: tool call timed out after 30000ms'), isError: true }, error: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } }),
    ev('assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: text('插件已找回。') } }),
    ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ev('turn/start', { turn: 2 }),
    ev('user/message', { content: text('压缩面板布局'), source: { kind: 'user' }, role: 'user' }),
    ev('tool/call', { turn: 2, step: 1, callId: 'c3', name: 'edit', arguments: JSON.stringify({ file_path: '/w/lib/client.js', old_string: 'a{x:1}', new_string: 'a{x:2}\n.fold{y:1}' }) }),
    ev('tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'c3', content: text('ok'), isError: false } }),
    ev('tool/call', { turn: 2, step: 1, callId: 'c4', name: 'edit', arguments: JSON.stringify({ file_path: '/w/lib/core.js', old_string: 'zz', new_string: 'yy' }) }),
    ev('tool/result', { turn: 2, step: 1, message: { role: 'tool', toolCallId: 'c4', content: text('old_string not found'), isError: true } }),
    ev('llm/retry', { turn: 2, step: 2 }),
    ev('llm/retry', { turn: 2, step: 2 }),
    ev('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'model returned a completed response with no content', code: 'EMPTY_RESPONSE' } } })
  ]
}

