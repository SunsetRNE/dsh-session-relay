window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.branches46.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar46.js 按需 require.async 加载；共用件与图标经
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


    function BranchCleanup({ kit, act, busy }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'branch-cleanup' });
      const [picked, setPicked] = React.useState([]);
      const [confirming, setConfirming] = React.useState(false);
      const [unmergedAck, setUnmergedAck] = React.useState(false);
      const [running, setRunning] = React.useState(false);
      const [result, setResult] = React.useState(undefined);
      const view = data?.cleanup;
      const workspaces = Array.isArray(view?.workspaces) ? view.workspaces : [];
      const keyOf = (workspaceId, name) => workspaceId + '\u0000' + name;
      const rows = workspaces.flatMap((row) => (Array.isArray(row.branches) ? row.branches : []).map((branch) => ({ ...branch, workspaceId: row.workspace.id, workspaceTitle: row.workspace.title })));
      const pickedRows = picked.map((key) => rows.find((row) => keyOf(row.workspaceId, row.name) === key)).filter((row) => row !== undefined);
      const cleanable = rows.filter((row) => row.cleanable === true);
      const unmerged = pickedRows.filter((row) => row.merged !== true);
      const reset = () => { setConfirming(false); setUnmergedAck(false); };
      const toggle = (row) => {
        const key = keyOf(row.workspaceId, row.name);
        setPicked(picked.includes(key) ? picked.filter((item) => item !== key) : [...picked, key]);
        setResult(undefined);
        reset();
      };
      const toggleWorkspace = (list, on) => {
        const keys = list.filter((row) => row.cleanable === true).map((row) => keyOf(row.workspaceId, row.name));
        setPicked(on ? [...new Set([...picked, ...keys])] : picked.filter((key) => !keys.includes(key)));
        setResult(undefined);
        reset();
      };
      const allPicked = cleanable.length > 0 && cleanable.every((row) => picked.includes(keyOf(row.workspaceId, row.name)));
      const toggleAll = () => {
        setPicked(allPicked ? [] : cleanable.map((row) => keyOf(row.workspaceId, row.name)));
        setResult(undefined);
        reset();
      };
      const run = () => {
        if (pickedRows.length === 0 || running === true) return;
        setRunning(true);
        act({ action: 'branch-cleanup', items: pickedRows.map((row) => ({ workspaceId: row.workspaceId, name: row.name })), confirm: true }).then((payload) => {
          setRunning(false);
          if (payload === undefined) return;
          setPicked([]);
          reset();
          setResult(payload?.result ?? {});
          reload(true);
        }, () => setRunning(false));
      };
      const rowOf = (branch) => {
        const key = keyOf(branch.workspaceId, branch.name);
        const disabled = branch.cleanable !== true || busy || running;
        const declPill = branch.declaration === 'active'
          ? h('span', { className: 'dshaSv_pill', 'data-tone': 'warn', title: branch.session ?? '' }, t('brCleanupActive'))
          : branch.declaration === 'done'
            ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok', title: branch.session ?? '' }, t('brCleanupDoneDecl'))
            : h('span', { className: 'dshaSv_pill' }, t('brCleanupNoDecl'));
        return h('div', { key, className: 'dshaSv_listRow' },
          h('label', { className: 'dshaSv_check' + (branch.cleanable !== true ? ' dshaSv_checkOff' : ''), title: branch.reason ?? '' },
            h('input', { type: 'checkbox', checked: picked.includes(key), disabled, onChange: () => toggle(branch) }),
            h('div', { className: 'dshaSv_grow' },
              h('div', { className: 'dshaSv_bar' },
                h('span', { className: 'dshaSv_grow', title: branch.worktree ?? '' }, branch.name),
                h('span', { className: 'dshaSv_pill', 'data-tone': branch.merged === true ? 'ok' : 'warn' }, branch.merged === true ? t('brMerged') : t('brUnmerged')),
                branch.clean === null || branch.clean === undefined ? null : h('span', { className: 'dshaSv_pill', 'data-tone': branch.clean === true ? 'ok' : 'warn' }, branch.clean === true ? t('brCleanupClean') : t('brCleanupDirty')),
                declPill),
              h('p', { className: 'dshaSv_muted', title: branch.worktree ?? '', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, branch.worktree ?? ''),
              branch.reason ? h('p', { className: 'dshaSv_muted' }, branch.reason) : null)));
      };
      const workspaceCard = (row) => {
        const list = (Array.isArray(row.branches) ? row.branches : []).map((branch) => ({ ...branch, workspaceId: row.workspace.id, workspaceTitle: row.workspace.title }));
        const cleanRows = list.filter((branch) => branch.cleanable === true);
        const all = cleanRows.length > 0 && cleanRows.every((branch) => picked.includes(keyOf(row.workspaceId, branch.name)));
        return h('details', { key: row.workspace.id, className: 'dshaSv_box', open: true },
          h('summary', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_grow', title: row.workspace.path }, row.workspace.title ?? row.workspace.id),
            row.repo ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: row.repo }, row.repo) : null,
            h('span', { className: 'dshaSv_muted' }, kit.format(t('brCleanupCount'), { total: list.length, cleanable: cleanRows.length }))),
          row.error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, row.error) : null,
          h('label', { className: 'dshaSv_check' + (cleanRows.length === 0 ? ' dshaSv_checkOff' : '') },
            h('input', { type: 'checkbox', checked: all, disabled: cleanRows.length === 0 || busy || running, onChange: () => toggleWorkspace(list, !all) }),
            h('span', null, t('brCleanupSelectAll'))),
          ...list.map(rowOf));
      };
      const confirmBlock = confirming
        ? h('div', { className: 'dshaSv_quote' },
            h('p', { className: 'dshaSv_alert', 'data-tone': 'error' }, kit.format(t('brCleanupConfirm'), { n: pickedRows.length })),
            ...pickedRows.slice(0, 20).map((row) => h('p', { key: keyOf(row.workspaceId, row.name), className: 'dshaSv_muted' }, (row.workspaceTitle ? row.workspaceTitle + ' · ' : '') + row.name)),
            pickedRows.length > 20 ? h('p', { className: 'dshaSv_muted' }, '… +' + (pickedRows.length - 20)) : null,
            unmerged.length > 0 ? h(React.Fragment, null,
              h('p', { className: 'dshaSv_alert', 'data-tone': 'warn' }, kit.format(t('brCleanupUnmerged'), { n: unmerged.length })),
              h('label', { className: 'dshaSv_check' },
                h('input', { type: 'checkbox', checked: unmergedAck, onChange: () => setUnmergedAck(!unmergedAck) }),
                h('span', null, t('brCleanupUnmergedAck')))) : null,
            h('div', { className: 'dshaSv_listActions' },
              h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: running || busy || (unmerged.length > 0 && unmergedAck !== true), onClick: run }, t('brCleanupConfirmRun')),
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: running, onClick: reset }, t('cancel'))))
        : null;
      const resultBlock = result === undefined
        ? null
        : h('div', { className: 'dshaSv_quote' },
            h('p', { className: 'dshaSv_muted' }, kit.format(t('brCleanupDone'), { removed: Number(result.removed) || 0, skipped: Number(result.skipped) || 0 })),
            ...(Array.isArray(result.results) ? result.results.filter((row) => row.ok !== true).slice(0, 20) : []).map((row) => h('p', { key: row.workspaceId + ':' + row.name, className: 'dshaSv_muted' }, row.name + ' · ' + (row.reason ?? ''))));
      return h(React.Fragment, null,
        h('p', { className: 'dshaSv_muted' }, t('brCleanupHint')),
        h('div', { className: 'dshaSv_bar' },
          view !== undefined ? h('span', { className: 'dshaSv_grow dshaSv_muted' }, kit.format(t('brCleanupCount'), { total: Number(view.total) || rows.length, cleanable: Number(view.cleanable) || cleanable.length })) : null,
          h('button', { type: 'button', className: 'dshaSv_link', disabled: loading || running, onClick: toggleAll }, t('brCleanupSelectAll')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh'))),
        error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
        view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
        view !== undefined && rows.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('brCleanupEmpty')) : null,
        workspaces.map(workspaceCard),
        rows.length > 0 ? h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_grow dshaSv_muted' }, kit.format(t('brCleanupSelected'), { n: pickedRows.length })),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: pickedRows.length === 0 || busy || running, onClick: () => { setConfirming(true); setUnmergedAck(false); setResult(undefined) } }, t('brCleanupRun'))) : null,
        confirmBlock,
        resultBlock);
    }

    /** 分支页：全工作区本地 / 远端分支；删除逐条确认（远端要输入分支名）。 */
    function BranchTab({ kit, act, busy, sessionId, onBack }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'branch-list' });
      const [confirm, setConfirm] = React.useState(undefined);
      const [typed, setTyped] = React.useState('');
      const [force, setForce] = React.useState(false);
      const [running, setRunning] = React.useState(undefined);
      const [query, setQuery] = React.useState('');
      const [showAll, setShowAll] = React.useState(false);
      const [mode, setMode] = React.useState('list');
      const view = data?.branches;
      const workspaces = Array.isArray(view?.workspaces) ? view.workspaces : [];
      const skipped = Number(view?.skipped) || 0;
      // 分支页已有数据里数出被工作树占用的分支，给清理入口显示数量（不用额外的 status 请求）
      const legacy = workspaces.reduce((sum, row) => sum + (Array.isArray(row.local) ? row.local.filter((branch) => typeof branch.worktree === 'string' && branch.worktree !== '' && branch.worktree !== row.workspace.path).length : 0), 0);
      const q = query.trim().toLowerCase();
      const matched = (branch) => q === '' || String(branch.name).toLowerCase().includes(q);
      const run = (key, body) => {
        setRunning(key);
        act(body).then((payload) => {
          setRunning(undefined);
          if (payload !== undefined) { setConfirm(undefined); setTyped(''); setForce(false); reload(true); }
        }, () => setRunning(undefined));
      };
      const remove = (workspaceId, name, remote, removeWorktree = false) => {
        const key = (remote ? 'r:' : 'l:') + workspaceId + ':' + name + (removeWorktree ? ':wt' : '');
        run(key, {
          action: 'branch-delete', workspaceId, name,
          ...(remote ? { remote: true, confirm: typed } : { force }),
          ...(removeWorktree ? { removeWorktree: true } : {})
        });
      };
      const branchRow = (workspaceId, branch, remote, snapshot) => {
        const name = branch.name;
        const isDefault = snapshot.defaultBranch === name;
        const isCurrent = remote !== true && snapshot.current === name;
        const inWorktree = remote !== true && typeof branch.worktree === 'string' && branch.worktree !== '';
        const key = (remote ? 'r:' : 'l:') + workspaceId + ':' + name;
        const isConfirm = confirm !== undefined && confirm.workspaceId === workspaceId && confirm.name === name && confirm.remote === remote && Boolean(confirm.removeWorktree) === inWorktree;
        return h('div', { key: (remote ? 'r:' : 'l:') + name, className: 'dshaSv_listRow' },
          h('div', { className: 'dshaSv_listMain' },
            h('div', { className: 'dshaSv_bar' },
              h('span', { className: 'dshaSv_grow', title: branch.subject ?? '' }, name),
              isCurrent ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('brCurrent')) : null,
              isDefault ? h('span', { className: 'dshaSv_pill' }, t('brDefault')) : null,
              remote !== true ? (branch.merged ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('brMerged')) : h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, t('brUnmerged'))) : null,
              inWorktree ? h('span', { className: 'dshaSv_pill', title: branch.worktree }, t('brWorktree')) : null),
            h('p', { className: 'dshaSv_muted' }, [
              branch.at ? kit.formatTime(Date.parse(branch.at)) : '',
              branch.ahead > 0 ? kit.format(t('brAhead'), { n: branch.ahead }) : '',
              branch.behind > 0 ? kit.format(t('brBehind'), { n: branch.behind }) : '',
              remote !== true && branch.upstream ? '↗ ' + branch.upstream : ''
            ].filter(Boolean).join(' · ')),
            isConfirm ? h('div', { className: 'dshaSv_listActions' },
              confirm.removeWorktree
                ? h('p', { style: { flex: '1 1 100%' }, className: 'dshaSv_alert', 'data-tone': 'error' }, kit.format(t('brConfirmWorktree'), { name }) + ' · ' + (branch.worktree ?? ''))
                : remote === true
                  ? h('input', { className: 'dshaSv_input', value: typed, maxLength: 200, placeholder: name, 'aria-label': t('brConfirmRemote'), onChange: (event) => setTyped(event.target.value) })
                  : (branch.merged !== true ? h('label', { className: 'dshaSv_check' }, h('input', { type: 'checkbox', checked: force, onChange: (event) => setForce(event.target.checked) }), h('span', null, t('brForce'))) : null),
              h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || running !== undefined || (remote === true && typed !== name), onClick: () => remove(workspaceId, name, remote, confirm.removeWorktree === true) }, t('brConfirm')),
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || running !== undefined, onClick: () => { setConfirm(undefined); setTyped(''); setForce(false); } }, t('cancel'))) : null),
          isDefault || isCurrent ? null
            : h('button', {
              type: 'button', className: 'dshaSv_link', disabled: busy || running !== undefined,
              title: inWorktree ? branch.worktree : undefined,
              onClick: () => { setConfirm({ workspaceId, name, remote, removeWorktree: inWorktree }); setTyped(''); setForce(false); }
            }, inWorktree ? t('brRemoveWorktree') : remote === true ? t('brDeleteRemote') : t('brDelete')));
      };
      const branchList = (workspaceId, list, remote, snapshot) => {
        const rows = list.filter(matched);
        const shown = showAll ? rows : rows.slice(0, 12);
        return h(React.Fragment, null,
          shown.map((branch) => branchRow(workspaceId, branch, remote, snapshot)),
          rows.length > shown.length
            ? h('button', { key: 'more', type: 'button', className: 'dshaSv_link', onClick: () => setShowAll(true) }, kit.format(t('brShowAll'), { n: rows.length }))
            : null,
          rows.length === 0 ? h('p', { className: 'dshaSv_muted' }, q === '' ? t('brNoLocal') : t('brNoMatch')) : null);
      };
      const workspaceCard = (row, index) => {
        const local = [...row.local].sort((a, b) => Number(b.current === true) - Number(a.current === true) || String(a.name).localeCompare(String(b.name)));
        const remote = [...row.remote].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const flat = local.length + remote.length;
        return h('details', { key: row.workspace.id, className: 'dshaSv_box', open: index === 0 || q !== '' },
          h('summary', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_grow', title: row.workspace.path }, row.workspace.title ?? row.workspace.id),
            row.repo ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: row.repo }, row.repo) : h('span', { className: 'dshaSv_pill' }, t('brNoRepo')),
            h('span', { className: 'dshaSv_muted' }, kit.format(t('brSummaryCount'), { local: local.length, remote: remote.length })),
            h('button', { type: 'button', className: 'dshaSv_link', disabled: busy || running !== undefined, onClick: (event) => { event?.preventDefault?.(); event?.stopPropagation?.(); run('fetch:' + row.workspace.id, { action: 'branch-fetch', workspaceId: row.workspace.id }); } }, t('brFetch'))),
          h('p', { className: 'dshaSv_muted' }, t('brLocal') + ' · ' + local.filter(matched).length),
          branchList(row.workspace.id, local, false, row),
          h('details', { className: 'dshaSv_box' },
            h('summary', { className: 'dshaSv_row' },
              h('span', { className: 'dshaSv_grow' }, t('brRemote')),
              h('span', { className: 'dshaSv_muted' }, String(remote.filter(matched).length))),
            branchList(row.workspace.id, remote, true, row)));
      };
      if (mode === 'cleanup') {
        return h('div', { className: 'dshaSv_grid' },
          h('section', { className: 'dshaSv_sec dshaSv_span' },
            h('div', { className: 'dshaSv_bar' },
              h(BackMore, { kit, onBack }),
              h('p', { className: 'dshaSv_h dshaSv_grow' }, t('brCleanupTitle')),
              h('button', { type: 'button', className: 'dshaSv_link', onClick: () => setMode('list') }, t('brCleanupBack'))),
            h(BranchCleanup, { kit, act, busy })));
      }
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h(BackMore, { kit, onBack }),
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabBranches')),
            legacy > 0 ? h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => setMode('cleanup') }, kit.format(t('brCleanupOpen'), { n: legacy })) : null,
            loading && view !== undefined ? h('span', { className: 'dshaSv_actionPulse', 'aria-hidden': 'true' }) : null,
            skipped > 0 ? h('span', { className: 'dshaSv_muted' }, kit.format(t('brSkipped'), { n: skipped })) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh'))),
          h('p', { className: 'dshaSv_muted' }, t('brHint')),
          view !== undefined ? h('input', {
            className: 'dshaSv_input', value: query, maxLength: 120, placeholder: t('brSearch'), 'aria-label': t('brSearch'),
            onChange: (event) => setQuery(event.target.value)
          }) : null,
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
          view !== undefined && workspaces.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('brNoWorkspace')) : null,
          view !== undefined ? workspaces.map(workspaceCard) : null));
    }

    /** 邮箱页：公共通知全文，标已读 / 归档由用户点。 */

      return { BranchTab, BranchCleanup };
    }

    return { KIT_VERSION: 46, make };
  }
});
