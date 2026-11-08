window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.tasks42.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar42.js 按需 require.async 加载；共用件与图标经
    // make(deps) 传入，不跨 chunk 同步 require（DSH 模块协议只支持自包含 chunk）。
    function make(deps) {
      const React = deps.React;
      const h = deps.h;
      const {
        IconRefresh, IconCopy, IconBack, IconOpen, IconStar, IconGear, IconMap, IconList, IconSearch, IconChecklist,
        IconHandoff, IconActivity, IconFolder, IconTarget, IconPlay, IconCheck, IconArchive, IconPr, IconBranch, IconIssue,
        IconMore, IconMail
      } = deps.icons;
      const {
        Card, CopyId, stop, keep, richLines, richSummary, BackMore, SyncStatus,
        WorkItemChips, WorkItemDetail, useLazyDetail, prefetchWorkItemDetail, workItemTabKey, workItemCacheClear, WORK_ITEM_TTL_MS,
        useRemoteList, PopoverPicker, ModelSelect, ModelEffort, useModelsView, modelField, modelsCache, modelSelectValue
      } = deps.shared;
      const { agoText, categoryOf, isAttention, isReady, isActive, isDone, collectPrs, FOLD_PAGES, memo, usePersisted } = deps.ui;


    /** 只读的 GitHub Projects Status；开关打开时按需读，用户点按钮才写回。 */
    function ProjectStatusLine({ kit, task, sessionId, enabled }) {
      const { t } = kit;
      const [state, setState] = React.useState(enabled ? 'loading' : 'off');
      const [info, setInfo] = React.useState(undefined);
      const [writeAsk, setWriteAsk] = React.useState(false);
      const [writing, setWriting] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      React.useEffect(() => {
        if (!enabled || typeof sessionId !== 'string' || sessionId === '') { setState('off'); return undefined; }
        let alive = true;
        kit.request('GET', undefined, { view: 'project-status', session: sessionId, task: task.id }).then(
          (payload) => { if (alive) { setInfo(payload.projectStatus); setState('done'); } },
          () => { if (alive) setState('error'); }
        );
        return () => { alive = false; };
      }, [enabled, sessionId, task.id]);
      if (!enabled) return null;
      const result = info;
      const write = () => {
        if (!writeAsk) { setWriteAsk(true); return; }
        setWriteAsk(false);
        setWriting(true);
        setNote(undefined);
        kit.request('POST', { action: 'project-status-write', task: task.id, fromSession: sessionId }, undefined).then(
          (payload) => {
            setWriting(false);
            const done = payload.result ?? {};
            setInfo((prev) => ({ ...(prev ?? {}), state: 'ok', status: done.status ?? prev?.status, project: done.project ?? prev?.project }));
            setNote({ pulse: Date.now() });
          },
          (failure) => { setWriting(false); setNote({ text: kit.errorText(t, failure), tone: 'error' }); }
        );
      };
      const text = state === 'loading' || state === 'off' ? t('projectStatusLoading')
        : state === 'error' ? t('projectStatusError')
        : result === undefined ? t('projectStatusLoading')
        : result.state === 'ok' ? kit.format(t('projectStatusValue'), { project: result.project ?? t('projectStatusNoProject'), status: result.status })
        : result.state === 'none' ? t('projectStatusNone')
        : result.state === 'off' ? t('projectStatusOff')
        : t('projectStatusUnknown') + (result.reason ? ' · ' + result.reason : '');
      return h('section', { className: 'dshaSv_sec' },
        h('div', { className: 'dshaSv_row' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('projectStatusTitle')),
          result?.state === 'ok' ? h('button', {
            type: 'button', className: 'dshaSv_btn', disabled: writing || typeof sessionId !== 'string' || sessionId === '',
            onClick: write
          }, writing ? t('projectStatusWriting') : writeAsk ? t('projectStatusWriteAsk') : t('projectStatusWrite')) : null),
        h('p', { className: 'dshaSv_muted', title: result?.reason ?? '' }, text),
        note?.pulse ? h('span', { className: 'dshaSv_actionPulse', key: note.pulse, 'aria-hidden': 'true' }) : null,
        note?.text ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, note.text) : null);
    }

    /** 任务详情里的审核入口：通过 / 打回 + 可选说明；只有用户能点，模型没有工具入口。 */
    function ApprovalBox({ kit, task, act, busy }) {
      const { t } = kit;
      const [note, setNote] = React.useState('');
      const run = (approved) => {
        if (typeof act !== 'function') return;
        void act({ action: 'task-approval', id: task.id, approved, ...(note.trim() === '' ? {} : { note: note.trim() }) },
          approved ? t('taskApprovedDone') : t('taskRejectedDone'));
      };
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('sideTaskApproval')),
        h('div', { className: 'dshaSv_taskActs' },
          h('input', {
            className: 'dshaSv_input', style: { flex: '1 1 8em' }, value: note, maxLength: 200,
            placeholder: t('taskApprovalNote'), 'aria-label': t('taskApprovalNote'),
            onChange: (event) => setNote(event.target.value)
          }),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => run(true) }, t('taskApprove')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => run(false) }, t('taskReject'))),
        h('p', { className: 'dshaSv_muted' }, t('taskApprovalHint')));
    }

    /**
     * 任务看板（参考 Deck 的「列表 + 详情 + 动作」）：
     * - 列表按「可接 / 进行中 / 已结束」分组；可接默认露 3 条、进行中露 5 条，点「还有 N 条」展开；
     * - 点一行进详情：持有者、工作树、看板状态，动作有打开持有会话、复制任务号 / 认领指令 / 派发指令、拉起认领会话；
     * - 数据随看板快照一起来（taskBoard），不额外请求；只在标签可见时由上层轮询；
     * - 认领会新建会话，所以详情里二次确认（Deck 的按钮能把 prompt 注入输入框，relay 没有输入框入口，就复制命令）。
     */
    function TaskBoard({ kit, tasks, sync, entries, act, busy, copied, onCopied = () => {}, openMore = false, onToggleOpenMore, hydrating = false, sessionId, onRefresh = () => {} }) {
      const { t } = kit;
      const [selected, setSelected] = React.useState(undefined);
      const [fold, setFold] = React.useState({});
      const foldState = fold ?? {};
      const [claiming, setClaiming] = React.useState(undefined);
      const [alias, setAlias] = React.useState('');
      const [updatedIds, setUpdatedIds] = React.useState(undefined);
      const prevTasks = React.useRef(new Map());
      const updatedTimer = React.useRef();
      React.useEffect(() => {
        if (tasks === undefined || tasks === null) return;
        const rows = [...(tasks.open ?? []), ...(tasks.claimedRows ?? []), ...(tasks.endedRows ?? [])];
        const next = new Map();
        const changed = [];
        for (const item of rows) {
          const sig = JSON.stringify(item);
          next.set(item.id, sig);
          const before = prevTasks.current.get(item.id);
          if (before !== undefined && before !== sig) changed.push(item.id);
        }
        prevTasks.current = next;
        if (changed.length === 0) return;
        setUpdatedIds(new Set(changed));
        clearTimeout(updatedTimer.current);
        updatedTimer.current = setTimeout(() => setUpdatedIds(undefined), 1600);
      }, [tasks]);
      React.useEffect(() => () => clearTimeout(updatedTimer.current), []);
      if (tasks === undefined || tasks === null) return h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_muted', role: 'status' }, hydrating ? t('loadingDetails') : t('sideNoTasks')));
      const open = Array.isArray(tasks.open) ? tasks.open : [];
      const active = Array.isArray(tasks.claimedRows) ? tasks.claimedRows : [];
      const ended = Array.isArray(tasks.endedRows) ? tasks.endedRows : [];
      const claimedN = Number(tasks.claimed) || 0;
      const endedN = Number.isFinite(tasks.ended) ? tasks.ended : ended.length;
      const stateOf = (id) => open.some((row) => row.id === id) ? 'open' : active.some((row) => row.id === id) ? 'active' : ended.some((row) => row.id === id) ? 'ended' : undefined;
      const picked = selected === undefined ? undefined : open.find((row) => row.id === selected) ?? active.find((row) => row.id === selected) ?? ended.find((row) => row.id === selected);
      let detail;
      if (picked !== undefined) {
        const state = stateOf(picked.id)
        const holder = picked.owner === undefined ? undefined : (Array.isArray(entries) ? entries : []).find((entry) => entry.sessionId === picked.owner);
        const copyKey = 'task:' + picked.id;
        const status = copied === copyKey ? 'ok' : copied === 'fail:' + copyKey ? 'fail' : undefined;
        const copy = (text) => { void kit.copyText(text).then((ok) => onCopied(ok ? copyKey : 'fail:' + copyKey), () => onCopied('fail:' + copyKey)); };
        const facts = [
          [t('sideTaskWorktree'), picked.worktree],
          [t('sideTaskDepends'), Array.isArray(picked.dependsOn) && picked.dependsOn.length > 0 ? picked.dependsOn.join('、') : undefined],
          [t('sideTaskStage'), picked.stageLabel],
          [t('sideTaskApproval'), picked.approvalLabel]
        ].filter(([, value]) => value !== undefined && value !== null && value !== '');
        const claim = () => {
          setClaiming(undefined);
          void act({ action: 'claim', task: picked.id, ...(alias.trim() === '' ? {} : { alias: alias.trim() }) }, t('tasksClaimLaunched')).then((payload) => {
            const created = payload?.result?.sessionId;
            if (typeof created === 'string' && created !== '') { setSelected(undefined); kit.openSession(created); }
          });
        };
        detail = h('section', { className: 'dshaSv_sec dshaSv_taskDetail' },
          h('div', { className: 'dshaSv_bar' },
            h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => { setSelected(undefined); setClaiming(undefined); } }, h(IconBack), t('sideTaskBack')),
            h('span', { className: 'dshaSv_crumb dshaSv_grow' }, t('tasksTitle'))),
          h('div', { className: 'dshaSv_row' },
            h('button', { type: 'button', className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand', title: t('copyId'), 'aria-label': t('copyId') + ' ' + picked.id, style: { cursor: 'pointer' }, onClick: () => copy(picked.id) }, picked.id),
            picked.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(picked.priority) ? 'warn' : undefined }, picked.priority) : null,
            h('span', { className: 'dshaSv_pill', 'data-tone': state === 'open' ? 'ok' : state === 'active' ? 'brand' : undefined }, t(state === 'open' ? 'sideTaskOpen' : state === 'active' ? 'sideTaskActive' : 'sideTaskEnded')),
            h('span', { className: 'dshaSv_grow' }),
            status === 'ok' ? h('span', { className: 'dshaSv_done', 'aria-label': t('sideTaskCopied') }, '✓') : status === 'fail' ? h('span', { className: 'dshaSv_alert', 'data-tone': 'error' }, t('copyFailed')) : null),
          h('p', { className: 'dshaSv_big' }, picked.title ?? picked.id),
          picked.owner ? h('button', { type: 'button', className: 'dshaSv_link', onClick: () => kit.openSession(picked.owner) }, t('tasksHolder') + '：' + (picked.ownerLabel ?? kit.shortId(picked.owner))) : null,
          holder && holder.summary ? h('p', { className: 'dshaSv_muted dshaSv_sum', title: holder.summary }, t('sideTaskLatest') + '：', ...(richSummary(holder.summary) ?? [])) : null,
          picked.pr && picked.pr.label ? h('p', { className: 'dshaSv_muted', title: picked.pr.url ?? undefined }, picked.pr.label) : null,
          // 任务 note（看板状态列里的结论 / 认领说明）：标签 + 两行截断，完整内容悬停看
          picked.status ? h('div', { className: 'dshaSv_fieldRow' },
            h('span', { className: 'dshaSv_fieldLabel' }, t('sideTaskStatus')),
            h('span', { className: 'dshaSv_noteText', title: picked.status }, picked.status)) : null,
          facts.length > 0 ? h('dl', { className: 'dshaSv_kv' }, ...facts.flatMap(([key, value]) => [h('dt', { key: key + 'k' }, key), h('dd', { key: key + 'v' }, String(value))])) : null,
          picked.stage === 'review' || picked.approval === 'pending'
            ? h(ApprovalBox, { kit, task: picked, act, busy })
            : null,
          h(ProjectStatusLine, { kit, task: picked, sessionId, enabled: sync?.switches?.projectStatus === true }),
          h('div', { className: 'dshaSv_taskActs' },
            state === 'active' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => copy('/relay task dispatch ' + picked.id) }, h(IconCopy), t('sideTaskCopyDispatch')) : null,
            state === 'open' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, 'aria-expanded': claiming === picked.id, onClick: () => { setClaiming(claiming === picked.id ? undefined : picked.id); if (alias === '') setAlias(picked.id.toLowerCase()); } }, t('tasksClaim')) : null),
          claiming === picked.id ? h('div', { className: 'dshaSv_row' },
            h('input', { className: 'dshaSv_input', style: { maxWidth: '9em' }, value: alias, maxLength: 32, 'aria-label': t('tasksAlias'), placeholder: picked.id.toLowerCase(), onChange: (event) => setAlias(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') claim(); } }),
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: claim }, t('tasksClaimConfirm')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setClaiming(undefined) }, t('cancel'))) : null);
      }
      const row = (task, state) => h('button', {
        key: state + ':' + task.id, type: 'button', className: 'dshaSv_task dshaSv_taskBtn', title: task.title, 'data-updated': updatedIds instanceof Set && updatedIds.has(task.id) ? 'true' : undefined,
        onClick: () => { setSelected(task.id); setClaiming(undefined); onRefresh(); }
      },
        h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand' }, task.id),
        task.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(task.priority) ? 'warn' : undefined }, task.priority) : null,
        h('span', { className: 'dshaSv_grow' }, task.title),
        state === 'active' && task.owner ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: task.ownerLabel ?? task.owner }, task.ownerLabel ?? kit.shortId(task.owner)) : null,
        state === 'ended' ? h('span', { className: 'dshaSv_pill' }, t(task.claim === 'done' ? 'sideTaskDone' : 'sideTaskAbandoned')) : null,
        h('span', { className: 'dshaSv_chev', 'aria-hidden': true }, '›'));
      const more = (state, total, shown) => {
        if (total <= shown) return null;
        const expanded = state === 'open' ? openMore === true : foldState[state] === true;
        const toggle = state === 'open' && typeof onToggleOpenMore === 'function' ? onToggleOpenMore : () => setFold({ ...foldState, [state]: foldState[state] !== true });
        return h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': expanded, onClick: toggle }, expanded ? t('sideLess') : kit.format(t('sideMoreTasks'), { n: total - shown }));
      };
      // 分组默认：可接 / 进行中展开，已结束收起；点分组头切换（本机状态，跨重开保持到刷新）
      const groupOpen = (state) => foldState['g:' + state] === undefined ? state !== 'ended' : foldState['g:' + state] === true;
      const group = (state, labelKey, rows, shown, tone, count = rows.length, moreLink) => rows.length === 0 ? null : h('div', { className: 'dshaSv_list', 'data-group': state },
        h('button', { type: 'button', className: 'dshaSv_groupBtn', 'aria-expanded': groupOpen(state) ? 'true' : 'false', onClick: () => setFold({ ...foldState, ['g:' + state]: !groupOpen(state) }) },
          h('span', { className: 'dshaSv_chev dshaSv_chevRot', 'data-open': groupOpen(state) ? true : undefined, 'aria-hidden': true }, '▸'),
          h('span', { className: 'dshaSv_dot', 'data-tone': tone, 'aria-hidden': true }),
          h('span', { className: 'dshaSv_grow' }, t(labelKey)),
          h('span', { className: 'dshaSv_count' }, String(count))),
        groupOpen(state) ? h('div', { className: 'dshaSv_list' }, ...shown.map((task) => row(task, state)), moreLink ?? more(state, rows.length, shown.length)) : null);
      const openShown = openMore === true ? open : open.slice(0, 3);
      const activeShown = foldState.active === true ? active : active.slice(0, 5);
      const list = h('section', { className: 'dshaSv_sec dshaSv_taskList' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTaskBoard')),
          h('span', { className: 'dshaSv_pill' }, kit.format(t('sideTaskSummary'), { open: open.length, active: claimedN }))),
        sync && sync.available === true ? h(SyncStatus, { key: 'sync', kit, sync, act, busy }) : null,
        open.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('sideNoOpenTasks')) : null,
        group('open', 'sideTaskOpen', open, openShown, 'ok'),
        group('active', 'sideTaskActive', active, activeShown, 'brand'),
        claimedN > active.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: claimedN - active.length })) : null,
        ended.length > 0
          ? group('ended', 'sideTaskEnded', ended, ended, undefined, endedN,
            endedN > ended.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN - ended.length })) : null)
          : endedN > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN })) : null);
      return detail === undefined
        ? list
        : h('div', { className: 'dshaSv_split', 'data-picked': true }, list, detail);
    }


      return { TaskBoard, ApprovalBox, ProjectStatusLine };
    }

    return { KIT_VERSION: 42, make };
  }
});
