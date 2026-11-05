window.__ModuleLoader__.load({ id: 'dsh-session-relay', factory: (require) => {
  'use strict';
  /*
   * dsh-session-relay 网页端（改这个文件需要重启 DSH）：
   * - 设置 → 会话协作：版本线公告、指令模板、命令速查、插件状态与热重载；
   * - 会话里“对话 / 轨迹”旁的「协作」标签：本会话身份、版本线、当前工作区（或全部）的看板与操作；
   * - 侧栏「会话监督」面板：同一套看板的全局视角；
   * - 侧栏会话行状态点、悬停卡片里的会话 ID 与协作状态；
   * - 会话页头的 ID 标签：常驻显示别名 / id 前 8 位，点一下复制完整 id；
   * - 右侧边栏「协作」标签：这里只登记类型和空壳，正文在 client.sidebar.js，第一次打开才下载。
   *   只改了 client.sidebar.js 时要 touch 一下本文件，前端热更新只看入口文件的版本。
   * - 设置页、协作标签与会话监督面板的正文在 client.panel.js，第一次打开其中一个才下载；规则同上。
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
    prune: '清理 {n} 个',
    pruneMissing: '清理提交不存在的 {n} 个',
    pruneConfirm: '确认清理 {n} 个',
    pruneHint: '清理 = 移出看板、不再注入协作上下文（不删会话）；会话以后主动汇报会重新加入。「提交本机已不存在」要先核对，单独清理。',
    openRole: '新会话的角色',
    roleMain: '设为主会话',
    roleNone: '不加入协作',
    roleMainReplace: '会替换现在的主会话 {label}（它会收到卸任通知）；要带交接说明请用上面的「主会话交接」。',
    createMain: '新建主会话并打开',
    makeSelfMain: '设本会话为主会话',
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
    hiddenAttention: '侧栏角标里的 {n} 个“需要处理”在其它工作区：',
    hiddenAttentionShow: '切到全部查看',
    pageOverview: '概览',
    findMode: '找会话',
    contentMode: '搜内容',
    findTitle: '找会话',
    findHint: '按会话 id（前几位即可）、@别名或标题找会话，直接在结果上处理：打开、复制 id、唤醒、回复、移出看板、设主会话、加入协作。',
    findPlaceholder: 'id 前几位、@别名或标题…',
    findEmpty: '没有找到匹配的会话。',
    findCount: '找到 {n} 个（显示 {shown}）',
    findNotJoined: '未加入协作',
    findMainOnly: '只看主会话（可不填关键词）',
    pageBoard: '看板',
    pageSearch: '搜索',
    pageOps: '交接与核验',
    tabAttention: '{n} 个需要处理',
    tabOpsAlert: '有核验结果需要看，或声明有问题',
    overviewCounts: '需要处理 {a} · 可合并 {r} · 进行中 {w}',
    overviewToBoard: '去看板',
    setupTitle: '初始化',
    setupHint: '本工作区还缺下面几项；补齐后这张卡片自动消失。',
    setupRoot: '目录：{v}',
    setupNoMain: '还没有主会话：主会话核定版本线、接收汇报。',
    setupSetMain: '设本会话为主会话',
    setupMainHint: '在要当主会话的会话里执行 /relay main here，或从那个会话的「协作」标签打开面板。',
    setupNoLine: '还没有版本线：每个会话每一步都能看到它（基线、合并顺序、推送前检查）。',
    setupLineTemplate: 'main=<commit>（<build>）；合并顺序：…；推送前：npm test',
    setupLineSave: '保存版本线',
    setupNoBoard: '还没有任务看板（.agents/TASKS.md）：建好后会话可以用 peer_task 登记和认领任务。',
    setupInitBoard: '建任务看板',
    setupBoardCreated: '已建任务看板',
    setupNotGit: '这个目录不是 git 仓库：工作树声明、合并核对用不了。需要的话自己在终端 git init（插件不会做）。',
    setupNoRoot: '本工作区还没有登记目录，没法建看板或检查 git。',
    delegTitle: '常设授权',
    delegHint: '你不在时主会话可以自己决定哪些事。只进本工作区主会话的上下文；只有你能改。推送、合并到 main、发布、删除、安装、操作手机仍要你明确同意。下面是建议文字，保存后才生效。',
    delegSet: '已设定（{time}）',
    delegNone: '未设定：主会话遇到要你决定的事会发手机通知，在这里等你点。',
    delegSaved: '常设授权已保存',
    delegCleared: '已清除常设授权',
    foldDelegOn: '已设定',
    foldDelegOff: '未设定',
    askTitle: '等你决定',
    askFrom: '{label} 问 · {time}',
    askAbout: '关于 {label}',
    askDismiss: '忽略',
    askAnswered: '已把选择发给主会话',
    askDismissed: '已忽略',
    wakeLine: '本小时自动唤醒 {n}/{limit} 次，约 {tokens} token',
    wakeUnlimited: '不限',
    wakePaused: '本小时自动唤醒已达上限，已暂停（{time} 起，满一小时自动解除）：模型发的消息只放进收件箱、不唤醒。收件箱里的消息不会因为解除自动唤醒对方。',
    wakeResume: '继续',
    wakeResumed: '已解除暂停，重新计数',
     searchTitle: '搜索对话',
     searchHint: '按关键词查本工作区或全部工作区的用户提示、助手回复、工具调用和结果。结果是只读记录，不会唤醒会话。',
     searchPlaceholder: '输入关键词…',
     searchSubmit: '搜索',
     searchClear: '清除结果',
     searchRegex: '正则',
     searchCase: '区分大小写',
     searchKind: '范围',
     searchKindDefault: '提示、回复、调用、结果、错误',
     searchKindAll: '全部（含思考）',
     searchTool: '工具（可选）',
     searchTurn: '轮次（可选）',
     searchTurnInvalid: '轮次必须是非负整数',
     searchStats: '扫描 {scanned} 个会话，{hits} 处命中{skipped}',
     searchSkipped: '，另有 {n} 个未扫描',
     searchNoResults: '没有命中',
     searchLoading: '正在搜索…',
     searchReadError: '读不到：{v}',
     searchSession: '会话 {v}',
     searchOpen: '打开',
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
    subagentReport: '↳ 子代理 {id}（不是本会话的状态）· {status} · {time}：',
    devTitle: '开发者模式',
    devHint: '默认关闭，对所有工作区生效。开启后在限时内，模型可以只读查看所有工作区的会话（peer_inspect 写任意会话、scope=all 搜索，peer_workspace 读别的工作区会话），用于调试和跨项目排查。发消息、看板、认领、接手、分配仍限本工作区；每次跨工作区读取都记审计。到期自动关闭。',
    devHours: '时长（小时）',
    devEnable: '开启',
    devDisable: '立即关闭',
    devOn: '已开启开发者模式',
    devOffDone: '已关闭开发者模式',
    devActive: '开启中，{time} 自动关闭',
    quickHandoffMain: '整理快照并新建会话接手',
    quickHandoffWorker: '新建会话接手',
    quickHandoffHint: '上下文不够用时：插件先把快照整理好，交给新会话继续，不用手动复制。',
    quickHandoffHot: '本会话上下文约 {k}k，建议现在交接：整理快照后由新会话接手。',
    quickHandoffDone: '已发起交接',
    devBanner: '开发者模式开启中：模型可只读查看所有工作区，{time} 自动关闭',
    devOff: '关闭',
    ghTitle: 'GitHub 账号',
    setLineSum: '{n} 个工作区',
    setWsNoLine: '还没有公告',
    setTplSum: '{n} 个模板',
    setRefSum: '{groups} 组 · {items} 条',
    refNotesTitle: '使用说明',
    setPluginSum: '已加载 {v} · 第 {g} 次',
    ghHint: '本机所有会话共用一个 gh 登录。锁定后记下账号数字 id（改名不算换号）；之后发现换了号或退出登录，这里标红、发一次手机通知，relay 自己的 CI 核验暂停，直到你确认。登录验证码只在这里显示，不进模型上下文和日志。',
    ghSourceGh: '来源：本机 gh',
    ghSourceShell: '来源：DSHA 凭据',
    ghNone: '还没有读到身份',
    ghMissing: '还没有登录 GitHub',
    ghUnavailable: '本机没有 gh',
    ghError: '读取失败：{v}',
    ghReady: '已登录 @{login}（id {id}）',
    ghScopes: '权限：{v}',
    ghPinnedOk: '已锁定 @{login}，一致',
    ghPinnedBad: '当前是 @{login}，不是锁定的 @{pinned}。relay 已暂停自己的 gh 调用。确认是你本人换的号，就重新锁定；否则去终端检查 gh auth status',
    ghPinnedGone: '锁定的 @{pinned} 已退出登录；重新登录或解除锁定',
    ghUnpinnedNote: '还没锁定：换号不会报警',
    ghRefresh: '重新读取',
    ghLogin: '登录 GitHub',
    ghPin: '这是我，锁定',
    ghRepin: '确认换号，锁定当前账号',
    ghUnpin: '解除锁定',
    ghPinDone: '已锁定 GitHub 账号',
    ghUnpinDone: '已解除锁定',
    ghCode: '在 GitHub 页面输入验证码',
    ghCodeOpened: '授权页已在手机上打开；没打开就点下面的网址。',
    ghCodeOpen: '打开授权页：',
    ghCancel: '取消登录',
    ghCancelled: '已取消登录',
    ghFlowDone: '登录完成',
    ghFlowFailed: '登录没有完成：{v}',
    ghFlowExpired: '验证码已过期，重新登录',
    ghCopyCode: '复制验证码',
    ghSumOk: '@{login} · 已锁定',
    ghSumBad: '身份不一致',
    ghSumReady: '@{login}',
    ghSumOut: '未登录',
    ghPillOut: 'GitHub 未登录',
    ghPillOutHint: 'GitHub 未登录；去设置页「运维 → GitHub 账号」登录',
    ghPillMismatch: '当前 GitHub 账号 @{login} 不是锁定的 @{pinned}；relay 已暂停自己的 gh 调用',
    ghPillPinned: 'GitHub @{login}（已锁定）',
    ghPillUnpinned: 'GitHub @{login}（未锁定）',
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
    hoHistoryMore: '全部 {n} 条',
    hoHistoryLess: '只看最近',
    hoLatest: '上次交接 {time}',
    hoRevert: '设回主会话',
    workspaceIs: '工作区：{v}',
    wsPick: '工作区',
    modelLabel: '模型',
    modelEffort: '推理强度',
    modelEffortDefault: '推理强度：默认',
    modelEffortDefaultIs: '推理强度：默认（{v}）',
    modelLoading: '读取模型列表…',
    modelUnsupported: '读不到模型列表：新会话用 DSH 默认模型',
    modelFollow: '跟随默认',
    modelFollowIs: '跟随默认（{v}）',
    modelFollowSource: '原会话 {v}',
    modelGlobalDefault: 'DSH 全局默认（{v}）',
    modelGlobalDefaultBare: 'DSH 全局默认',
    modelIs: '模型 {v}',
    modelNotApplied: '没有设上指定模型：{v}',
    modelRolesTitle: '新建会话用的模型',
    modelRolesSum: '主会话 {main} · 工作会话 {worker}',
    modelRolesHint: '本工作区新建会话时用的模型，只有你能改；各新建表单还能当场临时改。给会话设模型不会改动 DSH 的全局默认模型。',
    modelRoleMain: '主会话模型',
    modelRoleMainHint: '新建主会话、交接给新会话、主会话换新时用。',
    modelRoleWorker: '工作会话模型',
    modelRoleWorkerHint: '新建工作会话、拉起认领会话、模型调 peer_spawn 时用；接手 / 唤醒新建时先沿用原会话的模型，读不到再用它。',
    modelRoleNow: '当前：{v}',
    wsPickMain: '（有主会话）',
    sessionId: '会话 ID',
    copyId: '复制会话 ID',
    idCopied: '已复制会话 ID',
    sideTitle: '协作',
    sideGuide: '本工作区的主会话、版本线、看板和任务',
    sideLoading: '正在加载协作面板…',
    sideAlertGhGone: '锁定的 GitHub 账号已退出登录；去设置 → 会话协作重新登录',
    sideAlertWake: '本小时自动唤醒已达上限，已暂停',
    sideAlertHandoff: '有一份主会话交接草稿等你确认（协作页 → 交接与核验）',
    sideAlertDecl: '工作树声明有 {n} 处和看板对不上',
    sideWatching: '核验中 {n} 项：{what}',
    sideCountOpenN: '待领 {n}',
    sideMoreTasks: '还有 {n} 条',
    sideDoneN: '已结束 {n}',
    sideRefreshing: '刷新中…',
    sideReplied: '已发给 {label}',
    sideAssigned: '已给 {label} 分配 {v}',
    sideWoken: '已唤醒 {label}',
    sideWakeAsk: '原地唤醒 {label}？会替你发一条「继续」，让它先核对状态再接着做。',
    sideMainSelf: '就是你现在所在的会话',
    sideDoneMore: '还有 {n} 条，去协作页看板查看',
    panelLoading: '正在加载…',
    panelLoadFailed: '会话协作页面加载失败，刷新网页再试',
    panelStale: '会话协作刚更新过，刷新网页即可',
    sideLoadFailed: '协作面板加载失败',
    sideStale: '协作面板刚更新过，请关掉这个标签再打开一次',
    sideBoard: '看板（{n}）',
    sideTasks: '任务看板：{open} 张待领，{claimed} 张已认领',
    sideNoTasks: '还没有任务看板',
    sideOthers: '另有 {n} 个会话未加入协作',
    sideJustNow: '刚刚更新',
    sideMinAgo: '{n} 分钟前',
    sideHourAgo: '{n} 小时前',
    sideCountAttention: '需要处理',
    sideCountActive: '进行中',
    sideCountReady: '可合并',
    sideCountOpen: '待领任务',
    sideFAll: '全部',
    sideFAttention: '需要处理',
    sideFActive: '进行中',
    sideFReady: '可合并',
    sideFDone: '已结束',
    sideFEmpty: '这一类没有会话',
    sideBack: '返回列表',
    sideMore: '展开',
    sideLess: '收起',
    sideClaimed: '{n} 张已认领',
    sideDetailSummary: '摘要',
    sideDetailInfo: '信息',
    sideDetailFiles: '占用文件',
    sideDetailDecl: '工作树声明',
    sideDetailIssues: '冲突与提醒',
    sideState: '状态',
    sideModel: '模型',
    sideUpdated: '更新',
    sideBranch: '分支',
    sideWorktree: '工作树',
    sideBase: '分叉自',
    sideCommit: '提交',
    sideQueue: '合并队列',
    sideAssigned: '已分配',
    sideOverlap: '与 {label} 占用重叠：{paths}',
    sideNoOpenTasks: '没有待领任务'
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
    prune: 'Clear {n}',
    pruneMissing: 'Clear {n} with missing commits',
    pruneConfirm: 'Confirm: clear {n}',
    pruneHint: 'Clearing removes entries from the board and stops collaboration context (sessions are not deleted); a session rejoins when it reports again. Missing commits need checking first, so they are cleared separately.',
    openRole: 'Role of the new session',
    roleMain: 'Make it the main session',
    roleNone: 'Do not join',
    roleMainReplace: 'Replaces the current main session {label} (it is told to step down); use “Main session handoff” above to pass notes.',
    createMain: 'Create main session and open',
    makeSelfMain: 'Make this session main',
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
    subagentReport: '↳ Subagent {id} (not this session\'s own status) · {status} · {time}: ',
    devTitle: 'Developer mode',
    devHint: 'Off by default and applies to every workspace. While on, models may read sessions of every workspace (peer_inspect with any session or scope=all search, peer_workspace on another workspace\'s session) for debugging and cross-project checks. Sending, board, claims, takeover and assignment stay limited to their workspace; every cross-workspace read is audited. Turns itself off when the time is up.',
    devHours: 'Hours',
    devEnable: 'Turn on',
    devDisable: 'Turn off now',
    devOn: 'Developer mode on',
    devOffDone: 'Developer mode off',
    devActive: 'On until {time}',
    quickHandoffMain: 'Prepare snapshot and hand off to a new session',
    quickHandoffWorker: 'Hand off to a new session',
    quickHandoffHint: 'Running out of context? The plugin prepares the snapshot and a new session continues.',
    quickHandoffHot: 'This session is at about {k}k tokens. Hand off now: the snapshot is prepared and a new session takes over.',
    quickHandoffDone: 'Handoff started',
    devBanner: 'Developer mode on: models may read every workspace until {time}',
    devOff: 'Off',
    ghTitle: 'GitHub account',
    setLineSum: '{n} workspaces',
    setWsNoLine: 'No announcement yet',
    setTplSum: '{n} templates',
    setRefSum: '{groups} groups · {items} commands',
    refNotesTitle: 'How it works',
    setPluginSum: 'Loaded {v} · load #{g}',
    ghHint: 'Every session on this device shares one gh login. Pinning records the numeric account id (a rename is not a switch). If the account later changes or logs out, this turns red, sends one phone notification and pauses relay\'s own CI checks until you confirm. The login code is shown only here, never in model context or logs.',
    ghSourceGh: 'Source: local gh',
    ghSourceShell: 'Source: DSHA credentials',
    ghNone: 'Identity not read yet',
    ghMissing: 'Not logged in to GitHub',
    ghUnavailable: 'gh is not installed',
    ghError: 'Read failed: {v}',
    ghReady: 'Logged in as @{login} (id {id})',
    ghScopes: 'Scopes: {v}',
    ghPinnedOk: 'Pinned @{login}, matches',
    ghPinnedBad: 'Current account is @{login}, not the pinned @{pinned}. relay paused its own gh calls. If you switched on purpose, pin again; otherwise check gh auth status in a terminal',
    ghPinnedGone: 'Pinned @{pinned} is logged out; log in again or unpin',
    ghUnpinnedNote: 'Not pinned: account switches are not reported',
    ghRefresh: 'Read again',
    ghLogin: 'Log in to GitHub',
    ghPin: 'This is me, pin',
    ghRepin: 'Accept switch, pin current account',
    ghUnpin: 'Unpin',
    ghPinDone: 'GitHub account pinned',
    ghUnpinDone: 'Unpinned',
    ghCode: 'Enter this code on GitHub',
    ghCodeOpened: 'The authorization page was opened on the phone; if not, use the link below.',
    ghCodeOpen: 'Open authorization page: ',
    ghCancel: 'Cancel login',
    ghCancelled: 'Login cancelled',
    ghFlowDone: 'Login complete',
    ghFlowFailed: 'Login did not complete: {v}',
    ghFlowExpired: 'Code expired, log in again',
    ghCopyCode: 'Copy code',
    ghSumOk: '@{login} · pinned',
    ghSumBad: 'Identity mismatch',
    ghSumReady: '@{login}',
    ghSumOut: 'Not logged in',
    ghPillOut: 'GitHub logged out',
    ghPillOutHint: 'GitHub is logged out; log in from Settings → Ops → GitHub account',
    ghPillMismatch: 'Current GitHub account @{login} is not the pinned @{pinned}; relay paused its own gh calls',
    ghPillPinned: 'GitHub @{login} (pinned)',
    ghPillUnpinned: 'GitHub @{login} (not pinned)',
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
    hoHistoryMore: 'All {n}',
    hoHistoryLess: 'Latest only',
    hoLatest: 'last handoff {time}',
    hoRevert: 'Make main again',
    scopeHidden: '{n} more worker sessions in other workspaces',
    hiddenAttention: '{n} item(s) counted in the sidebar badge need attention in other workspaces:',
    hiddenAttentionShow: 'Show all',
    pageOverview: 'Overview',
    findMode: 'Find session',
    contentMode: 'Search content',
    findTitle: 'Find session',
    findHint: 'Find a session by id (a few leading characters), @alias or title, then act on it in place: open, copy id, wake, reply, remove from board, make main, join.',
    findPlaceholder: 'id prefix, @alias or title…',
    findEmpty: 'No matching sessions.',
    findCount: '{n} found (showing {shown})',
    findNotJoined: 'not joined',
    findMainOnly: 'Main sessions only (keyword optional)',
    pageBoard: 'Board',
    pageSearch: 'Search',
    pageOps: 'Handoff & checks',
    tabAttention: '{n} need attention',
    tabOpsAlert: 'Watch results need attention, or declaration issues',
    overviewCounts: 'Attention {a} · Ready {r} · Active {w}',
    overviewToBoard: 'Open board',
    setupTitle: 'Setup',
    setupHint: 'This workspace is missing the items below; the card disappears once they are in place.',
    setupRoot: 'Directory: {v}',
    setupNoMain: 'No main session yet: the main session owns the version line and receives reports.',
    setupSetMain: 'Make this session main',
    setupMainHint: 'Run /relay main here in the session that should be main, or open the panel from that session\'s Collaboration tab.',
    setupNoLine: 'No version line yet: every session sees it each step (baseline, merge order, pre-push checks).',
    setupLineTemplate: 'main=<commit> (<build>); merge order: …; before push: npm test',
    setupLineSave: 'Save version line',
    setupNoBoard: 'No task board (.agents/TASKS.md) yet: once created, sessions can register and claim tasks with peer_task.',
    setupInitBoard: 'Create task board',
    setupBoardCreated: 'Task board created',
    setupNotGit: 'This directory is not a git repository: worktree declarations and merge checks are unavailable. Run git init yourself if needed (the plugin will not).',
    setupNoRoot: 'This workspace has no registered directory, so no board can be created and git cannot be checked.',
    delegTitle: 'Standing delegation',
    delegHint: 'What the main session may decide on its own while you are away. Only the main session of this workspace sees it; only you can change it. Push, merge to main, release, delete, install and phone actions still need your explicit approval. The text below is a suggestion and takes effect only after you save.',
    delegSet: 'Set ({time})',
    delegNone: 'Not set: when the main session needs you, it sends a phone notification and waits for your choice here.',
    delegSaved: 'Standing delegation saved',
    delegCleared: 'Standing delegation cleared',
    foldDelegOn: 'set',
    foldDelegOff: 'not set',
    askTitle: 'Needs your decision',
    askFrom: '{label} asks · {time}',
    askAbout: 'about {label}',
    askDismiss: 'Ignore',
    askAnswered: 'Choice sent to the main session',
    askDismissed: 'Ignored',
    wakeLine: 'Automatic wakes this hour {n}/{limit}, ~{tokens} tokens',
    wakeUnlimited: 'unlimited',
    wakePaused: 'Automatic wakes reached this hour\'s limit and are paused (since {time}, lifts automatically after an hour): messages from models only go to inboxes without waking anyone. Resuming does not wake sessions for messages already in their inboxes.',
    wakeResume: 'Resume',
    wakeResumed: 'Resumed; counting restarts',
     searchTitle: 'Search conversations',
     searchHint: 'Search user prompts, assistant replies, tool calls and results in this workspace or all workspaces. Results are read-only and do not wake sessions.',
     searchPlaceholder: 'Enter a keyword…',
     searchSubmit: 'Search',
     searchClear: 'Clear results',
     searchRegex: 'Regex',
     searchCase: 'Match case',
     searchKind: 'Content',
     searchKindDefault: 'Prompts, replies, calls, results, errors',
     searchKindAll: 'Everything (including reasoning)',
     searchTool: 'Tool (optional)',
     searchTurn: 'Turn (optional)',
     searchTurnInvalid: 'Turn must be a non-negative integer',
     searchStats: 'Scanned {scanned} sessions, {hits} hits{skipped}',
     searchSkipped: ', {n} more not scanned',
     searchNoResults: 'No matches',
     searchLoading: 'Searching…',
     searchReadError: 'Could not read: {v}',
     searchSession: 'Session {v}',
     searchOpen: 'Open',
    workspaceIs: 'Workspace: {v}',
    wsPick: 'Workspace',
    modelLabel: 'Model',
    modelEffort: 'Reasoning effort',
    modelEffortDefault: 'Effort: default',
    modelEffortDefaultIs: 'Effort: default ({v})',
    modelLoading: 'Loading models…',
    modelUnsupported: 'Model list unavailable: new sessions use the DSH default model',
    modelFollow: 'Follow default',
    modelFollowIs: 'Follow default ({v})',
    modelFollowSource: 'original session {v}',
    modelGlobalDefault: 'DSH global default ({v})',
    modelGlobalDefaultBare: 'DSH global default',
    modelIs: 'Model {v}',
    modelNotApplied: 'The chosen model was not applied: {v}',
    modelRolesTitle: 'Models for new sessions',
    modelRolesSum: 'Main {main} · Worker {worker}',
    modelRolesHint: 'Models used when sessions are created in this workspace. Only you can change them; every create form can override them once. Setting a session model never changes the DSH global default.',
    modelRoleMain: 'Main session model',
    modelRoleMainHint: 'Used for a new main session, a handoff to a new session, and renewing the main session.',
    modelRoleWorker: 'Worker session model',
    modelRoleWorkerHint: 'Used for new worker sessions, claim sessions and model peer_spawn; takeover / wake into a new session first keeps the original session model, then falls back to this.',
    modelRoleNow: 'Current: {v}',
    wsPickMain: ' (has main)',
    sessionId: 'Session ID',
    copyId: 'Copy session ID',
    idCopied: 'Session ID copied',
    sideTitle: 'Relay',
    sideGuide: 'Main session, version line, board and tasks of this workspace',
    sideLoading: 'Loading the relay pane…',
    sideAlertGhGone: 'The pinned GitHub account is logged out; log in again under Settings → Session relay',
    sideAlertWake: 'Automatic wakes hit this hour\'s limit and are paused',
    sideAlertHandoff: 'A main-session handoff draft is waiting for you (relay tab → Handoff & checks)',
    sideAlertDecl: '{n} worktree declarations do not match the board',
    sideWatching: 'Watching {n}: {what}',
    sideCountOpenN: '{n} open',
    sideMoreTasks: '{n} more',
    sideDoneN: 'Finished {n}',
    sideRefreshing: 'Refreshing…',
    sideReplied: 'Sent to {label}',
    sideAssigned: 'Assigned {v} to {label}',
    sideWoken: 'Woke {label}',
    sideWakeAsk: 'Resume {label} in place? A "continue" is sent for you; it re-checks state first.',
    sideMainSelf: 'This is the session you are in',
    sideDoneMore: '{n} more on the relay tab board',
    panelLoading: 'Loading…',
    panelLoadFailed: 'Session relay failed to load; refresh the page',
    panelStale: 'Session relay was just updated; refresh the page',
    sideLoadFailed: 'The relay pane failed to load',
    sideStale: 'The relay pane was just updated: close this tab and open it again',
    sideBoard: 'Board ({n})',
    sideTasks: 'Task board: {open} open, {claimed} claimed',
    sideNoTasks: 'No task board yet',
    sideOthers: '{n} more sessions have not joined',
    sideJustNow: 'Updated just now',
    sideMinAgo: '{n} min ago',
    sideHourAgo: '{n} h ago',
    sideCountAttention: 'need you',
    sideCountActive: 'active',
    sideCountReady: 'mergeable',
    sideCountOpen: 'open tasks',
    sideFAll: 'All',
    sideFAttention: 'Need you',
    sideFActive: 'Active',
    sideFReady: 'Mergeable',
    sideFDone: 'Ended',
    sideFEmpty: 'No sessions in this group',
    sideBack: 'Back to list',
    sideMore: 'More',
    sideLess: 'Less',
    sideClaimed: '{n} claimed',
    sideDetailSummary: 'Summary',
    sideDetailInfo: 'Details',
    sideDetailFiles: 'Files in use',
    sideDetailDecl: 'Worktree declaration',
    sideDetailIssues: 'Conflicts and warnings',
    sideState: 'State',
    sideModel: 'Model',
    sideUpdated: 'Updated',
    sideBranch: 'Branch',
    sideWorktree: 'Worktree',
    sideBase: 'Forked from',
    sideCommit: 'Commit',
    sideQueue: 'Merge queue',
    sideAssigned: 'Assigned',
    sideOverlap: 'Overlaps {label}: {paths}',
    sideNoOpenTasks: 'No open tasks'
  };

  const css = [
    // 主题 token：强调色跟宿主的蓝色按钮（多主题时只改这里或由主题覆盖 --dsw-alias-*）
    '.dshaSr,.dshaSr_page{--dshaR-accent:var(--dsw-alias-button-info-fill,var(--dsw-alias-link,#4176e6));--dshaR-accent-hover:var(--dsw-alias-button-info-hover,var(--dshaR-accent));--dshaR-on-accent:#fff;--dshaR-radius:8px;--dshaR-radius-s:6px}',
    '.dshaSr{display:grid;gap:24px;color:var(--dsw-alias-label-primary);container-type:inline-size}',
    '.dshaSr_intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}',
    '.dshaSr_sec{display:grid;gap:10px}',
    '.dshaSr_h{margin:0;font-size:15px;font-weight:600;line-height:1.4}',
    '.dshaSr_hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}',
    '.dshaSr_card{display:grid;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
    '.dshaSr_label{font-size:13px;font-weight:500}',
    '.dshaSr_input,.dshaSr_area{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}',
    '.dshaSr_area{min-height:96px;resize:vertical;font-family:inherit;white-space:pre-wrap}',
    '.dshaSr_input:focus-visible,.dshaSr_area:focus-visible,.dshaSr_btn:focus-visible,.dshaSr_chip:focus-visible{outline:2px solid var(--dshaR-accent);outline-offset:1px}',
    '.dshaSr_row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.dshaSr_spacer{flex:1 1 auto}',
    '.dshaSr_btn{appearance:none;min-height:32px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}',
    '.dshaSr_btn[data-variant=primary]{border-color:transparent;background:var(--dshaR-accent);color:var(--dshaR-on-accent);font-weight:600}',
    '.dshaSr_btn[data-variant=primary]:hover:not(:disabled){background:var(--dshaR-accent-hover)}',
    '.dshaSr_btn:disabled{opacity:.5;cursor:default}',
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
    '.dshaSr_badge[data-status=main]{color:var(--dshaR-accent);border-color:var(--dshaR-accent)}',
    '.dshaSr_entryHead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}',
    '.dshaSr_entryName{font-weight:600;font-size:14px;min-width:0;overflow-wrap:anywhere}',
    '.dshaSr_check{display:flex;align-items:flex-start;gap:8px;font-size:13px}',
    // 状态点、页头 ID 标签、悬停卡片
    '.dshaSr_dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none}',
    '.dshaSr_dot[data-status=question]{background:var(--dsw-alias-state-warn-primary)}',
    '.dshaSr_dot[data-status=blocked]{background:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_dot[data-status=ready]{background:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_dot[data-status=working]{background:transparent;border:1.5px solid var(--dsw-alias-state-idle-primary);box-sizing:border-box}',
    '.dshaSr_star{font-size:11px;line-height:1;color:var(--dshaR-accent)}',
    '.dshaSr_starIcon{display:block;flex:none;color:var(--dshaR-accent)}',
    '.dshaSr_dot[data-status=joined]{background:transparent;border:1.5px solid var(--dsw-alias-state-idle-primary);box-sizing:border-box}',
    '.dshaSr_dot[data-status=done]{background:var(--dsw-alias-label-tertiary,var(--dsw-alias-state-idle-primary));opacity:.6}',
    // 单选项一行一个：长说明在手机上换行时不会和别的选项挤在一起
    '.dshaSr_radio{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;font-size:13px}',
    '.dshaSr_radio label{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:8px;min-height:28px;padding:2px 0;cursor:pointer;overflow-wrap:anywhere}',
    '.dshaSr_radio input{margin:2px 0 0}',
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
    '.dshaSr_card[data-self=true]{border-color:var(--dshaR-accent)}',
    '.dshaSr_idline{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}',
    '.dshaSr_idShort{display:none}',
    '.dshaSr_modeSeg{justify-self:start}',
    '.dshaSr_findForm{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}',
    '.dshaSr_findRow{gap:4px}',
    '.dshaSr_hoRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l2)}',
    '.dshaSr_hoText{display:grid;gap:2px;min-width:0}',
    '.dshaSr_hoWho{font-size:13px;overflow-wrap:anywhere}',
    '.dshaSr_tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2)}',
    '.dshaSr_tabs::-webkit-scrollbar{display:none}',
    '.dshaSr_tab{appearance:none;flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:4px 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}',
    '.dshaSr_tab[aria-selected=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}',
    '.dshaSr_tab:focus-visible{outline:2px solid var(--dshaR-accent);outline-offset:-2px}',
    '.dshaSr_tabBadge{min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-bg-base);font-size:10px;line-height:16px;text-align:center;font-weight:600}',
    '.dshaSr_tabBadge[data-tone=error]{background:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_tabPanel{display:grid;gap:10px;align-content:start;min-width:0}',
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
    '.dshaSr_foldBtn:focus-visible,.dshaSr_iconBtn:focus-visible{outline:2px solid var(--dshaR-accent);outline-offset:2px;border-radius:6px}',
    '.dshaSr_chev{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .15s}',
    '.dshaSr_fold[data-open=true]>.dshaSr_foldHead .dshaSr_chev{transform:rotate(90deg)}',
    '.dshaSr_foldName{flex:0 1 auto;min-width:0}',
    '.dshaSr_foldSum{flex:1 1 8em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}',
    '.dshaSr_foldSum[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_foldActs{display:flex;align-items:center;gap:6px;flex:none}',
    '.dshaSr_foldBody{display:grid;gap:6px;min-width:0}',
    '.dshaSr_iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
    '.dshaSr_iconBtn[aria-pressed=true]{color:var(--dshaR-accent);border-color:var(--dsw-alias-border-l2)}',
    '.dshaSr_link{appearance:none;padding:0;border:0;background:transparent;color:var(--dshaR-accent);font:inherit;font-size:12px;cursor:pointer;justify-self:start}',
    '.dshaSr_link:focus-visible{outline:2px solid var(--dshaR-accent);outline-offset:1px}',
    '.dshaSr_clamp{max-height:4.8em;overflow:hidden}',
    '.dshaSr_idchip{max-width:100%;flex:0 1 auto}',
    '.dshaSr_fields{display:grid;gap:6px 10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}',
    '.dshaSr_field{display:grid;gap:4px;min-width:0}',
    '.dshaSr_more{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}',
     '.dshaSr_searchForm{display:grid;gap:8px}',
     '.dshaSr_searchControls{display:grid;gap:8px;grid-template-columns:minmax(0,2fr) minmax(8em,1fr) minmax(7em,1fr)}',
     '.dshaSr_searchOptions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
     '.dshaSr_searchOptions label{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px}',
     '.dshaSr_searchGroup{display:grid;gap:6px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
     '.dshaSr_searchHit{display:grid;gap:3px;padding:7px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.5}',
     '.dshaSr_searchHitText{overflow-wrap:anywhere}',
     '@container (max-width:560px){.dshaSr_searchControls{grid-template-columns:minmax(0,1fr)}}',
    '@media (pointer:coarse){.dshaSr_btn{min-height:36px}.dshaSr_chip{height:30px}.dshaSr_seg button{min-height:34px}.dshaSr_iconBtn{width:36px;height:36px}.dshaSr_foldBtn{min-height:40px}.dshaSr_link{min-height:32px}}',
    '@media (prefers-reduced-motion:reduce){.dshaSr_chev{transition:none}}',
    '@container (min-width:760px){.dshaSr_cols{grid-template-columns:minmax(0,3fr) minmax(300px,2fr)}}',
    '@container (max-width:480px){.dshaSr_idFull{display:none}.dshaSr_idShort{display:inline}.dshaSr_tab{padding:4px 8px;font-size:12px}.dshaSr_tabPanel{gap:8px}.dshaSr_pageIn{padding:8px 8px 24px;gap:8px}.dshaSr_cols,.dshaSr_col{gap:8px}.dshaSr_page .dshaSr_card{padding:8px 10px}.dshaSr_title{font-size:16px}}',
    // 右侧边栏的样式在 client.sidebar.js 里，打开标签才注入；这里只留加载提示一行
    '.dshaSr_side{box-sizing:border-box;padding:10px 12px;font-size:13px}',
    // 与右侧栏统一：紧凑；选中与主操作用强调色
    '.dshaSr_btn{min-height:28px;padding:2px 10px;border-radius:var(--dshaR-radius-s);background:transparent;font-size:12px}',
    '.dshaSr_btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
    '.dshaSr_btn[data-variant=primary]:hover:not(:disabled){background:var(--dshaR-accent-hover)}',
    '.dshaSr_card{border-radius:var(--dshaR-radius)}',
    '.dshaSr_fold{border-radius:var(--dshaR-radius);padding:6px 12px}',
    '.dshaSr_foldBtn{min-height:30px}',
    '.dshaSr_tab[aria-selected=true]{background:transparent;color:var(--dshaR-accent);box-shadow:inset 0 -2px 0 var(--dshaR-accent)}',
    '.dshaSr_seg button[aria-pressed=true]{background:transparent;color:var(--dshaR-accent);box-shadow:inset 0 0 0 1px var(--dshaR-accent)}',
    '.dshaSr_page .dshaSr_card[data-status]{position:relative;padding-left:15px;overflow:hidden}',
    '.dshaSr_page .dshaSr_card[data-status]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent}',
    '.dshaSr_page .dshaSr_card[data-status=working]::before{background:var(--dshaR-accent)}',
    '.dshaSr_page .dshaSr_card[data-status=question]::before{background:var(--dsw-alias-state-warn-primary)}',
    '.dshaSr_page .dshaSr_card[data-status=blocked]::before{background:var(--dsw-alias-state-error-primary)}',
    '.dshaSr_page .dshaSr_card[data-status=ready]::before{background:var(--dsw-alias-state-success-primary)}',
    '.dshaSr_a{color:var(--dshaR-accent)}',
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

  /* ---------------------------------------------------------------- 协作面板与设置页（按需加载） */

  // 正文在 client.panel.js：第一次打开设置页、协作标签或会话监督面板才下载执行。
  // 改动顺序同右侧边栏：先写 client.panel.js，最后写本文件；kit 字段变了两边版本号一起加 1。
  const PANEL_KIT = 1;
  function statusText(t, status) {
    return status ? t('status_' + status) : '';
  }

  function stateText(t, state) {
    return { running: t('stateRunning'), idle: t('stateIdle'), cold: t('stateCold'), gone: t('stateGone') }[state] ?? '';
  }

  let panelModule;
  function panelKit() {
    return { format, formatTime, shortId, request, copyText, errorText, Button, Status, useFlash, StarIcon, statusText, stateText };
  }
  /** 测试与同步场景：直接拿到正文模块（kit 已注入）。 */
  function loadPanel(mod) {
    if (!mod || mod.KIT_VERSION !== PANEL_KIT || typeof mod.make !== 'function') return undefined;
    return mod.make(panelKit());
  }
  function panelPart(name) {
    let Lazy;
    function PanelPart(props) {
      if (Lazy === undefined) {
        if (typeof React.lazy !== 'function' || typeof require.async !== 'function') return h('p', { className: 'dshaSr_meta' }, props.t ? props.t('panelLoadFailed') : '');
        if (panelModule === undefined) panelModule = require.async('./client.panel.js').then((mod) => loadPanel(mod) ?? { stale: true }, () => null);
        Lazy = React.lazy(() => panelModule.then((parts) => ({ default: (typeof parts?.[name] === 'function' ? parts[name] : undefined) ?? (({ t }) => h('p', { className: 'dshaSr_meta', role: 'status' }, t ? t(parts?.stale ? 'panelStale' : 'panelLoadFailed') : '')) })));
      }
      return h(React.Suspense, { fallback: h('p', { className: 'dshaSr_meta', role: 'status' }, props.t ? props.t('panelLoading') : '') }, h(Lazy, props));
    }
    PanelPart.displayName = 'Panel(' + name + ')';
    return PanelPart;
  }
  const SessionRelaySettings = panelPart('SessionRelaySettings');
  const BoardPage = panelPart('BoardPage');
  const SessionFind = panelPart('SessionFind');
  const ConversationRelayView = panelPart('ConversationRelayView');

  /* ---------------------------------------------------------------- 面板图标（常驻） */

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

  /* ---------------------------------------------------------------- 右侧边栏 */

  // 入口只登记标签类型和一个空壳；正文 client.sidebar.js 第一次打开标签时才下载执行。
  // 分出去的文件不能同步 require 别的 client*.js，共用部件经 kit 传进去。
  const SIDEBAR_TYPE_ID = 'dsh-session-relay/sidebar';
  // kit 接口版本：改了传给 client.sidebar.js 的字段就加 1，两边一起改。
  // 浏览器拿到旧版正文（热更新间隙被缓存）时显示提示，不让 React 拿 undefined 当组件崩掉。
  // 改动顺序：先写 client.sidebar.js，最后写本文件，版本号在两个文件都就绪后才变。
  const SIDEBAR_KIT = 2;
  function makeSidebarTab(kit) {
    const Stale = () => h('p', { className: 'dshaSr_side dshaSr_meta', role: 'status' }, kit.t('sideStale'));
    const Lazy = typeof React.lazy === 'function' && typeof require.async === 'function'
      ? React.lazy(() => require.async('./client.sidebar.js').then((mod) => ({ default: mod.KIT_VERSION === SIDEBAR_KIT && typeof mod.RelaySidebar === 'function' ? mod.RelaySidebar : Stale })))
      : undefined;
    function RelaySidebarTab({ sessionId, useTabInfo }) {
      if (Lazy === undefined) return h('p', { className: 'dshaSr_side dshaSr_meta' }, kit.t('sideLoadFailed'));
      return h(React.Suspense, { fallback: h('p', { className: 'dshaSr_side dshaSr_meta' }, kit.t('sideLoading')) },
        h(Lazy, { kit, sessionId, useTabInfo }));
    }
    return RelaySidebarTab;
  }

  function registerSidebar(sub, t, openSession) {
    const Tab = guarded('RelaySidebarTab', makeSidebarTab({ t, format, formatTime, shortId, statusText, stateText, request, errorText, copyText, openSession }));
    sub.effect(() => sub.sidebarRightTabs.register({
      id: SIDEBAR_TYPE_ID, kind: 'session-relay', title: () => t('sideTitle'),
      guide: [{ id: 'board', order: 40, title: () => t('sideTitle'), description: () => t('sideGuide') }]
    }), 'dsh-session-relay: right sidebar type');
    sub.effect(() => sub.slots.inject('sidebar.right.pane.tab', () => sub.slots.register({
      name: 'sidebar.right.pane.tab', key: SIDEBAR_TYPE_ID, locale: NS,
      inject: (sessionId) => ({ sessionId })
    }, Tab)), 'dsh-session-relay: right sidebar body');
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
    // 右侧边栏是可选服务：没有它（旧宿主、无头）时什么都不登记；有它时随子 fiber 一起卸载
    if (typeof ctx.inject === 'function') ctx.inject(['slots', 'sidebarRightTabs'], (sub) => registerSidebar(sub, t, openSession));
  }
  return { NS, inject, apply, loadPanel, PANEL_KIT, registerSidebar, makeSidebarTab, SIDEBAR_TYPE_ID, SessionRelaySettings, BoardPage, SessionFind, ConversationRelayView, RowMark, RowHover, HeaderId, PanelIcon, createMarksStore };
}});
