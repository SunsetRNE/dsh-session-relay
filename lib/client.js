window.__ModuleLoader__.load({ id: 'dsh-session-relay', factory: (require) => {
  'use strict';
  /*
   * dsh-session-relay 网页端（改这个文件需要重启 DSH）：
   * - 设置 → 会话协作：版本线公告、指令模板、命令速查、插件状态与热重载；
   * - 会话里“对话 / 轨迹”旁的「协作」标签：本会话身份、版本线、当前工作区（或全部）的看板与操作；
   * - 侧栏「会话监督」面板：同一套看板的全局视角；
   * - 侧栏会话行状态点、悬停卡片里的会话 ID 与协作状态；
   * - 会话页头的 ID 标签：常驻显示别名 / id 前 8 位，点一下复制完整 id。
   *
   * 数据全部走本插件的 Host 路由 /api/dsha-session-relay；只用 --dsw-alias-* 主题变量。
   */
  const React = require('react');
  const h = React.createElement;

  const NS = 'dsha.sessionRelay';
  const ROUTE = '/api/dsha-session-relay';
  const STYLE_ID = 'dsh-session-relay/ui.css';
  const PANEL_ID = 'session-relay';

  const zh = {
    nav: '会话协作',
    panel: '会话监督',
    intro: '协作以侧栏的“工作区”为单位：每个工作区各有自己的主会话、版本线和看板。这里保存的内容，和在会话里用 /relay line、/relay tpl 保存的是同一份。',
    lineTitle: '版本线公告',
    lineHint: '每个工作区一条。写当前基线、下一个构建号给谁、推送规则等。保存后这个工作区的全部会话每一步都能看到（不会唤醒空闲会话），别的工作区看不到。每次保存都是整段替换。',
    lineWsMain: '主会话：{label}',
    lineWsNoMain: '还没有主会话',
    lineWsCount: '{n} 个会话',
    lineWsGone: '这个工作区已不在侧栏',
    linePlaceholder: 'main=build280（f55e3b3c）；下一个号 build281 给 adb-reopen；push 加 -c http.curloptResolve=github.com:443:140.82.114.4，推前跑 lintStandardRelease',
    lineEmpty: '还没有公告',
    lineSetBy: '最后设定：{time}（{who}）',
    whoUser: '你',
    whoModel: '主会话模型',
    save: '保存',
    clear: '清除',
    tplTitle: '指令模板',
    tplHint: '把常用的长指令存成模板，开新会话时只要发一行命令。',
    tplEmpty: '还没有模板。点“新建模板”把常用指令存进来。',
    tplNew: '新建模板',
    tplName: '模板名',
    tplNameHint: '小写字母、数字、. _ -，最多 32 位，例如 claim',
    tplText: '指令正文',
    tplTextHint: '可以换行。使用时命令里写的补充内容会附在正文后面。',
    edit: '编辑',
    remove: '删除',
    confirmRemove: '确认删除',
    cancel: '取消',
    copyUse: '复制用法',
    copied: '已复制：{text}',
    copyFailed: '复制失败，请长按选中手动复制',
    usage: '用法',
    refTitle: '命令速查',
    refHint: '每条都能点“复制”直接粘到会话输入框。',
    example: '例子',
    copy: '复制',
    loading: '正在读取…',
    saving: '正在保存…',
    saved: '已保存',
    removed: '已删除',
    lineCleared: '已清除公告',
    denied: '登录状态已失效，请刷新页面后重试。',
    unavailable: '读取失败。如果刚装好或刚更新插件，需要重启 DSH 后才能使用这个页面。',
    failed: '操作失败',
    retry: '重试',
    updated: '更新于 {time}',
    chars: '{n} / {max} 字',
    pluginTitle: '插件状态',
    loaded: '已加载 {v}（第 {g} 次加载，{time}）',
    disk: '磁盘上 {v}',
    needsRestart: '外壳或界面有改动，需要重启 DSH 才能生效。',
    reloadHint: '逻辑改动不用重启：点“重新加载”即可换上磁盘上的新代码。',
    reload: '重新加载',
    reloading: '正在重新加载…',
    // 面板
    mainNone: '还没有主会话',
    mainIs: '主会话：{label}',
    openSession: '打开',
    reply: '回复',
    replyPlaceholder: '发给这个会话的话（按你的指令送达）',
    send: '发送',
    sent: '已送达',
    setMain: '设为主会话',
    leave: '退出协作',
    confirmLeave: '确认退出',
    boardEmpty: '看板为空：用 /relay new 或下面的“新建空白会话”开工作会话。',
    restartTitle: '重启时机',
    restartStart: '等所有会话空闲后提醒我',
    restartCancel: '取消等待',
    tasksTitle: '任务状态',
    tasksSummary: '谁在做、谁已失效、是否已合入、可归档',
    tasksHint: '对照 TASKS.md、claims 认领目录、origin/main（只读）与持有者会话；展开时读取一次，不自动刷新。与 /relay tasks 相同。',
    tasksRefresh: '刷新',
    tasksArchivePreview: '预览归档',
    tasksArchiveApply: '执行归档',
    foldClaimSum: '待认领 {n} 个',
    foldDeclSum: '活跃 {active} · 不一致 {mismatches}',
    foldOthersSum: '{n} 个会话',
    catAttention: '需要处理',
    foldCatSum: '{n} 个',
    watchTitle: '核验',
    foldWatchSum: '进行中 {n} 项',
    watchHint: '插件替主会话盯 CI 任务和远端分支 sha（只读 gh / git），结果变化时通知主会话并发手机通知；DSH 重启后会补查。主会话用 peer_watch 登记，你可以用 /relay watch ci <run_id> 或 /relay watch ref <分支> [sha]。',
    watchCancel: '取消',
    watchCancelled: '已取消核验',
    watchEmpty: '没有核验项',
    cardMore: '展开',
    cardLess: '收起',
    conflictCount: '⚠ {n} 处占用重叠 / 声明问题，展开查看',
    catReady: '可合并',
    catActive: '进行中',
    catIdle: '久未活动',
    catBlank: '空白',
    catHint: '插件按事实分类（git、工作树声明、会话运行状态），不只看会话自己的汇报。',
    archiveTitle: '归档',
    foldArchiveSum: '{n} 个，已从主会话上下文收起',
    archiveHint: '已合入、已完成、提交本机已不存在、前任主会话、已删除的会话。它们不再进主会话上下文，也不排队、不算占用重叠；「退出协作」会从看板删除。',
    why_merged: '已合入 main',
    why_missing: '提交本机已不存在',
    'why_former-main': '前任主会话',
    why_done: '已完成',
    why_abandoned: '已放弃',
    why_gone: '会话已删除 / 归档',
    why_failed: '最后一轮出错',
    why_heavy: '上下文过大',
    why_question: '待答复',
    why_blocked: '受阻',
    foldOpenSum: '不发指令、不消耗 token',
    foldRestartWatching: '正在等待空闲',
    foldRestartIdle: '空闲后提醒可以重启',
    openTitle: '新建空白会话',
    openHint: '只建会话、不发任何内容，不消耗 token；建好后直接跳过去，第一句由你来写。',
    alias: '别名（可选）',
    cwd: '工作目录',
    join: '登记为工作会话（一开始就能看到版本线和汇报方式）',
    create: '新建并打开',
    created: '已新建 {label}',
    branch: '分支 {v}',
    commit: '提交 {v}',
    files: '占用：{v}',
    question: '问题：{v}',
    lastTurn: '最近一轮：{v}',
    stateRunning: '运行中',
    stateIdle: '空闲',
    stateCold: '未加载',
    stateGone: '已不存在',
    status_working: '进行中',
    status_blocked: '受阻',
    status_question: '待答复',
    status_ready: '可合并',
    status_done: '已完成',
    status_abandoned: '已放弃',
    status_main: '主会话',
    tab: '协作',
    selfTitle: '本会话',
    selfNotJoined: '本会话还没加入协作：不在看板上，也看不到版本线。',
    selfObserver: '本会话没加入协作：能看到本工作区的版本线，但不用汇报、不在看板上。',
    selfMainElsewhere: '本会话是另一个工作区的主会话。',
    othersTitle: '本工作区其它会话（未加入协作）',
    othersHint: '侧栏登记在这个工作区、但没加入看板的会话。它们能看到版本线；加入后才会汇报。',
    othersMore: '另有 {n} 个较早的会话没列出',
    optedOut: '已退出协作',
    joinThis: '加入协作',
    joinSelf: '加入协作',
    leaveSelf: '退出协作',
    thisSession: '本会话',
    scopeWorkspace: '当前工作区',
    scopeAll: '全部',
    scopeHidden: '另有 {n} 个工作会话在其它工作区',
    inWorkspace: '工作区 {v}',
    status_joined: '已加入协作',
    answered: '已答复',
    conflict: '⚠ 占用重叠：与 {label} 都在改 {paths}',
    declOf: '声明：{rel} · {kind} · 合并：{merge}',
    declActive: '活跃',
    declDone: '已结束',
    declMore: '（另有 {n} 份）',
    declTitle: '工作树声明',
    declHint: '只读对照 .agents/worktrees 下的 .ACTIVE-SESSION / .SESSION-DONE 与任务认领；合并、发布以声明为准。插件不改任何声明文件。',
    declCounts: '活跃 {active} · 不一致 {mismatches} · 可合并待排号 {candidates} · 待推送 {pending} · 已合入未交还 {merged} · 持有者已不在 {orphans} · 无声明工作树 {undeclared}',
    hoAuto: '插件整理草稿',
    hoAutoDone: '插件已整理草稿，看一下再确认',
    hoByPlugin: '插件整理',
    hoFailed: '{text}。用「插件整理草稿」从它最近几轮记录整理，或自己写。',
    takeover: '交接',
    toTitle: '把 {label} 的工作交给',
    toNew: '新建会话接手',
    toExisting: '已有会话',
    toAlias: '接手方别名（可空；原别名会移过去）',
    toNote: '补充说明（可空）',
    toQueue: '只放进收件箱，我自己去说第一句',
    toHint: '插件会带上它的看板记录、工作树声明、任务认领和最近两轮对话；它正在运行时不能交接。',
    toConfirm: '确认交接',
    toDone: '已交接给 {label}',
    toRunning: '交接（运行中）',
    toBusy: '{who}还在运作：{why}。停下后才能交接。',
    toIdle: '{who}已停下，可以交接。',
    toChecking: '正在检查{who}是否还在运作…',
    toSource: '原会话',
    toTarget: '接手方',
    toNotes: '注意：{v}',
    optRunning: '（运行中）',
    wake: '唤醒',
    wakeRunning: '唤醒（运行中）',
    wakeTitle: '唤醒 {label}',
    wakeAuto: '自动判断',
    wakeResume: '原地唤醒',
    wakeNew: '新建会话接手',
    wakeChecking: '正在预判…',
    wakeWill: '会这样做：{v}',
    wakeWillResume: '原地唤醒（{why}）',
    wakeWillNew: '新建会话接手（{why}）',
    wakeMain: '它是主会话：换新请用交接区的「插件整理草稿」再确认；要原地唤醒选「原地唤醒」。',
    wakeAlias: '接手方别名（可空，只在新建时用）',
    wakeNote: '补充说明（可空，附在消息后面）',
    wakeHint: '原地唤醒会替你发一条「继续」，让它先只读核对声明、git 和后台任务再接着做；新建接手走交接流程，原会话只收到停手通知。',
    wakeConfirm: '确认唤醒',
    wakeDoneResume: '已唤醒 {label}',
    wakeDoneNew: '已新建 {label} 接手',
    pinTitle: '侧栏自动置顶',
    pinLabel: '本工作区自动置顶主会话和还在做的会话',
    pinHint: '默认关闭。开启后主会话排最上面，加入了协作、还在做的会话跟在后面，做完自动取消；没加入协作的和空白会话不置顶；你手动置顶的不会被取消。关闭只撤掉插件加的置顶。',
    pinOwned: '插件当前置顶了 {n} 个会话',
    pinOn: '已开启自动置顶',
    pinOff: '已关闭自动置顶',
    claimTitle: '拉起认领会话',
    claimHint: '新建一个会话去认领任务看板里的任务。首条消息由插件写好：它的身份、看板路径、认领方式和边界；不用自己写指令。认领成功后它会用 peer_report 汇报。',
    claimTask: '认领哪个任务',
    claimAny: '最高优先的待认领任务',
    claimNone: '看板上没有待认领的任务',
    claimBoard: '看板：{file}',
    claimGo: '拉起并认领',
    claimDone: '已拉起 {label} 去认领',
    declMain: 'main 已到：{build}（{sha} · {subject}）',
    declReleased: '已发布：{build}（{tag}）{gap}',
    declReleasedNone: '已发布：本机没有发布 tag',
    declGap: ' · {range} 已进 main、未见发布 tag',
    declExtra: '已在 main 待补「已合入」{landed} · 占用重叠 {overlaps} · 后台任务需看 {bg}',
    declShow: '展开明细',
    declHide: '收起明细',
    queueNo: '队列 #{n}',
    assignedTo: '已分配 {v}',
    assign: '分配编号',
    assignPlaceholder: 'build281',
    assignSend: '分配并提醒',
    assigned: '已分配',
    hoTitle: '主会话交接',
    hoHint: '主会话上下文快满、或要换人核定版本线时用。确认后插件一次完成：设新主会话、把交接说明和快照发给接手方、通知旧主会话卸任。模型只能起草，只有你能确认。',
    hoNoDraft: '还没有交接草稿。',
    hoAsk: '让主会话起草',
    hoAsked: '已请主会话起草，写好后会出现在这里',
    hoWrite: '自己写',
    hoDraftBy: '草稿：{who}写，{time}',
    hoByModel: '主会话模型',
    hoByUser: '你',
    hoNotes: '交接说明（状态、下一步、不要做的事、未决问题）',
    hoSave: '保存草稿',
    hoDiscard: '丢弃草稿',
    hoSnapshot: '确认时会自动附上的快照',
    hoShowSnapshot: '看快照',
    hoHideSnapshot: '收起快照',
    hoTarget: '接手方',
    hoTargetNew: '新建会话',
    hoTargetExisting: '已有会话',
    hoAlias: '新会话别名（可选）',
    hoPick: '选择会话',
    hoQueue: '先不唤醒：交接说明放进收件箱，我去说第一句',
    hoConfirm: '确认交接',
    hoConfirmAgain: '再点一次确认：{target} 成为主会话',
    hoDone: '交接完成：{label} 是新主会话',
    hoNoMain: '这个工作区还没有主会话；交接等于直接指定一个。',
    hoHistory: '最近交接',
    hoRevert: '设回主会话',
    workspaceIs: '工作区：{v}',
    sessionId: '会话 ID',
    copyId: '复制会话 ID',
    idCopied: '已复制会话 ID'
  };
  const en = {
    nav: 'Session relay',
    panel: 'Session board',
    intro: 'Collaboration is scoped to each sidebar workspace: every workspace has its own main session, version line and board. This is the same storage as /relay line and /relay tpl.',
    lineTitle: 'Version line',
    lineHint: 'One per workspace. The current baseline, which branch gets the next build number, push rules. Every session in that workspace sees it at each step (idle sessions are not woken); other workspaces do not. Saving replaces the whole notice.',
    lineWsMain: 'Main: {label}',
    lineWsNoMain: 'No main session',
    lineWsCount: '{n} sessions',
    lineWsGone: 'No longer in the sidebar',
    linePlaceholder: 'main=build280 (f55e3b3c); build281 goes to adb-reopen; push with -c http.curloptResolve=github.com:443:140.82.114.4 and run lintStandardRelease first',
    lineEmpty: 'No notice yet',
    lineSetBy: 'Last set {time} ({who})',
    whoUser: 'you',
    whoModel: 'main session agent',
    save: 'Save',
    clear: 'Clear',
    tplTitle: 'Instruction templates',
    tplHint: 'Store long instructions you reuse, then start a session with one short command.',
    tplEmpty: 'No templates yet. Use “New template” to store one.',
    tplNew: 'New template',
    tplName: 'Name',
    tplNameHint: 'Lowercase letters, digits, . _ -; up to 32 characters, e.g. claim',
    tplText: 'Instruction',
    tplTextHint: 'Line breaks are kept. Extra text in the command is appended after it.',
    edit: 'Edit',
    remove: 'Delete',
    confirmRemove: 'Confirm delete',
    cancel: 'Cancel',
    copyUse: 'Copy usage',
    copied: 'Copied: {text}',
    copyFailed: 'Copy failed; long-press to copy it',
    usage: 'Usage',
    refTitle: 'Command reference',
    refHint: 'Use Copy to paste a command straight into a session.',
    example: 'Example',
    copy: 'Copy',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved',
    removed: 'Deleted',
    lineCleared: 'Notice cleared',
    denied: 'Your session has expired. Refresh the page and try again.',
    unavailable: 'Could not load. If the plugin was just installed or updated, restart DSH to use this page.',
    failed: 'Failed',
    retry: 'Retry',
    updated: 'Updated {time}',
    chars: '{n} / {max}',
    pluginTitle: 'Plugin status',
    loaded: 'Loaded {v} (load #{g}, {time})',
    disk: 'On disk {v}',
    needsRestart: 'The shell or UI changed; restart DSH to apply it.',
    reloadHint: 'Logic changes need no restart: use Reload to load the new code on disk.',
    reload: 'Reload',
    reloading: 'Reloading…',
    mainNone: 'No main session yet',
    mainIs: 'Main session: {label}',
    openSession: 'Open',
    reply: 'Reply',
    replyPlaceholder: 'Message for this session (delivered as your instruction)',
    send: 'Send',
    sent: 'Delivered',
    setMain: 'Make main',
    leave: 'Leave',
    confirmLeave: 'Confirm leave',
    boardEmpty: 'The board is empty: start worker sessions with /relay new or “New blank session” below.',
    restartTitle: 'Restart window',
    restartStart: 'Tell me when every session is idle',
    restartCancel: 'Stop waiting',
    tasksTitle: 'Task status',
    tasksSummary: 'Who is on what, dead holders, merged or not, archivable',
    tasksHint: 'Reconciles TASKS.md, the claims folders, origin/main (read-only) and holder sessions; read once on expand, no polling. Same as /relay tasks.',
    tasksRefresh: 'Refresh',
    tasksArchivePreview: 'Preview archive',
    tasksArchiveApply: 'Archive now',
    foldClaimSum: '{n} unclaimed',
    foldDeclSum: '{active} active · {mismatches} mismatched',
    foldOthersSum: '{n} sessions',
    catAttention: 'Needs attention',
    foldCatSum: '{n}',
    watchTitle: 'Watches',
    foldWatchSum: '{n} active',
    watchHint: 'The plugin watches CI runs and remote branch shas for the main session (read-only gh / git), notifies it and the phone when the result changes, and re-checks after a DSH restart. The main session adds them with peer_watch; you can use /relay watch ci <run_id> or /relay watch ref <branch> [sha].',
    watchCancel: 'Cancel',
    watchCancelled: 'Watch cancelled',
    watchEmpty: 'No watches',
    cardMore: 'More',
    cardLess: 'Less',
    conflictCount: '⚠ {n} overlap / declaration issues, expand to see',
    catReady: 'Mergeable',
    catActive: 'In progress',
    catIdle: 'Idle',
    catBlank: 'Blank',
    catHint: 'Classified by the plugin from facts (git, worktree declarations, session state), not only from what sessions report.',
    archiveTitle: 'Archive',
    foldArchiveSum: '{n}, hidden from the main session context',
    archiveHint: 'Merged, finished, missing-commit, former-main and deleted sessions. They no longer enter the main session context, queue or overlap checks; “Leave” removes them from the board.',
    why_merged: 'merged into main',
    why_missing: 'commit missing locally',
    'why_former-main': 'former main session',
    why_done: 'done',
    why_abandoned: 'abandoned',
    why_gone: 'session deleted / archived',
    why_failed: 'last turn failed',
    why_heavy: 'context too large',
    why_question: 'awaiting reply',
    why_blocked: 'blocked',
    foldOpenSum: 'No instruction, no tokens',
    foldRestartWatching: 'Waiting for idle',
    foldRestartIdle: 'Notify when safe to restart',
    openTitle: 'New blank session',
    openHint: 'Creates a session without sending anything, so it costs no tokens; opens it so you write the first message.',
    alias: 'Alias (optional)',
    cwd: 'Working directory',
    join: 'Register as a worker (sees the version line and how to report from the start)',
    create: 'Create and open',
    created: 'Created {label}',
    branch: 'branch {v}',
    commit: 'commit {v}',
    files: 'Files: {v}',
    question: 'Question: {v}',
    lastTurn: 'Last turn: {v}',
    stateRunning: 'running',
    stateIdle: 'idle',
    stateCold: 'not loaded',
    stateGone: 'gone',
    status_working: 'Working',
    status_blocked: 'Blocked',
    status_question: 'Needs answer',
    status_ready: 'Mergeable',
    status_done: 'Done',
    status_abandoned: 'Abandoned',
    status_main: 'Main session',
    tab: 'Relay',
    selfTitle: 'This session',
    selfNotJoined: 'This session has not joined: it is not on the board and does not see the version line.',
    selfObserver: 'Not joined: this session sees the workspace version line but does not report and is not on the board.',
    selfMainElsewhere: 'This session is the main session of another workspace.',
    othersTitle: 'Other sessions in this workspace (not joined)',
    othersHint: 'Sessions registered in this sidebar workspace that are not on the board. They see the version line; they report only after joining.',
    othersMore: '{n} older sessions not shown',
    optedOut: 'left',
    joinThis: 'Join',
    joinSelf: 'Join',
    leaveSelf: 'Leave',
    thisSession: 'this session',
    scopeWorkspace: 'This workspace',
    scopeAll: 'All',
    inWorkspace: 'workspace {v}',
    status_joined: 'Joined',
    answered: 'Answered',
    conflict: '⚠ Overlapping files with {label}: {paths}',
    declOf: 'Declaration: {rel} · {kind} · merge: {merge}',
    declActive: 'active',
    declDone: 'finished',
    declMore: ' ({n} more)',
    declTitle: 'Worktree declarations',
    declHint: 'Read-only comparison with .ACTIVE-SESSION / .SESSION-DONE under .agents/worktrees and task claims; merges and releases follow the declarations. The plugin never edits them.',
    declCounts: 'Active {active} · mismatched {mismatches} · mergeable, unnumbered {candidates} · pending push {pending} · merged but still active {merged} · holder gone {orphans} · undeclared worktrees {undeclared}',
    hoAuto: 'Draft from records',
    hoAutoDone: 'The plugin drafted it from records; review before confirming',
    hoByPlugin: 'the plugin',
    hoFailed: '{text}. Use “Draft from records” to build a draft from its recent turns, or write one yourself.',
    takeover: 'Hand over',
    toTitle: 'Hand {label}\'s work to',
    toNew: 'A new session',
    toExisting: 'An existing session',
    toAlias: 'Alias for the receiver (optional; existing aliases move over)',
    toNote: 'Extra notes (optional)',
    toQueue: 'Only put it in the inbox; I will say the first sentence',
    toHint: 'The plugin attaches its board entry, worktree declarations, task claims and last two turns. A running session cannot be handed over.',
    toConfirm: 'Confirm handover',
    toDone: 'Handed over to {label}',
    toRunning: 'Hand over (running)',
    toBusy: '{who} is still working: {why}. Handover is possible once it stops.',
    toIdle: '{who} has stopped; ready to hand over.',
    toChecking: 'Checking whether {who} is still working…',
    toSource: 'The source session',
    toTarget: 'The receiver',
    toNotes: 'Note: {v}',
    optRunning: ' (running)',
    wake: 'Wake',
    wakeRunning: 'Wake (running)',
    wakeTitle: 'Wake {label}',
    wakeAuto: 'Decide automatically',
    wakeResume: 'Resume in place',
    wakeNew: 'New session takes over',
    wakeChecking: 'Checking…',
    wakeWill: 'Will do: {v}',
    wakeWillResume: 'resume in place ({why})',
    wakeWillNew: 'start a new session to take over ({why})',
    wakeMain: 'This is the main session: to replace it use “Draft from records” in the handover section, then confirm; choose “Resume in place” to wake it as is.',
    wakeAlias: 'Alias for the new session (optional; only used when a new one is created)',
    wakeNote: 'Extra notes (optional; appended to the message)',
    wakeHint: 'Resuming sends a “continue” for you, asking it to check its declaration, git and background jobs read-only before carrying on. A takeover uses the handover flow; the original only gets a stop notice.',
    wakeConfirm: 'Confirm wake',
    wakeDoneResume: 'Woke {label}',
    wakeDoneNew: 'Created {label} to take over',
    pinTitle: 'Auto-pin in sidebar',
    pinLabel: 'Auto-pin the main session and in-progress sessions of this workspace',
    pinHint: 'Off by default. When on, the main session stays on top with in-progress sessions below it; they are unpinned when done. Your manual pins are never removed. Turning it off removes only the pins the plugin added.',
    pinOwned: 'The plugin has pinned {n} sessions',
    pinOn: 'Auto-pin on',
    pinOff: 'Auto-pin off',
    claimTitle: 'Launch a claiming session',
    claimHint: 'Create a session that claims a task from the task board. The plugin writes its first message: identity, board path, claim rules and limits. It reports with peer_report once it has claimed.',
    claimTask: 'Task to claim',
    claimAny: 'Highest-priority open task',
    claimNone: 'No open tasks on the board',
    claimBoard: 'Board: {file}',
    claimGo: 'Launch and claim',
    claimDone: 'Launched {label} to claim',
    declMain: 'main is at: {build} ({sha} · {subject})',
    declReleased: 'Released: {build} ({tag}){gap}',
    declReleasedNone: 'Released: no release tag on this device',
    declGap: ' · {range} in main, no release tag seen',
    declExtra: 'In main, needs "merged" line {landed} · overlapping files {overlaps} · background jobs to check {bg}',
    declShow: 'Show details',
    declHide: 'Hide details',
    queueNo: 'Queue #{n}',
    assignedTo: 'Assigned {v}',
    assign: 'Assign number',
    assignPlaceholder: 'build281',
    assignSend: 'Assign and notify',
    assigned: 'Assigned',
    hoTitle: 'Main-session handoff',
    hoHint: 'Use when the main session is running out of context or someone else should own the version line. Confirming makes the new main session, sends it the notes plus a snapshot, and tells the old one to step down. Agents can only draft; only you confirm.',
    hoNoDraft: 'No handoff draft yet.',
    hoAsk: 'Ask main to draft',
    hoAsked: 'Asked the main session to draft; it will appear here',
    hoWrite: 'Write it myself',
    hoDraftBy: 'Draft by {who}, {time}',
    hoByModel: 'main session agent',
    hoByUser: 'you',
    hoNotes: 'Handoff notes (state, next steps, what not to do, open questions)',
    hoSave: 'Save draft',
    hoDiscard: 'Discard draft',
    hoSnapshot: 'Snapshot attached on confirm',
    hoShowSnapshot: 'Show snapshot',
    hoHideSnapshot: 'Hide snapshot',
    hoTarget: 'Successor',
    hoTargetNew: 'New session',
    hoTargetExisting: 'Existing session',
    hoAlias: 'Alias for the new session (optional)',
    hoPick: 'Pick a session',
    hoQueue: 'Do not wake it: put the notes in its inbox and I will write first',
    hoConfirm: 'Confirm handoff',
    hoConfirmAgain: 'Click again: {target} becomes main',
    hoDone: 'Handoff done: {label} is the new main session',
    hoNoMain: 'This workspace has no main session; the handoff simply appoints one.',
    hoHistory: 'Recent handoffs',
    hoRevert: 'Make main again',
    scopeHidden: '{n} more worker sessions in other workspaces',
    workspaceIs: 'Workspace: {v}',
    sessionId: 'Session ID',
    copyId: 'Copy session ID',
    idCopied: 'Session ID copied'
  };

  const css = [
    '.dshaSr{display:grid;gap:24px;color:var(--dsw-alias-label-primary);container-type:inline-size}',
    '.dshaSr_intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}',
    '.dshaSr_sec{display:grid;gap:10px}',
    '.dshaSr_h{margin:0;font-size:15px;font-weight:600;line-height:1.4}',
    '.dshaSr_hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}',
    '.dshaSr_card{display:grid;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
    '.dshaSr_label{font-size:13px;font-weight:500}',
    '.dshaSr_input,.dshaSr_area{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}',
    '.dshaSr_area{min-height:96px;resize:vertical;font-family:inherit;white-space:pre-wrap}',
    '.dshaSr_input:focus-visible,.dshaSr_area:focus-visible,.dshaSr_btn:focus-visible,.dshaSr_chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dshaSr_row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.dshaSr_spacer{flex:1 1 auto}',
    '.dshaSr_btn{appearance:none;min-height:32px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
    '.dshaSr_btn[data-variant=primary]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
    '.dshaSr_btn[data-variant=danger]{color:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_btn:disabled{opacity:.5;cursor:default}',
    '.dshaSr_meta{color:var(--dsw-alias-label-secondary);font-size:12px}',
    '.dshaSr_status{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}',
    '.dshaSr_status[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_status[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_tname{font-weight:600;font-size:14px}',
    '.dshaSr_pre{margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:9.5em;overflow:auto}',
    '.dshaSr_code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-word}',
    '.dshaSr_notes{margin:0;padding-left:18px;display:grid;gap:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}',
    '.dshaSr_group{display:grid;gap:8px}',
    '.dshaSr_gtitle{margin:4px 0 0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
    '.dshaSr_item{display:grid;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
    '.dshaSr_ex{display:flex;align-items:flex-start;gap:8px}',
    '.dshaSr_ex .dshaSr_pre{flex:1 1 auto;min-width:0}',
    '.dshaSr_toast{position:sticky;top:0;z-index:1;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1)}',
    // 面板
    '.dshaSr_page{box-sizing:border-box;height:100%;overflow:auto;container-type:inline-size;color:var(--dsw-alias-label-primary)}',
    // 出错兜底页没有 pageIn，直接给留白
    '.dshaSr_page>.dshaSr_card{margin:12px 16px}',
    // 折叠分区里由 Fold 显示标题，原分区自己的标题与说明隐藏（仍被 aria-labelledby 引用）
    '.dshaSr_foldBody>.dshaSr_sec>.dshaSr_h{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.dshaSr_fold{display:grid;gap:6px;min-width:0;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}',
    '.dshaSr_title{margin:0;font-size:18px;font-weight:600}',
    '.dshaSr_badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
    '.dshaSr_badge[data-status=question]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
    '.dshaSr_badge[data-status=blocked]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_badge[data-status=ready],.dshaSr_badge[data-status=done]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_badge[data-status=main]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
    '.dshaSr_entryHead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}',
    '.dshaSr_entryName{font-weight:600;font-size:14px;min-width:0;overflow-wrap:anywhere}',
    '.dshaSr_check{display:flex;align-items:flex-start;gap:8px;font-size:13px}',
    // 状态点、页头 ID 标签、悬停卡片
    '.dshaSr_dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}',
    '.dshaSr_dot[data-status=question]{background:var(--dsw-alias-state-warn-primary)}',
    '.dshaSr_dot[data-status=blocked]{background:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_dot[data-status=ready]{background:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_dot[data-status=working]{background:transparent;border:1.5px solid var(--dsw-alias-state-idle-primary);box-sizing:border-box}',
    '.dshaSr_star{font-size:11px;line-height:1;color:var(--dsw-alias-brand-primary)}',
    '.dshaSr_starIcon{display:block;flex:none;color:var(--dsw-alias-brand-primary)}',
    '.dshaSr_dot[data-status=joined]{background:transparent;border:1.5px solid var(--dsw-alias-state-idle-primary);box-sizing:border-box}',
    '.dshaSr_dot[data-status=done]{background:var(--dsw-alias-label-tertiary,var(--dsw-alias-state-idle-primary));opacity:.6}',
    '.dshaSr_radio{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}',
    '.dshaSr_radio label{display:inline-flex;align-items:center;gap:6px}',
    '.dshaSr_lead{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}',
    '.dshaSr_chip{appearance:none;display:inline-flex;align-items:center;gap:4px;max-width:180px;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dshaSr_chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
    '.dshaSr_chip[data-copied=true]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_hover{display:grid;gap:2px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
    '.dshaSr_hover code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-all}',
    '.dshaSr_icon{position:relative;display:inline-flex}',
    '.dshaSr_iconBadge{position:absolute;top:-4px;right:-6px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);font-size:10px;line-height:14px;text-align:center}',
    '.dshaSr_seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
    '.dshaSr_seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:4px 10px;min-height:28px;cursor:pointer}',
    '.dshaSr_seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}',
    '.dshaSr_card[data-self=true]{border-color:var(--dsw-alias-brand-primary)}',
    '.dshaSr_idline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}',
    // 紧凑布局：外层负责滚动并作为容器查询的参照；宽容器分两栏，窄容器单栏
    '.dshaSr_pageIn{box-sizing:border-box;max-width:1280px;margin:0 auto;padding:12px 16px 32px;display:grid;gap:10px;align-content:start;min-width:0}',
    '.dshaSr_cols{display:grid;gap:10px;align-items:start;grid-template-columns:minmax(0,1fr)}',
    '.dshaSr_col{display:grid;gap:10px;align-content:start;min-width:0}',
    '.dshaSr_catGroup{display:flex;flex-direction:column;gap:6px;margin-top:4px}',
    '.dshaSr_clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.dshaSr_catHead{margin:6px 0 0;font-size:12px;font-weight:600;opacity:.8}',
    '.dshaSr_catGroup[data-cat="attention"] .dshaSr_catHead{color:var(--dshaSr-error,#d14343);opacity:1}',
    '.dshaSr_entries{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));align-items:start}',
    '.dshaSr_page .dshaSr_sec{gap:6px}',
    '.dshaSr_page .dshaSr_card{gap:6px;padding:10px 12px}',
    '.dshaSr_page .dshaSr_area{min-height:72px}',
    // 折叠分区
    '.dshaSr_foldHead{display:flex;align-items:center;gap:6px;min-width:0}',
    '.dshaSr_foldTitle{flex:1 1 auto;min-width:0;margin:0;font-size:14px;font-weight:600;line-height:1.4}',
    '.dshaSr_foldBtn{appearance:none;display:flex;flex-wrap:wrap;align-items:center;column-gap:6px;width:100%;min-height:32px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}',
    '.dshaSr_foldBtn:focus-visible,.dshaSr_iconBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:6px}',
    '.dshaSr_chev{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .15s}',
    '.dshaSr_fold[data-open=true] .dshaSr_chev{transform:rotate(90deg)}',
    '.dshaSr_foldName{flex:0 1 auto;min-width:0}',
    '.dshaSr_foldSum{flex:1 1 8em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}',
    '.dshaSr_foldSum[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_foldActs{display:flex;align-items:center;gap:6px;flex:none}',
    '.dshaSr_foldBody{display:grid;gap:6px;min-width:0}',
    '.dshaSr_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
    '.dshaSr_iconBtn[aria-pressed=true]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l2)}',
    '.dshaSr_link{appearance:none;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;justify-self:start}',
    '.dshaSr_link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
    '.dshaSr_clamp{max-height:4.8em;overflow:hidden}',
    '.dshaSr_idchip{max-width:100%;flex:0 1 auto}',
    '.dshaSr_fields{display:grid;gap:6px 10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}',
    '.dshaSr_field{display:grid;gap:4px;min-width:0}',
    '.dshaSr_more{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}',
    '@media (pointer:coarse){.dshaSr_btn{min-height:36px}.dshaSr_chip{height:30px}.dshaSr_seg button{min-height:34px}.dshaSr_iconBtn{width:36px;height:36px}.dshaSr_foldBtn{min-height:40px}.dshaSr_link{min-height:32px}}',
    '@media (prefers-reduced-motion:reduce){.dshaSr_chev{transition:none}}',
    '@container (min-width:760px){.dshaSr_cols{grid-template-columns:minmax(0,3fr) minmax(300px,2fr)}}',
    '@container (max-width:480px){.dshaSr_pageIn{padding:8px 8px 24px;gap:8px}.dshaSr_cols,.dshaSr_col{gap:8px}.dshaSr_page .dshaSr_card{padding:8px 10px}.dshaSr_title{font-size:16px}}',
    // 横屏矮屏（手机横放）：再压一档纵向留白
    '@media (orientation:landscape) and (max-height:520px){.dshaSr_pageIn{padding-top:6px;padding-bottom:16px;gap:8px}.dshaSr_page .dshaSr_area{min-height:56px}.dshaSr_page .dshaSr_pre{max-height:6.5em}}'
  ].join('');

  function ensureStyle() {
    if (typeof document === 'undefined') return () => {};
    if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']') !== null) return () => {};
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-session-relay';
    tag.dataset.pluginCss = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
    return () => tag.remove();
  }

  function format(text, values) {
    return String(text).replace(/\{(\w+)\}/g, (_, key) => (values && key in values ? String(values[key]) : ''));
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const d = new Date(ms);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function shortId(id) {
    return String(id ?? '').replace(/^session-/, '').slice(0, 8);
  }

  /** view 为字符串或 { view, ...参数 }；每个参数单独编码。 */
  async function request(method, body, view, signal) {
    const params = typeof view === 'string' ? { view } : (view ?? {});
    const query = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    const url = query === '' ? ROUTE : `${ROUTE}?${query}`;
    const response = await fetch(url, method === 'GET'
      ? { method: 'GET', credentials: 'same-origin', cache: 'no-store', ...(signal === undefined ? {} : { signal }) }
      : { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(signal === undefined ? {} : { signal }) });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload && payload.ok === true) return payload;
    const code = payload && typeof payload.error === 'string' ? payload.error : (response.status === 404 ? 'unavailable' : 'failed');
    throw Object.assign(new Error(payload?.message ?? code), { code, detail: payload?.message });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch { return false; }
  }

  function errorText(t, error) {
    if (error?.code === 'access-denied') return t('denied');
    if (error?.code === 'unavailable') return t('unavailable');
    return error?.detail ? `${t('failed')}：${error.detail}` : t('failed');
  }

  /* ---------------------------------------------------------------- 状态点数据（共享轮询） */

  function createMarksStore() {
    let snapshot = { marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' };
    const listeners = new Set();
    let timer;
    let inflight = false;
    const emit = () => { for (const listener of listeners) listener(); };
    async function refresh() {
      if (inflight || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      inflight = true;
      try {
        const payload = await request('GET', undefined, 'marks');
        snapshot = { marks: payload.marks ?? {}, aliases: payload.aliases ?? {}, attention: payload.attention ?? 0, coordinator: payload.coordinator ?? null, restart: payload.restart ?? 'off' };
        emit();
      } catch {} finally { inflight = false; }
    }
    function start() {
      if (timer !== undefined) return;
      void refresh();
      timer = setInterval(() => { void refresh(); }, 15000);
    }
    function stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    }
    return {
      subscribe(listener) {
        listeners.add(listener);
        start();
        return () => { listeners.delete(listener); if (listeners.size === 0) stop(); };
      },
      getSnapshot: () => snapshot,
      refresh,
      dispose: () => { stop(); listeners.clear(); }
    };
  }

  function useStore(store) {
    if (typeof React.useSyncExternalStore === 'function') return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [, setTick] = React.useState(0);
    React.useEffect(() => store.subscribe(() => setTick((value) => value + 1)), [store]);
    return store.getSnapshot();
  }

  /* ---------------------------------------------------------------- 小部件 */

  function Button(props) {
    return h('button', { type: 'button', className: 'dshaSr_btn', 'data-variant': props.variant, disabled: props.disabled, onClick: props.onClick, 'aria-label': props.label, 'aria-expanded': props['aria-expanded'] }, props.children);
  }

  /** 状态行：没内容时不渲染，避免在页面顶部留空。 */
  function Status(props) {
    if (!props.text) return null;
    return h('div', { className: 'dshaSr_row' },
      h('p', { className: 'dshaSr_status', role: 'status', 'aria-live': 'polite', 'data-tone': props.tone }, props.text),
      props.onRetry ? h(Button, { onClick: props.onRetry }, props.retryText) : null);
  }

  function useFlash() {
    const [status, setStatus] = React.useState({ text: '', tone: undefined });
    const timer = React.useRef();
    React.useEffect(() => () => clearTimeout(timer.current), []);
    const flash = React.useCallback((text, tone, sticky) => {
      clearTimeout(timer.current);
      setStatus({ text, tone });
      if (!sticky && tone !== 'error') timer.current = setTimeout(() => setStatus({ text: '', tone: undefined }), 4000);
    }, []);
    return [status, flash];
  }

  /* ---------------------------------------------------------------- 设置页 */

  /** 每个工作区一条版本线（侧栏登记的工作区为准）；旧服务端没有 groups 时退回单条。 */
  function LineSection({ t, data, run, busy }) {
    const id = React.useId();
    const groups = Array.isArray(data.groups) && data.groups.length > 0 ? data.groups : null;
    if (groups === null) return h(LineEditor, { t, data, run, busy, line: data.line, workspaceId: undefined, head: null });
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('lineTitle')),
      h('p', { className: 'dshaSr_hint' }, t('lineHint')),
      ...groups.map((group) => h(LineEditor, {
        key: group.id, t, data, run, busy, line: group.line, workspaceId: group.id, bare: true,
        head: h('div', { className: 'dshaSr_entryHead' },
          group.coordinator ? h(StarIcon, { size: 12 }) : null,
          h('span', { className: 'dshaSr_entryName' }, group.title),
          h('span', { className: 'dshaSr_meta' }, group.registered ? format(t('lineWsCount'), { n: group.count }) : t('lineWsGone')),
          h('span', { className: 'dshaSr_spacer' }),
          h('span', { className: 'dshaSr_meta' }, group.coordinator ? format(t('lineWsMain'), { label: group.coordinator.label }) : t('lineWsNoMain'))),
        sub: group.path ? h('span', { className: 'dshaSr_meta' }, group.path) : null
      }))
    );
  }

  function LineEditor({ t, data, run, busy, line, workspaceId, head, sub, bare }) {
    const id = React.useId();
    const current = line?.text ?? '';
    const [draft, setDraft] = React.useState(current);
    React.useEffect(() => { setDraft(current); }, [current]);
    const max = data.limits?.line ?? 1500;
    const dirty = draft.trim() !== current;
    const who = line?.setBy === 'user' ? t('whoUser') : t('whoModel');
    const target = workspaceId === undefined ? {} : { workspaceId };
    const card = h('div', { className: 'dshaSr_card' },
        head, sub,
        h('textarea', {
          id: id + '-text', className: 'dshaSr_area', value: draft, maxLength: max, rows: 4,
          placeholder: t('linePlaceholder'), 'aria-label': t('lineTitle'),
          onChange: (event) => setDraft(event.target.value)
        }),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta' }, line ? format(t('lineSetBy'), { time: formatTime(line.setAt), who }) : t('lineEmpty')),
          h('span', { className: 'dshaSr_spacer' }),
          h('span', { className: 'dshaSr_meta' }, format(t('chars'), { n: draft.length, max })),
          line ? h(Button, { variant: 'danger', disabled: busy, onClick: () => run({ action: 'line-clear', ...target }, t('lineCleared')) }, t('clear')) : null,
          h(Button, { variant: 'primary', disabled: busy || !dirty || draft.trim() === '', onClick: () => run({ action: 'line', text: draft, ...target }, t('saved')) }, t('save'))
        )
      );
    if (bare) return card;
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('lineTitle')),
      h('p', { className: 'dshaSr_hint' }, t('lineHint')),
      card);
  }

  function TemplateEditor({ t, initial, onSave, onCancel, busy, max }) {
    const id = React.useId();
    const [name, setName] = React.useState(initial?.name ?? '');
    const [text, setText] = React.useState(initial?.text ?? '');
    const validName = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(name.trim().toLowerCase());
    return h('div', { className: 'dshaSr_card' },
      h('label', { className: 'dshaSr_label', htmlFor: id + '-name' }, t('tplName')),
      h('input', { id: id + '-name', className: 'dshaSr_input', value: name, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'claim', 'aria-describedby': id + '-nh', onChange: (event) => setName(event.target.value) }),
      h('p', { id: id + '-nh', className: 'dshaSr_hint' }, t('tplNameHint')),
      h('label', { className: 'dshaSr_label', htmlFor: id + '-text' }, t('tplText')),
      h('textarea', { id: id + '-text', className: 'dshaSr_area', value: text, maxLength: max, rows: 6, 'aria-describedby': id + '-th', onChange: (event) => setText(event.target.value) }),
      h('p', { id: id + '-th', className: 'dshaSr_hint' }, t('tplTextHint')),
      h('div', { className: 'dshaSr_row' },
        h('span', { className: 'dshaSr_spacer' }),
        h(Button, { disabled: busy, onClick: onCancel }, t('cancel')),
        h(Button, { variant: 'primary', disabled: busy || !validName || text.trim() === '', onClick: () => onSave(name.trim().toLowerCase(), text) }, t('save'))
      )
    );
  }

  function TemplateSection({ t, data, run, busy, copy }) {
    const id = React.useId();
    const [editing, setEditing] = React.useState(undefined);
    const [confirm, setConfirm] = React.useState(undefined);
    const max = data.limits?.text ?? 16000;
    const save = (name, text) => run(
      { action: 'save', name, text, previousName: editing === 'new' ? null : editing, overwrite: editing !== 'new' && editing === name },
      t('saved')
    ).then((ok) => { if (ok) setEditing(undefined); });
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('div', { className: 'dshaSr_row' },
        h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('tplTitle')),
        h('span', { className: 'dshaSr_spacer' }),
        editing === undefined ? h(Button, { variant: 'primary', disabled: busy, onClick: () => setEditing('new') }, t('tplNew')) : null
      ),
      h('p', { className: 'dshaSr_hint' }, t('tplHint')),
      editing === 'new' ? h(TemplateEditor, { t, busy, max, onSave: save, onCancel: () => setEditing(undefined) }) : null,
      data.templates.length === 0 && editing !== 'new' ? h('p', { className: 'dshaSr_hint' }, t('tplEmpty')) : null,
      ...data.templates.map((template) => editing === template.name
        ? h(TemplateEditor, { key: template.name, t, busy, max, initial: template, onSave: save, onCancel: () => setEditing(undefined) })
        : h('div', { key: template.name, className: 'dshaSr_card' },
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_tname' }, template.name),
            h('span', { className: 'dshaSr_meta' }, format(t('updated'), { time: formatTime(template.updatedAt) })),
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { disabled: busy, onClick: () => copy(`/relay new --as ${template.name}1 --tpl ${template.name}`) }, t('copyUse')),
            h(Button, { disabled: busy || editing !== undefined, onClick: () => { setConfirm(undefined); setEditing(template.name); } }, t('edit')),
            confirm === template.name
              ? h(React.Fragment, null,
                h(Button, { variant: 'danger', disabled: busy, onClick: () => run({ action: 'remove', name: template.name }, t('removed')).then(() => setConfirm(undefined)) }, t('confirmRemove')),
                h(Button, { disabled: busy, onClick: () => setConfirm(undefined) }, t('cancel')))
              : h(Button, { variant: 'danger', disabled: busy, onClick: () => setConfirm(template.name) }, t('remove'))
          ),
          h('pre', { className: 'dshaSr_pre' }, template.text),
          h('span', { className: 'dshaSr_meta' }, t('usage') + '：', h('code', { className: 'dshaSr_code' }, `/relay new --as <别名> --tpl ${template.name} [补充]`))
        ))
    );
  }

  function ReferenceSection({ t, data, copy }) {
    const id = React.useId();
    const groups = Array.isArray(data.reference) ? data.reference : [];
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('refTitle')),
      h('p', { className: 'dshaSr_hint' }, t('refHint')),
      Array.isArray(data.notes) && data.notes.length > 0
        ? h('ul', { className: 'dshaSr_notes' }, ...data.notes.map((note, index) => h('li', { key: index }, note)))
        : null,
      ...groups.map((group) => h('div', { key: group.id, className: 'dshaSr_group' },
        h('h4', { className: 'dshaSr_gtitle' }, group.title),
        ...group.items.map((item, index) => h('div', { key: index, className: 'dshaSr_item' },
          h('code', { className: 'dshaSr_code', style: { fontWeight: 600 } }, item.syntax),
          h('span', { className: 'dshaSr_hint' }, item.desc),
          h('div', { className: 'dshaSr_ex' },
            h('pre', { className: 'dshaSr_pre dshaSr_code', 'aria-label': t('example') }, item.example),
            h(Button, { label: `${t('copy')} ${item.example}`, onClick: () => copy(item.example) }, t('copy'))
          )
        ))
      ))
    );
  }

  function PluginSection({ t, data, run, busy }) {
    const id = React.useId();
    const v = data.version ?? {};
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('pluginTitle')),
      h('div', { className: 'dshaSr_card' },
        h('span', { className: 'dshaSr_meta' }, format(t('loaded'), { v: v.loaded ?? '?', g: v.generation ?? '?', time: formatTime(v.loadedAt) })),
        h('span', { className: 'dshaSr_meta' }, format(t('disk'), { v: v.disk ?? '?' })),
        h('p', { className: 'dshaSr_hint' }, v.needsRestart ? t('needsRestart') : t('reloadHint')),
        v.lastError ? h('p', { className: 'dshaSr_status', 'data-tone': 'error' }, v.lastError) : null,
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { disabled: busy, onClick: () => run({ action: 'reload' }, undefined) }, t('reload')))
      )
    );
  }

  function SessionRelaySettings({ t }) {
    const [data, setData] = React.useState(undefined);
    const [loadError, setLoadError] = React.useState(undefined);
    const [status, flash] = useFlash();
    const [busy, setBusy] = React.useState(false);
    const serial = React.useRef(0);
    const load = React.useCallback(() => {
      const mine = ++serial.current;
      setLoadError(undefined);
      request('GET').then(
        (payload) => { if (mine === serial.current) setData(payload); },
        (error) => { if (mine === serial.current) setLoadError(errorText(t, error)); }
      );
    }, [t]);
    React.useEffect(() => { load(); return () => { serial.current++; }; }, [load]);
    const run = React.useCallback(async (body, okText) => {
      const mine = ++serial.current;
      setBusy(true);
      flash(body.action === 'reload' ? t('reloading') : t('saving'), undefined, true);
      try {
        const payload = await request('POST', body);
        if (mine === serial.current) { setData(payload); flash(payload.message ?? okText ?? t('saved'), /失败/.test(payload.message ?? '') ? 'error' : 'ok'); }
        return true;
      } catch (error) {
        if (mine === serial.current) flash(errorText(t, error), 'error');
        return false;
      } finally {
        if (mine === serial.current) setBusy(false);
      }
    }, [t, flash]);
    const copy = React.useCallback(async (text) => {
      const ok = await copyText(text);
      flash(ok ? format(t('copied'), { text: text.length > 60 ? text.slice(0, 59) + '…' : text }) : t('copyFailed'), ok ? 'ok' : 'error');
    }, [t, flash]);
    return h('div', { className: 'dshaSr' },
      h('p', { className: 'dshaSr_intro' }, t('intro')),
      loadError ? h(Status, { text: loadError, tone: 'error', onRetry: load, retryText: t('retry') }) : null,
      !data && !loadError ? h(Status, { text: t('loading') }) : null,
      status.text ? h('div', { className: 'dshaSr_toast' }, h(Status, { text: status.text, tone: status.tone })) : null,
      data ? h(LineSection, { t, data, run, busy }) : null,
      data ? h(TemplateSection, { t, data, run, busy, copy }) : null,
      data ? h(ReferenceSection, { t, data, copy }) : null,
      data ? h(PluginSection, { t, data, run, busy }) : null
    );
  }

  /* ---------------------------------------------------------------- 监督面板 */

  function statusText(t, status) {
    return status ? t('status_' + status) : '';
  }

  function stateText(t, state) {
    return { running: t('stateRunning'), idle: t('stateIdle'), cold: t('stateCold'), gone: t('stateGone') }[state] ?? '';
  }

  function EntryCard({ t, entry, busy, act, openSession, copy, selfId, candidates = [], flash }) {
    const isSelf = entry.sessionId === selfId;
    const [mode, setMode] = React.useState(undefined); // undefined | 'reply' | 'leave' | 'assign' | 'takeover' | 'wake'
    const [toTarget, setToTarget] = React.useState('new');
    const [toPick, setToPick] = React.useState('');
    const [toAlias, setToAlias] = React.useState('');
    const [toNote, setToNote] = React.useState('');
    const [toQueue, setToQueue] = React.useState(false);
    const others = candidates.filter((item) => item.sessionId !== entry.sessionId && item.state !== 'gone');
    // 交接表单打开时每 3 秒查一次原会话 / 接手方是否还在运作（轮次、后台任务、子代理）
    const [activity, setActivity] = React.useState({});
    const watchIds = mode === 'takeover' ? [entry.sessionId, ...(toTarget === 'existing' && toPick ? [toPick] : [])] : [];
    const watchKey = watchIds.join(',');
    React.useEffect(() => {
      if (watchKey === '') { setActivity({}); return undefined; }
      let alive = true;
      const poll = () => request('GET', undefined, { view: 'activity', ids: watchKey }).then((payload) => { if (alive) setActivity(payload.activity ?? {}); }, () => {});
      poll();
      const timer = setInterval(() => { if (document.visibilityState !== 'hidden') poll(); }, 3000);
      return () => { alive = false; clearInterval(timer); };
    }, [watchKey]);
    const sourceState = activity[entry.sessionId];
    const targetState = toTarget === 'existing' && toPick ? activity[toPick] : undefined;
    const statusLine = (state, who) => state === undefined
      ? h('span', { className: 'dshaSr_meta' }, format(t('toChecking'), { who }))
      : state.busy
        ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('toBusy'), { who, why: state.reasons.join('、') }))
        : h('span', { className: 'dshaSr_status', 'data-tone': 'ok' }, format(t('toIdle'), { who }));
    const ready = sourceState !== undefined && !sourceState.busy && (toTarget === 'new' || (toPick !== '' && targetState !== undefined && !targetState.busy));
    const doTakeover = () => act({ action: 'takeover', source: entry.sessionId, to: toTarget === 'new' ? 'new' : toPick, alias: toAlias || undefined, note: toNote || undefined, mode: toQueue ? 'queue' : 'followup' }, undefined).then((payload) => {
      const to = payload?.result?.to;
      if (!to) return;
      setMode(undefined); setToAlias(''); setToNote('');
      flash?.(format(t('toDone'), { label: payload.result.aliases?.[0] ? '@' + payload.result.aliases[0] : shortId(to) }), 'ok');
      openSession(to);
    });
    // 唤醒表单：打开时只读预判一次（自动 / 原地 / 新建各会怎么走），确认后才发
    const [wakeForce, setWakeForce] = React.useState('auto');
    const [wakeAlias, setWakeAlias] = React.useState('');
    const [wakeNote, setWakeNote] = React.useState('');
    const [wakeInfo, setWakeInfo] = React.useState(undefined);
    React.useEffect(() => {
      if (mode !== 'wake') { setWakeInfo(undefined); return undefined; }
      const controller = new AbortController();
      request('GET', undefined, { view: 'wake-plan', target: entry.sessionId, fromSession: selfId }, controller.signal)
        .then((payload) => setWakeInfo(payload.wake ?? null), (error) => { if (error?.name !== 'AbortError') setWakeInfo({ error: errorText(t, error) }); });
      return () => controller.abort();
    }, [mode, entry.sessionId, selfId]);
    const wakePlanNow = wakeInfo?.plans?.[wakeForce];
    const wakeBlockedMain = wakeInfo?.coordinator === true && wakePlanNow?.action === 'new';
    const wakeReady = wakePlanNow !== undefined && (wakePlanNow.action === 'resume' || wakePlanNow.action === 'new') && !wakeBlockedMain;
    const wakeLine = () => {
      if (wakeInfo === undefined) return h('span', { className: 'dshaSr_meta' }, t('wakeChecking'));
      if (wakeInfo === null || wakeInfo.error) return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, wakeInfo?.error ?? t('wakeChecking'));
      if (wakePlanNow === undefined) return null;
      if (wakePlanNow.action === 'running') return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('toBusy'), { who: t('toSource'), why: wakeInfo.reasons.join('、') || wakePlanNow.reason }));
      if (wakePlanNow.action === 'gone') return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, wakePlanNow.reason);
      const v = format(t(wakePlanNow.action === 'new' ? 'wakeWillNew' : 'wakeWillResume'), { why: wakePlanNow.reason });
      return h('span', { className: 'dshaSr_status', 'data-tone': 'ok' }, format(t('wakeWill'), { v }));
    };
    const doWake = () => act({
      action: 'wake', target: entry.sessionId, force: wakeForce === 'auto' ? undefined : wakeForce,
      alias: wakePlanNow?.action === 'new' ? (wakeAlias || undefined) : undefined, note: wakeNote || undefined
    }, undefined).then((payload) => {
      const to = payload?.result?.to;
      if (!to) return;
      const isNew = payload.result.action === 'new';
      setMode(undefined); setWakeAlias(''); setWakeNote(''); setWakeForce('auto');
      const label = isNew && payload.result.aliases?.[0] ? '@' + payload.result.aliases[0] : shortId(to);
      flash?.(format(t(isNew ? 'wakeDoneNew' : 'wakeDoneResume'), { label }), 'ok');
      openSession(to);
    });
    const [assignValue, setAssignValue] = React.useState('');
    const [text, setText] = React.useState('');
    // 卡片折叠：默认只看头部与一行摘要；需要处理的、打开了表单的自动展开
    const [unfolded, setUnfolded] = React.useState(false);
    const expanded = unfolded || mode !== undefined || entry.category === 'attention';
    const id = React.useId();
    const send = () => act({ action: 'reply', target: entry.sessionId, text }, t('sent')).then((ok) => { if (ok) { setText(''); setMode(undefined); } });
    return h('div', { className: 'dshaSr_card', 'data-status': entry.status, 'data-self': isSelf ? 'true' : undefined },
      h('div', { className: 'dshaSr_entryHead' },
        h('span', { className: 'dshaSr_dot', 'data-status': entry.status, 'aria-hidden': true }),
        h('span', { className: 'dshaSr_entryName' }, entry.label),
        isSelf ? h('span', { className: 'dshaSr_badge' }, t('thisSession')) : null,
        h('span', { className: 'dshaSr_badge', 'data-status': entry.answered ? 'working' : entry.status }, statusText(t, entry.status) || '—'),
        entry.answered ? h('span', { className: 'dshaSr_badge' }, t('answered')) : null,
        entry.categoryReason && entry.categoryReason !== entry.status ? h('span', { className: 'dshaSr_badge', 'data-status': entry.category === 'archived' ? 'done' : 'blocked', title: entry.categoryDetail || undefined }, t('why_' + entry.categoryReason)) : null,
        entry.queue ? h('span', { className: 'dshaSr_badge', 'data-status': 'ready' }, format(t('queueNo'), { n: entry.queue })) : null,
        entry.assigned ? h('span', { className: 'dshaSr_badge', 'data-status': 'main' }, format(t('assignedTo'), { v: entry.assigned })) : null,
        h('span', { className: 'dshaSr_meta' }, stateText(t, entry.state)),
        entry.workspace ? h('span', { className: 'dshaSr_meta' }, format(t('inWorkspace'), { v: entry.workspace })) : null,
        h('span', { className: 'dshaSr_spacer' }),
        h('button', { type: 'button', className: 'dshaSr_chip', title: entry.sessionId, onClick: () => copy(entry.sessionId, t('idCopied')), 'aria-label': `${t('copyId')} ${entry.sessionId}` }, shortId(entry.sessionId))
      ),
      entry.summary ? h('span', { className: expanded ? undefined : 'dshaSr_clamp' }, entry.summary) : null,
      entry.question && (entry.status === 'question' || entry.status === 'blocked') ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('question'), { v: entry.question })) : null,
      h('span', { className: 'dshaSr_meta' }, [
        entry.branch ? format(t('branch'), { v: entry.branch }) : '',
        entry.commit ? format(t('commit'), { v: entry.commit }) : '',
        formatTime(entry.updatedAt)
      ].filter(Boolean).join(' · ')),
      !expanded && (entry.conflicts?.length ?? 0) + (entry.declarationIssues?.length ?? 0) > 0
        ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('conflictCount'), { n: (entry.conflicts?.length ?? 0) + (entry.declarationIssues?.length ?? 0) })) : null,
      ...(expanded ? [
      entry.files ? h('span', { className: 'dshaSr_meta' }, format(t('files'), { v: entry.files })) : null,
      ...(entry.conflicts ?? []).map((item, index) => h('span', { key: 'c' + index, className: 'dshaSr_status', 'data-tone': 'error' }, format(t('conflict'), { label: item.label, paths: item.paths.join('、') }))),
      entry.lastTurn && entry.lastTurnAt > (entry.reportedAt ?? 0) ? h('span', { className: 'dshaSr_meta' }, format(t('lastTurn'), { v: entry.lastTurn })) : null,
      entry.declaration ? h('span', { className: 'dshaSr_meta' }, format(t('declOf'), { rel: entry.declaration.rel, kind: entry.declaration.kind === 'active' ? t('declActive') : t('declDone'), merge: entry.declaration.mergeLabel + (entry.declaration.build ? ' ' + entry.declaration.build : '') }) + (entry.declaration.count > 1 ? format(t('declMore'), { n: entry.declaration.count - 1 }) : '')) : null,
      ...(entry.declarationIssues ?? []).map((text, index) => h('span', { key: 'd' + index, className: 'dshaSr_status', 'data-tone': 'error' }, '⚠ ' + text))
      ] : []),
      mode === 'assign' ? h('div', { className: 'dshaSr_row' },
        h('input', { className: 'dshaSr_input', style: { flex: '1 1 8em' }, value: assignValue, maxLength: 80, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('assignPlaceholder'), 'aria-label': t('assign'), onChange: (event) => setAssignValue(event.target.value) }),
        h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
        h(Button, { variant: 'primary', disabled: busy || assignValue.trim() === '', onClick: () => act({ action: 'assign', target: entry.sessionId, value: assignValue }, t('assigned')).then((ok) => { if (ok) { setAssignValue(''); setMode(undefined); } }) }, t('assignSend'))
      ) : null,
      mode === 'takeover' ? h('div', { className: 'dshaSr_sec' },
        h('span', { className: 'dshaSr_label' }, format(t('toTitle'), { label: entry.label })),
        h('div', { className: 'dshaSr_radio', role: 'radiogroup' },
          h('label', null, h('input', { type: 'radio', checked: toTarget === 'new', onChange: () => setToTarget('new') }), t('toNew')),
          h('label', null, h('input', { type: 'radio', checked: toTarget === 'existing', disabled: others.length === 0, onChange: () => setToTarget('existing') }), t('toExisting'))),
        toTarget === 'existing' ? h('select', { className: 'dshaSr_input', value: toPick, 'aria-label': t('toExisting'), onChange: (event) => setToPick(event.target.value) },
          h('option', { value: '' }, '—'),
          ...others.map((item) => h('option', { key: item.sessionId, value: item.sessionId, disabled: item.state === 'running' }, `${shortId(item.sessionId)} · ${item.title ?? item.label}${item.state === 'running' ? t('optRunning') : ''}`))) : null,
        statusLine(sourceState, t('toSource')),
        targetState !== undefined || (toTarget === 'existing' && toPick) ? statusLine(targetState, t('toTarget')) : null,
        ...[...(sourceState?.notes ?? []), ...(targetState?.notes ?? [])].map((note, index) => h('span', { key: 'n' + index, className: 'dshaSr_meta' }, format(t('toNotes'), { v: note }))),
        h('input', { className: 'dshaSr_input', value: toAlias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('toAlias'), 'aria-label': t('toAlias'), onChange: (event) => setToAlias(event.target.value) }),
        h('textarea', { className: 'dshaSr_area', rows: 2, value: toNote, placeholder: t('toNote'), 'aria-label': t('toNote'), onChange: (event) => setToNote(event.target.value) }),
        h('label', { className: 'dshaSr_check' }, h('input', { type: 'checkbox', checked: toQueue, onChange: (event) => setToQueue(event.target.checked) }), h('span', null, t('toQueue'))),
        h('span', { className: 'dshaSr_hint' }, t('toHint')),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
          h(Button, { variant: 'primary', disabled: busy || !ready, onClick: doTakeover }, t('toConfirm')))
      ) : null,
      mode === 'wake' ? h('div', { className: 'dshaSr_sec' },
        h('span', { className: 'dshaSr_label' }, format(t('wakeTitle'), { label: entry.label })),
        h('div', { className: 'dshaSr_radio', role: 'radiogroup', 'aria-label': format(t('wakeTitle'), { label: entry.label }) },
          ...['auto', 'resume', 'new'].map((force) => h('label', { key: force },
            h('input', { type: 'radio', name: id + '-wake', checked: wakeForce === force, onChange: () => setWakeForce(force) }),
            t(force === 'auto' ? 'wakeAuto' : force === 'resume' ? 'wakeResume' : 'wakeNew')))),
        wakeLine(),
        wakeBlockedMain ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, t('wakeMain')) : null,
        ...(wakeInfo?.notes ?? []).map((note, index) => h('span', { key: 'wn' + index, className: 'dshaSr_meta' }, format(t('toNotes'), { v: note }))),
        wakePlanNow?.action === 'new' ? h('input', { className: 'dshaSr_input', value: wakeAlias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('wakeAlias'), 'aria-label': t('wakeAlias'), onChange: (event) => setWakeAlias(event.target.value) }) : null,
        h('textarea', { className: 'dshaSr_area', rows: 2, value: wakeNote, placeholder: t('wakeNote'), 'aria-label': t('wakeNote'), onChange: (event) => setWakeNote(event.target.value) }),
        h('span', { className: 'dshaSr_hint' }, t('wakeHint')),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
          h(Button, { variant: 'primary', disabled: busy || !wakeReady, onClick: doWake }, t('wakeConfirm')))
      ) : null,
      mode === 'reply' ? h('div', { className: 'dshaSr_sec' },
        h('textarea', { id: id + '-reply', className: 'dshaSr_area', rows: 3, value: text, placeholder: t('replyPlaceholder'), 'aria-label': t('reply'), onChange: (event) => setText(event.target.value) }),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
          h(Button, { variant: 'primary', disabled: busy || text.trim() === '', onClick: send }, t('send')))
      ) : null,
      !expanded ? h('div', { className: 'dshaSr_row' },
        entry.state !== 'gone' && !isSelf ? h(Button, { disabled: busy, onClick: () => openSession(entry.sessionId) }, t('openSession')) : null,
        entry.state !== 'gone' && entry.status === 'ready' ? h(Button, { disabled: busy, onClick: () => setMode('assign') }, t('assign')) : null,
        h('span', { className: 'dshaSr_spacer' }),
        h(Button, { onClick: () => setUnfolded(true), 'aria-expanded': 'false' }, t('cardMore'))
      ) : h('div', { className: 'dshaSr_row' },
        entry.state !== 'gone' && !isSelf ? h(Button, { disabled: busy, onClick: () => openSession(entry.sessionId) }, t('openSession')) : null,
        entry.state !== 'gone' && mode !== 'reply' ? h(Button, { disabled: busy, onClick: () => setMode('reply') }, t('reply')) : null,
        entry.state !== 'gone' && entry.status === 'ready' && mode !== 'assign' ? h(Button, { disabled: busy, onClick: () => setMode('assign') }, t('assign')) : null,
        // 运行中也显示按钮，但置灰并写明原因；打开后由实时检查决定能否确认
        !isSelf && entry.state !== 'gone' && mode !== 'wake'
          ? h(Button, { disabled: busy || entry.state === 'running', onClick: () => setMode('wake') }, entry.state === 'running' ? t('wakeRunning') : t('wake')) : null,
        !isSelf && entry.state !== 'gone' && entry.status !== 'done' && entry.status !== 'abandoned' && mode !== 'takeover'
          ? h(Button, { disabled: busy || entry.state === 'running', onClick: () => setMode('takeover') }, entry.state === 'running' ? t('toRunning') : t('takeover')) : null,
        entry.state !== 'gone' ? h(Button, { disabled: busy, onClick: () => act({ action: 'set-main', target: entry.sessionId }, t('saved')) }, t('setMain')) : null,
        h('span', { className: 'dshaSr_spacer' }),
        mode === 'leave'
          ? h(React.Fragment, null,
            h(Button, { variant: 'danger', disabled: busy, onClick: () => act({ action: 'leave', target: entry.sessionId }, t('saved')).then(() => setMode(undefined)) }, t('confirmLeave')),
            h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')))
          : h(Button, { variant: 'danger', disabled: busy, onClick: () => setMode('leave') }, t('leave')),
        unfolded && mode === undefined && entry.category !== 'attention' ? h(Button, { onClick: () => setUnfolded(false), 'aria-expanded': 'true' }, t('cardLess')) : null
      )
    );
  }

  function OpenSection({ t, board, busy, act, openSession }) {
    const id = React.useId();
    const [alias, setAlias] = React.useState('');
    const [cwd, setCwd] = React.useState(board.defaultCwd ?? '');
    const [join, setJoin] = React.useState(true);
    React.useEffect(() => { if (cwd === '' && board.defaultCwd) setCwd(board.defaultCwd); }, [board.defaultCwd]);
    const create = () => act({ action: 'open', alias, cwd, join }, undefined).then((payload) => {
      if (payload?.result?.sessionId) { setAlias(''); openSession(payload.result.sessionId); }
    });
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('openTitle')),
      h('p', { className: 'dshaSr_hint' }, t('openHint')),
      h('div', { className: 'dshaSr_card' },
        h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('alias')),
        h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'fix2', onChange: (event) => setAlias(event.target.value) }),
        h('label', { className: 'dshaSr_label', htmlFor: id + '-cwd' }, t('cwd')),
        h('input', { id: id + '-cwd', className: 'dshaSr_input', value: cwd, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, onChange: (event) => setCwd(event.target.value) }),
        h('label', { className: 'dshaSr_check' },
          h('input', { type: 'checkbox', checked: join, onChange: (event) => setJoin(event.target.checked) }),
          h('span', null, t('join'))),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { variant: 'primary', disabled: busy || cwd.trim() === '', onClick: create }, t('create')))
      )
    );
  }

  /** 交接面板：起草 / 审核 / 选接手方 / 确认；确认只在这里或 /relay handoff confirm。 */
  function HandoffSection({ t, board, busy, act, openSession, flash }) {
    const id = React.useId();
    const handoff = board.handoff;
    const draft = handoff.draft;
    const [notes, setNotes] = React.useState(draft?.notes ?? '');
    const [dirty, setDirty] = React.useState(false);
    const [writing, setWriting] = React.useState(false);
    const [showSnap, setShowSnap] = React.useState(false);
    const [target, setTarget] = React.useState('new');
    const [pick, setPick] = React.useState('');
    const [alias, setAlias] = React.useState('');
    const [queue, setQueue] = React.useState(false);
    const [armed, setArmed] = React.useState(false);
    // 自动刷新带来新草稿时，没改过才覆盖输入框
    React.useEffect(() => { if (!dirty) setNotes(draft?.notes ?? ''); }, [draft?.updatedAt]);
    const candidates = [...(board.entries ?? []), ...(board.others ?? [])].filter((item) => item.sessionId !== handoff.coordinator && item.state !== 'gone');
    const targetLabel = target === 'new' ? (alias.trim() ? '@' + alias.trim() : t('hoTargetNew')) : (candidates.find((item) => item.sessionId === pick)?.label ?? shortId(pick));
    const canConfirm = !busy && (target === 'new' || pick !== '') && (draft !== null || notes.trim() !== '');
    const confirm = () => {
      if (!armed) { setArmed(true); return; }
      setArmed(false);
      act({ action: 'handoff-confirm', to: target === 'new' ? 'new' : pick, alias: target === 'new' ? alias : undefined, notes: dirty || draft === null ? notes : undefined, mode: queue ? 'queue' : 'followup' }, undefined).then((payload) => {
        const to = payload?.result?.to;
        if (!to) return;
        setDirty(false); setAlias('');
        flash(format(t('hoDone'), { label: payload.result.alias ? '@' + payload.result.alias : shortId(to) }), 'ok');
        openSession(to);
      });
    };
    const editing = draft !== null || writing;
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('hoTitle')),
      h('p', { className: 'dshaSr_hint' }, t('hoHint')),
      h('div', { className: 'dshaSr_card' },
        handoff.coordinator === null ? h('span', { className: 'dshaSr_meta' }, t('hoNoMain')) : null,
        draft
          ? h('span', { className: 'dshaSr_meta' }, format(t('hoDraftBy'), { who: draft.by === 'model' ? t('hoByModel') : draft.by === 'plugin' ? t('hoByPlugin') : t('hoByUser'), time: formatTime(draft.updatedAt) }))
          : h('span', { className: 'dshaSr_meta' }, t('hoNoDraft')),
        handoff.coordinatorFailure ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('hoFailed'), { text: handoff.coordinatorFailure.text })) : null,
        h('div', { className: 'dshaSr_row' },
          // 主会话上一轮失败（如上下文超限）时不让它起草，改成插件整理
          handoff.coordinator !== null && !handoff.coordinatorFailure && !editing ? h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'handoff-ask' }, t('hoAsked')) }, t('hoAsk')) : null,
          handoff.coordinator !== null ? h(Button, { variant: handoff.coordinatorFailure ? 'primary' : undefined, disabled: busy, onClick: () => act({ action: 'handoff-auto' }, t('hoAutoDone')).then((payload) => { if (payload) { setDirty(false); setWriting(true); } }) }, t('hoAuto')) : null,
          !editing ? h(Button, { disabled: busy, onClick: () => setWriting(true) }, t('hoWrite')) : null),
        editing ? h(React.Fragment, null,
          h('label', { className: 'dshaSr_label', htmlFor: id + '-notes' }, t('hoNotes')),
          h('textarea', { id: id + '-notes', className: 'dshaSr_area', rows: 8, maxLength: 2000, value: notes, onChange: (event) => { setNotes(event.target.value); setDirty(true); setArmed(false); } }),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta' }, format(t('chars'), { n: notes.length, max: 2000 })),
            h('span', { className: 'dshaSr_spacer' }),
            draft ? h(Button, { variant: 'danger', disabled: busy, onClick: () => act({ action: 'handoff-discard' }, t('removed')).then(() => { setDirty(false); setWriting(false); setNotes(''); }) }, t('hoDiscard')) : null,
            h(Button, { disabled: busy || notes.trim() === '' || !dirty, onClick: () => act({ action: 'handoff-save', notes }, t('saved')).then((payload) => { if (payload) setDirty(false); }) }, t('hoSave')))) : null,
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta' }, t('hoSnapshot')),
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { onClick: () => setShowSnap(!showSnap) }, showSnap ? t('hoHideSnapshot') : t('hoShowSnapshot'))),
        showSnap ? h('pre', { className: 'dshaSr_pre' }, handoff.snapshot) : null,
        editing ? h(React.Fragment, null,
          h('span', { className: 'dshaSr_label', id: id + '-target' }, t('hoTarget')),
          h('div', { className: 'dshaSr_radio', role: 'radiogroup', 'aria-labelledby': id + '-target' },
            h('label', null, h('input', { type: 'radio', name: id + '-to', checked: target === 'new', onChange: () => { setTarget('new'); setArmed(false); } }), t('hoTargetNew')),
            h('label', null, h('input', { type: 'radio', name: id + '-to', checked: target === 'existing', disabled: candidates.length === 0, onChange: () => { setTarget('existing'); setArmed(false); } }), t('hoTargetExisting'))),
          target === 'new'
            ? h(React.Fragment, null,
              h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('hoAlias')),
              h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'main2', onChange: (event) => { setAlias(event.target.value); setArmed(false); } }))
            : h(React.Fragment, null,
              h('label', { className: 'dshaSr_label', htmlFor: id + '-pick' }, t('hoPick')),
              h('select', { id: id + '-pick', className: 'dshaSr_input', value: pick, onChange: (event) => { setPick(event.target.value); setArmed(false); } },
                h('option', { value: '' }, '—'),
                ...candidates.map((item) => h('option', { key: item.sessionId, value: item.sessionId }, `${shortId(item.sessionId)} · ${item.title ?? item.label}`)))),
          h('label', { className: 'dshaSr_check' },
            h('input', { type: 'checkbox', checked: queue, onChange: (event) => setQueue(event.target.checked) }),
            h('span', null, t('hoQueue'))),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_spacer' }),
            armed ? h(Button, { disabled: busy, onClick: () => setArmed(false) }, t('cancel')) : null,
            h(Button, { variant: armed ? 'danger' : 'primary', disabled: !canConfirm, onClick: confirm }, armed ? format(t('hoConfirmAgain'), { target: targetLabel }) : t('hoConfirm')))) : null
      ),
      handoff.history.length > 0 ? h('div', { className: 'dshaSr_card' },
        h('span', { className: 'dshaSr_label' }, t('hoHistory')),
        ...handoff.history.map((item, index) => h('div', { key: index, className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta' }, `${formatTime(item.at)} · ${item.fromLabel ?? '—'} → ${item.toLabel}`),
          h('span', { className: 'dshaSr_spacer' }),
          item.from && item.from !== handoff.coordinator ? h(Button, { disabled: busy, onClick: () => act({ action: 'set-main', target: item.from }, t('saved')) }, t('hoRevert')) : null))
      ) : null
    );
  }

  function releaseGap(t, main) {
    const m = Number((/\d+/.exec(main.build ?? '') ?? [])[0]);
    const r = Number((/\d+/.exec(main.released?.build ?? '') ?? [])[0]);
    if (!(m > r)) return '';
    return format(t('declGap'), { range: m - r === 1 ? 'build' + m : 'build' + (r + 1) + '–' + m });
  }

  /** 侧栏自动置顶开关（按工作区，默认关闭）。 */
  function PinSection({ t, board, busy, act }) {
    const id = React.useId();
    const pin = board.autoPin;
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('pinTitle')),
      h('p', { className: 'dshaSr_hint' }, t('pinHint')),
      h('div', { className: 'dshaSr_card' },
        h('label', { className: 'dshaSr_check' },
          h('input', { type: 'checkbox', checked: pin.enabled, disabled: busy || !pin.available, onChange: (event) => act({ action: 'auto-pin', enabled: event.target.checked, workspaceId: board.workspace?.id }, event.target.checked ? t('pinOn') : t('pinOff')) }),
          h('span', null, t('pinLabel'))),
        pin.enabled ? h('span', { className: 'dshaSr_meta' }, format(t('pinOwned'), { n: pin.owned })) : null));
  }

  /** 拉起认领会话：选任务（默认最高优先）与别名，首条消息由插件生成。 */
  function ClaimSection({ t, board, busy, act, openSession, flash }) {
    const id = React.useId();
    const tb = board.taskBoard;
    const [task, setTask] = React.useState('');
    const [alias, setAlias] = React.useState('');
    React.useEffect(() => { if (task !== '' && !tb.open.some((row) => row.id === task)) setTask(''); }, [tb.open.map((row) => row.id).join(',')]);
    const go = () => act({ action: 'claim', task: task || undefined, alias: alias || undefined }, undefined).then((payload) => {
      const result = payload?.result;
      if (!result?.sessionId) return;
      setAlias('');
      flash(format(t('claimDone'), { label: result.alias ? '@' + result.alias : shortId(result.sessionId) }) + (result.task ? ' ' + result.task : ''), 'ok');
      openSession(result.sessionId);
    });
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('claimTitle')),
      h('p', { className: 'dshaSr_hint' }, t('claimHint')),
      h('div', { className: 'dshaSr_card' },
        h('span', { className: 'dshaSr_meta' }, format(t('claimBoard'), { file: tb.file })),
        tb.open.length === 0 ? h('span', { className: 'dshaSr_meta' }, t('claimNone')) : h(React.Fragment, null,
          h('label', { className: 'dshaSr_label', htmlFor: id + '-task' }, t('claimTask')),
          h('select', { id: id + '-task', className: 'dshaSr_input', value: task, onChange: (event) => setTask(event.target.value) },
            h('option', { value: '' }, t('claimAny')),
            ...tb.open.map((row) => h('option', { key: row.id, value: row.id }, `${row.id}${row.priority ? ' ' + row.priority : ''} · ${row.title}`))),
          h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('alias')),
          h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: task ? task.toLowerCase() : 't31', onChange: (event) => setAlias(event.target.value) }),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { variant: 'primary', disabled: busy, onClick: go }, t('claimGo'))))));
  }

  /** 工作树声明（只读）：计数一行，明细可展开。 */
  function DeclSection({ t, decl }) {
    const id = React.useId();
    const [open, setOpen] = React.useState(false);
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('declTitle')),
      h('p', { className: 'dshaSr_hint' }, t('declHint')),
      h('div', { className: 'dshaSr_card' },
        h('span', { className: decl.mismatches > 0 ? 'dshaSr_status' : 'dshaSr_meta', 'data-tone': decl.mismatches > 0 ? 'error' : undefined },
          format(t('declCounts'), { active: decl.active, mismatches: decl.mismatches, candidates: decl.candidates.length, pending: decl.pending.length, merged: decl.mergedActive.length, orphans: decl.orphans.length, undeclared: decl.undeclared.length })),
        decl.main ? h('span', { className: 'dshaSr_meta' }, format(t('declMain'), { sha: decl.main.short, build: decl.main.build ?? '?', subject: decl.main.subject })) : null,
        decl.main ? h('span', { className: 'dshaSr_meta' }, decl.main.released ? format(t('declReleased'), { build: decl.main.released.build, tag: decl.main.released.tag, gap: releaseGap(t, decl.main) }) : t('declReleasedNone')) : null,
        h('span', { className: 'dshaSr_meta' }, format(t('declExtra'), { landed: (decl.landed ?? []).length, overlaps: (decl.overlaps ?? []).length, bg: decl.backgroundAttention ?? 0 })),
        h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_spacer' }),
          h(Button, { 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(!open) }, open ? t('declHide') : t('declShow'))),
        open ? h('pre', { className: 'dshaSr_pre' }, decl.text) : null));
  }

  /** 侧栏登记在本工作区、但没加入看板的会话：紧凑列表，可打开或一键加入。 */
  function OthersSection({ t, board, busy, act, openSession, copy, selfId }) {
    const id = React.useId();
    return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
      h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('othersTitle')),
      h('p', { className: 'dshaSr_hint' }, t('othersHint')),
      h('div', { className: 'dshaSr_card' },
        ...board.others.map((item) => h('div', { key: item.sessionId, className: 'dshaSr_row', 'data-self': item.sessionId === selfId ? 'true' : undefined },
          h('button', { type: 'button', className: 'dshaSr_chip', title: item.sessionId, onClick: () => copy(item.sessionId, t('idCopied')), 'aria-label': `${t('copyId')} ${item.sessionId}` }, shortId(item.sessionId)),
          h('span', { style: { flex: '1 1 8em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: item.title }, item.title),
          h('span', { className: 'dshaSr_meta' }, [stateText(t, item.state), item.optOut ? t('optedOut') : '', formatTime(item.updatedAt)].filter(Boolean).join(' · ')),
          item.sessionId === selfId ? h('span', { className: 'dshaSr_badge' }, t('thisSession')) : h(Button, { disabled: busy, onClick: () => openSession(item.sessionId) }, t('openSession')),
          h(Button, { disabled: busy, onClick: () => act({ action: 'join', target: item.sessionId }, t('saved')) }, t('joinThis'))
        )),
        board.othersTotal > board.others.length ? h('span', { className: 'dshaSr_meta' }, format(t('othersMore'), { n: board.othersTotal - board.others.length })) : null
      )
    );
  }

  /** 会话标签页顶部：本会话的完整 id、别名、协作身份；未加入时可一键加入。 */
  function SelfCard({ t, self, busy, act, copy }) {
    const names = [...(self.isMain ? ['@main'] : []), ...self.aliases.map((name) => '@' + name)];
    return h('div', { className: 'dshaSr_card', 'data-self': 'true' },
      h('div', { className: 'dshaSr_entryHead' },
        self.isMain ? h(StarIcon, { size: 14 }) : h('span', { className: 'dshaSr_dot', 'data-status': self.entry?.status ?? (self.participant ? 'joined' : undefined), 'aria-hidden': true }),
        h('span', { className: 'dshaSr_entryName' }, t('selfTitle')),
        names.length > 0 ? h('span', { className: 'dshaSr_meta' }, names.join(' ')) : null,
        self.entry?.status ? h('span', { className: 'dshaSr_badge', 'data-status': self.entry.status }, statusText(t, self.entry.status)) : self.isMain ? h('span', { className: 'dshaSr_badge', 'data-status': 'main' }, statusText(t, 'main')) : null,
        h('span', { className: 'dshaSr_spacer' }),
        h(Button, { onClick: () => copy(self.sessionId, t('idCopied')) }, t('copyId'))
      ),
      h('span', { className: 'dshaSr_idline' }, self.sessionId),
      self.entry?.summary ? h('span', null, self.entry.summary) : null,
      self.mainElsewhere ? h('span', { className: 'dshaSr_hint' }, t('selfMainElsewhere')) : null,
      !self.participant ? h('div', { className: 'dshaSr_row' },
        h('span', { className: 'dshaSr_hint' }, self.seesLine ? t('selfObserver') : t('selfNotJoined')),
        h('span', { className: 'dshaSr_spacer' }),
        h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'join', target: self.sessionId }, t('saved')) }, t('joinSelf'))) : null
    );
  }

  function Chevron() {
    return h('svg', { className: 'dshaSr_chev', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: 'M9 6l6 6-6 6' }));
  }

  /** 折叠状态按分区记在本机（localStorage），刷新后保持；不可用时只在内存里。 */
  const FOLD_KEY = 'dshaSr.fold.v1';
  function readFolds() {
    try { const value = JSON.parse(window.localStorage.getItem(FOLD_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
  }
  function writeFold(name, open) {
    try { const value = readFolds(); value[name] = open; window.localStorage.setItem(FOLD_KEY, JSON.stringify(value)); } catch {}
  }

  /** 可折叠分区：标题行是一个按钮（aria-expanded），收起时显示一行摘要。 */
  function Fold({ name, title, summary, tone, defaultOpen = false, onOpen, actions, children }) {
    const id = React.useId();
    const [open, setOpen] = React.useState(() => { const saved = readFolds()[name]; return typeof saved === 'boolean' ? saved : defaultOpen; });
    React.useEffect(() => { if (open && onOpen) onOpen(); }, [open]);
    const toggle = () => { const next = !open; setOpen(next); writeFold(name, next); };
    return h('section', { className: 'dshaSr_fold', 'data-open': open ? 'true' : 'false', 'aria-labelledby': id + '-t' },
      h('div', { className: 'dshaSr_foldHead' },
        h('h3', { className: 'dshaSr_foldTitle' },
          h('button', { type: 'button', id: id + '-t', className: 'dshaSr_foldBtn', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id + '-b', onClick: toggle },
            h(Chevron),
            h('span', { className: 'dshaSr_foldName' }, title),
            !open && summary ? h('span', { className: 'dshaSr_foldSum', 'data-tone': tone }, summary) : null)),
        open && actions ? h('div', { className: 'dshaSr_foldActs' }, actions) : null),
      open ? h('div', { id: id + '-b', className: 'dshaSr_foldBody' }, children) : null);
  }

  /**
   * 任务看板状态（只在展开时读取，结果是纯文本报告，约 2KB）与归档：先预览拿 planId，再确认执行。
   */
  function TasksSection({ t, sessionId, flash }) {
    const [report, setReport] = React.useState(undefined);
    const [plan, setPlan] = React.useState(undefined);
    const [working, setWorking] = React.useState(false);
    const run = React.useCallback(async (body) => {
      setWorking(true);
      try {
        const payload = await request('POST', { action: 'tasks', ...(sessionId ? { fromSession: sessionId } : {}), ...body });
        return payload.result;
      } catch (error) {
        flash(errorText(t, error), 'error');
        return undefined;
      } finally { setWorking(false); }
    }, [t, flash, sessionId]);
    const refresh = React.useCallback(() => run({}).then((result) => { if (result) setReport(result.text); }), [run]);
    const preview = () => run({ archive: 'preview' }).then((result) => { if (result) setPlan({ text: result.text, planId: result.planId }); });
    const apply = () => run({ archive: 'apply', planId: plan.planId }).then((result) => {
      if (!result) return;
      setPlan(undefined);
      flash(result.text.split('\n')[0], 'ok', true);
      void refresh();
    });
    return h(Fold, {
      name: 'tasks', title: t('tasksTitle'), summary: t('tasksSummary'), onOpen: () => { if (report === undefined) void refresh(); },
      actions: h(Button, { disabled: working, onClick: refresh }, t('tasksRefresh'))
    },
      h('p', { className: 'dshaSr_hint' }, t('tasksHint')),
      report === undefined ? h(Status, { text: working ? t('loading') : '' }) : h('pre', { className: 'dshaSr_pre dshaSr_clamp', style: { maxHeight: '22em' } }, report),
      h('div', { className: 'dshaSr_more' },
        h(Button, { disabled: working, onClick: preview }, t('tasksArchivePreview')),
        plan?.planId ? h(Button, { variant: 'primary', disabled: working, onClick: apply }, t('tasksArchiveApply')) : null,
        plan ? h(Button, { disabled: working, onClick: () => setPlan(undefined) }, t('cancel')) : null),
      plan ? h('pre', { className: 'dshaSr_pre', style: { maxHeight: '16em' } }, plan.text) : null);
  }

  function BoardPage({ t, openSession, marksStore, sessionId, embedded }) {
    const [scope, setScope] = React.useState('workspace');
    const [board, setBoard] = React.useState(undefined);
    const [loadError, setLoadError] = React.useState(undefined);
    const [status, flash] = useFlash();
    const [busy, setBusy] = React.useState(false);
    const serial = React.useRef(0);
    const requestRef = React.useRef(undefined);
    const load = React.useCallback((quiet) => {
      if (quiet && requestRef.current !== undefined) return;
      const mine = ++serial.current;
      requestRef.current?.abort?.();
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
      requestRef.current = controller;
      if (!quiet) setLoadError(undefined);
      request('GET', undefined, { view: 'board', session: sessionId, scope: sessionId ? scope : undefined }, controller?.signal).then(
        (payload) => {
          if (mine !== serial.current) return;
          // 防御：返回的不是看板数据（如旧服务端）时报错而不是渲染崩溃
          if (!Array.isArray(payload.entries)) { if (!quiet) setLoadError(t('unavailable')); return; }
          setBoard(payload); setLoadError(undefined);
        },
        (error) => { if (mine === serial.current && !quiet && error?.name !== 'AbortError') setLoadError(errorText(t, error)); }
      ).finally(() => {
        if (requestRef.current === controller) requestRef.current = undefined;
      });
    }, [t, sessionId, scope]);
    React.useEffect(() => {
      load(false);
      const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(true); }, 10000);
      return () => { clearInterval(timer); serial.current++; requestRef.current?.abort?.(); requestRef.current = undefined; };
    }, [load]);
    const act = React.useCallback(async (body, okText) => {
      const mine = ++serial.current;
      setBusy(true);
      try {
        const payload = await request('POST', { ...body, ...(sessionId ? { fromSession: sessionId, scope } : {}) });
        if (mine === serial.current && Array.isArray(payload.board?.entries)) setBoard(payload.board);
        if (body.action === 'open' && payload.result?.sessionId) flash(format(t('created'), { label: payload.result.alias ? '@' + payload.result.alias : shortId(payload.result.sessionId) }), 'ok');
        else if (okText) flash(okText, 'ok');
        void marksStore.refresh();
        return payload;
      } catch (error) {
        flash(errorText(t, error), 'error');
        return undefined;
      } finally {
        if (mine === serial.current) setBusy(false);
      }
    }, [t, flash, marksStore, sessionId, scope]);
    const copy = React.useCallback(async (text, okText) => {
      const ok = await copyText(text);
      flash(ok ? (okText ?? format(t('copied'), { text })) : t('copyFailed'), ok ? 'ok' : 'error');
    }, [t, flash]);
    const restart = board?.restart;
    const decl = board?.declarations;
    const tb = board?.taskBoard;
    const pin = board?.autoPin;
    const archived = (board?.entries ?? []).filter((entry) => entry.category === 'archived');
    return h('div', { className: 'dshaSr_page' }, h('div', { className: 'dshaSr_pageIn' },
      embedded ? null : h('h2', { className: 'dshaSr_title' }, t('panel')),
      board?.self ? h(SelfCard, { t, self: board.self, busy, act, copy }) : null,
      loadError ? h(Status, { text: loadError, tone: 'error', onRetry: () => load(false), retryText: t('retry') }) : null,
      !board && !loadError ? h(Status, { text: t('loading') }) : null,
      status.text ? h('div', { className: 'dshaSr_toast' }, h(Status, { text: status.text, tone: status.tone })) : null,
      board ? h('div', { className: 'dshaSr_card' },
        h('div', { className: 'dshaSr_entryHead' },
          h(StarIcon, { size: 14 }),
          h('span', { className: 'dshaSr_entryName' }, board.coordinator ? format(t('mainIs'), { label: board.coordinator.label }) : t('mainNone')),
          h('span', { className: 'dshaSr_spacer' }),
          board.coordinator ? h('button', { type: 'button', className: 'dshaSr_chip', title: board.coordinator.sessionId, onClick: () => copy(board.coordinator.sessionId, t('idCopied')) }, shortId(board.coordinator.sessionId)) : null,
          board.coordinator?.exists ? h(Button, { onClick: () => openSession(board.coordinator.sessionId) }, t('openSession')) : null
        ),
        board.line ? h('pre', { className: 'dshaSr_pre' }, board.line.text) : h('span', { className: 'dshaSr_meta' }, t('lineEmpty'))
      ) : null,
      board ? h('div', { className: 'dshaSr_cols' },
      h('div', { className: 'dshaSr_col' },
      board.handoff ? h(HandoffSection, { t, board, busy, act, openSession, flash }) : null,
      h('section', { className: 'dshaSr_sec' },
        sessionId && board.workspace ? h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta' }, format(t('workspaceIs'), { v: board.workspace.title || board.workspace.path })),
          h('span', { className: 'dshaSr_spacer' }),
          h('div', { className: 'dshaSr_seg', role: 'group' },
            h('button', { type: 'button', 'aria-pressed': scope === 'workspace' ? 'true' : 'false', onClick: () => setScope('workspace') }, t('scopeWorkspace')),
            h('button', { type: 'button', 'aria-pressed': scope === 'all' ? 'true' : 'false', onClick: () => setScope('all') }, t('scopeAll')))) : null,
        board.entries.length === archived.length ? h('p', { className: 'dshaSr_hint' }, t('boardEmpty')) : null,
        ...CATEGORY_ORDER.filter((cat) => cat !== 'archived').map((cat) => {
          const list = board.entries.filter((entry) => (entry.category ?? 'active') === cat);
          if (list.length === 0) return null;
          // 需要处理 / 可合并 / 进行中 默认展开，久未活动 / 空白 默认收起；展开状态记在本机
          return h(Fold, { key: 'cat-' + cat, name: 'cat-' + cat, title: t(CATEGORY_KEY[cat]), tone: cat === 'attention' ? 'error' : undefined, summary: format(t('foldCatSum'), { n: list.length }), defaultOpen: cat === 'attention' || cat === 'ready' || cat === 'active' },
            h('div', { className: 'dshaSr_entries', 'data-cat': cat },
              ...list.map((entry) => h(EntryCard, { key: entry.sessionId, t, entry, busy, act, openSession, copy, selfId: sessionId, flash, candidates: [...board.entries, ...(board.others ?? [])] }))));
        }),
        board.entries.some((entry) => entry.category) ? h('p', { className: 'dshaSr_hint' }, t('catHint')) : null,
        board.hiddenByScope > 0 ? h('button', { type: 'button', className: 'dshaSr_btn', onClick: () => setScope('all') }, format(t('scopeHidden'), { n: board.hiddenByScope })) : null
      )),
      // 次要分区：默认收起，收起时一行摘要；宽屏排在右栏
      h('div', { className: 'dshaSr_col' },
        archived.length > 0 ? h(Fold, { name: 'archive', title: t('archiveTitle'), summary: format(t('foldArchiveSum'), { n: archived.length }) },
          h('p', { className: 'dshaSr_hint' }, t('archiveHint')),
          h('div', { className: 'dshaSr_entries' },
            ...archived.map((entry) => h(EntryCard, { key: entry.sessionId, t, entry, busy, act, openSession, copy, selfId: sessionId, flash, candidates: [...board.entries, ...(board.others ?? [])] })))) : null,
        Array.isArray(board.watches) ? h(Fold, { name: 'watch', title: t('watchTitle'), summary: format(t('foldWatchSum'), { n: board.watches.filter((item) => item.state === 'active').length }) },
          h('p', { className: 'dshaSr_hint' }, t('watchHint')),
          board.watches.length === 0 ? h('span', { className: 'dshaSr_meta' }, t('watchEmpty')) : null,
          ...board.watches.map((item) => h('div', { key: item.id, className: 'dshaSr_row' },
            h('span', { className: item.state === 'failed' || item.state === 'timeout' ? 'dshaSr_status' : 'dshaSr_meta', 'data-tone': item.state === 'failed' || item.state === 'timeout' ? 'error' : undefined, style: { flex: '1 1 16em' } }, item.line),
            item.state === 'active' ? h(Button, { disabled: busy, onClick: () => act({ action: 'watch-cancel', id: item.id }, t('watchCancelled')) }, t('watchCancel')) : null))) : null,
        tb ? h(TasksSection, { t, sessionId, flash }) : null,
        tb ? h(Fold, { name: 'claim', title: t('claimTitle'), summary: format(t('foldClaimSum'), { n: tb.open.length }), defaultOpen: false },
          h(ClaimSection, { t, board, busy, act, openSession, flash })) : null,
        decl ? h(Fold, { name: 'decl', title: t('declTitle'), tone: decl.mismatches > 0 ? 'error' : undefined, summary: format(t('foldDeclSum'), { active: decl.active, mismatches: decl.mismatches }) },
          h(DeclSection, { t, decl })) : null,
        Array.isArray(board.others) && board.others.length > 0 ? h(Fold, { name: 'others', title: t('othersTitle'), summary: format(t('foldOthersSum'), { n: board.othersTotal ?? board.others.length }) },
          h(OthersSection, { t, board, busy, act, openSession, copy, selfId: sessionId })) : null,
        h(Fold, { name: 'open', title: t('openTitle'), summary: t('foldOpenSum') },
          h(OpenSection, { t, board, busy, act, openSession })),
        pin ? h(Fold, { name: 'pin', title: t('pinTitle'), summary: pin.enabled ? t('pinOn') : t('pinOff') },
          h(PinSection, { t, board, busy, act })) : null,
        h(Fold, { name: 'restart', title: t('restartTitle'), summary: restart?.phase === 'watching' ? t('foldRestartWatching') : t('foldRestartIdle') },
          h('div', { className: 'dshaSr_card' },
            h('span', null, restart?.text ?? ''),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              restart?.phase === 'watching'
                ? h(Button, { disabled: busy, onClick: () => act({ action: 'restart-cancel' }) }, t('restartCancel'))
                : h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'restart-watch' }) }, t('restartStart')))))
      )) : null
    ));
  }

  const CATEGORY_ORDER = ['attention', 'ready', 'active', 'idle', 'blank', 'archived'];
  const CATEGORY_KEY = { attention: 'catAttention', ready: 'catReady', active: 'catActive', idle: 'catIdle', blank: 'catBlank', archived: 'archiveTitle' };

  function PanelIcon({ size = 18, marksStore }) {
    const marks = useStore(marksStore);
    return h('span', { className: 'dshaSr_icon' },
      h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 5.5, r: 2.5 }),
        h('circle', { cx: 5.5, cy: 18, r: 2.5 }),
        h('circle', { cx: 18.5, cy: 18, r: 2.5 }),
        h('path', { d: 'M10.7 7.7 6.8 15.8M13.3 7.7l3.9 8.1M8 18h8' })),
      marks.attention > 0 ? h('span', { className: 'dshaSr_iconBadge', 'aria-label': String(marks.attention) }, marks.attention > 9 ? '9+' : String(marks.attention)) : null
    );
  }

  /* ---------------------------------------------------------------- 会话行与页头 */

  /** 实心五角星（SVG，手机上大小稳定）。 */
  function StarIcon({ size = 12 }) {
    return h('svg', { className: 'dshaSr_starIcon', width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true },
      h('path', { fill: 'currentColor', d: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z' }));
  }

  /**
   * 侧栏会话行前的标记：★ 主会话（实心星）；○ 加入协作的会话（空心圈，有汇报状态时填色）；
   * 已完成为灰点；已放弃、只看版本线没加入的不显示。
   */
  function RowMark({ sessionId, marksStore, t }) {
    const marks = useStore(marksStore);
    const status = marks.marks[sessionId];
    if (status === undefined || status === 'abandoned') return null;
    const label = statusText(t, status);
    if (status === 'main') return h('span', { className: 'dshaSr_lead', title: label, role: 'img', 'aria-label': label }, h(StarIcon, { size: 12 }));
    return h('span', { className: 'dshaSr_lead', title: label, role: 'img', 'aria-label': label }, h('span', { className: 'dshaSr_dot', 'data-status': status }));
  }

  function RowHover({ sessionId, marksStore, t }) {
    const marks = useStore(marksStore);
    const aliases = marks.aliases[sessionId] ?? [];
    const status = marks.marks[sessionId];
    return h('div', { className: 'dshaSr_hover' },
      h('span', null, `${t('sessionId')}：`, h('code', null, sessionId)),
      aliases.length > 0 || status === 'main' ? h('span', null, [...(status === 'main' ? ['@main'] : []), ...aliases.map((name) => '@' + name)].join(' ')) : null,
      status !== undefined && status !== 'main' ? h('span', null, statusText(t, status)) : null
    );
  }

  /** 会话页头的常驻 ID 标签：显示别名或 id 前 8 位，点一下复制完整 id。 */
  function HeaderId({ sessionId, marksStore, t }) {
    const marks = useStore(marksStore);
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef();
    React.useEffect(() => () => clearTimeout(timer.current), []);
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    const aliases = marks.aliases[sessionId] ?? [];
    const isMain = marks.marks?.[sessionId] === 'main' || marks.coordinator === sessionId;
    const label = `${isMain ? '★ ' : ''}${aliases.length > 0 ? '@' + aliases[0] + ' · ' : ''}${shortId(sessionId)}`;
    return h('button', {
      type: 'button', className: 'dshaSr_chip', 'data-copied': copied ? 'true' : undefined,
      title: `${t('copyId')}：${sessionId}`, 'aria-label': `${t('copyId')} ${sessionId}`,
      onClick: async () => {
        const ok = await copyText(sessionId);
        setCopied(ok);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }
    }, copied ? t('idCopied') : label);
  }

  /** “对话 / 轨迹”旁的“协作”标签：当前会话视角的完整看板。 */
  function ConversationRelayView({ sessionId, t, openSession, marksStore }) {
    return h(BoardPage, { t, openSession, marksStore, sessionId, embedded: true });
  }

  /** 错误边界：组件出错时显示错误原文，而不是整块空白（插槽默认吞掉出错的条目）。 */
  class Guard extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error, info) {
      try { console.error('[dsh-session-relay] ' + (this.props.name || 'view') + ' crashed', error, info && info.componentStack); } catch {}
      this.setState({ stack: info && info.componentStack ? String(info.componentStack).trim().split('\n').slice(0, 6).join('\n') : '' });
    }
    render() {
      if (this.state.error === null) return this.props.children;
      if (this.props.quiet) return null;
      const message = String(this.state.error && (this.state.error.stack || this.state.error.message) || this.state.error).split('\n').slice(0, 6).join('\n');
      return h('div', { className: 'dshaSr_page' },
        h('div', { className: 'dshaSr_card' },
          h('p', { className: 'dshaSr_status', 'data-tone': 'error', role: 'alert' }, `会话协作界面出错（${this.props.name}）。请截图发给开发者：`),
          h('pre', { className: 'dshaSr_pre dshaSr_code', style: { maxHeight: 'none' } }, message + (this.state.stack ? '\n--\n' + this.state.stack : '')),
          h('div', { className: 'dshaSr_row' }, h(Button, { onClick: () => this.setState({ error: null, stack: '' }) }, '重试'))));
    }
  }

  function guarded(name, Component, quiet) {
    function Guarded(props) { return h(Guard, { name, quiet }, h(Component, props)); }
    Guarded.displayName = 'Guarded(' + name + ')';
    return Guarded;
  }

  /* ---------------------------------------------------------------- 注册 */

  const inject = ['slots', 'locale'];
  function apply(ctx) {
    const t = ctx.locale.bind(NS);
    const marksStore = createMarksStore();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-relay: dictionaries');
    ctx.effect(() => ensureStyle(), 'dsh-session-relay: style');
    ctx.effect(() => () => marksStore.dispose(), 'dsh-session-relay: marks store');
    const openSession = (sessionId) => {
      try {
        const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
        if (workspace?.openSession) { workspace.openSession(sessionId); return; }
      } catch {}
    };
    ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'session-relay', order: 25, label: () => t('nav'), locale: NS,
      inject: () => ({ t })
    }, guarded('SessionRelaySettings', SessionRelaySettings))), 'dsh-session-relay: settings section');
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel'), locale: NS,
      inject: () => ({ marksStore })
    }, guarded('PanelIcon', PanelIcon, true))), 'dsh-session-relay: panel icon');
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: PANEL_ID, locale: NS,
      inject: () => ({ t, openSession, marksStore })
    }, guarded('BoardPage', BoardPage))), 'dsh-session-relay: board page');
    ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view', id: 'session-relay', order: 20, label: () => t('tab'), locale: NS,
      inject: () => ({ t, openSession, marksStore })
    }, guarded('ConversationRelayView', ConversationRelayView))), 'dsh-session-relay: conversation tab');
    ctx.effect(() => ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
      name: 'sidebar.session.row.leading', id: 'session-relay-mark', order: 5, locale: NS,
      inject: () => ({ t, marksStore })
    }, guarded('RowMark', RowMark, true))), 'dsh-session-relay: row mark');
    ctx.effect(() => ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
      name: 'sidebar.session.row.hover', id: 'session-relay-id', order: 5, locale: NS,
      inject: () => ({ t, marksStore })
    }, guarded('RowHover', RowHover, true))), 'dsh-session-relay: row hover');
    ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'session-relay-id', order: -20, locale: NS,
      inject: () => ({ t, marksStore })
    }, guarded('HeaderId', HeaderId, true))), 'dsh-session-relay: header id');
  }
  return { NS, inject, apply, SessionRelaySettings, BoardPage, ConversationRelayView, RowMark, RowHover, HeaderId, PanelIcon, createMarksStore };
}});
