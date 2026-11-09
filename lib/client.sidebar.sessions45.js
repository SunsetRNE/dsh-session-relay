window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.sessions45.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar45.js 按需 require.async 加载；共用件与图标经
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
    /** 会话页：主会话、版本线、筛选与会话卡片。详情由外壳整页切到 SessionDetail（保持原来的返回行为）。 */
    function SessionsTab({ kit, board, entries, sessionId, busy, act, filter, setFilter, lineOpen, setLineOpen, copied, onCopied, quietOpen, setQuietOpen, doneOpen, setDoneOpen, updatedIds, onSelect }) {
      const { t } = kit;
      const main = board.coordinator;
      const counts = {
        attention: entries.filter(isAttention).length,
        active: entries.filter(isActive).length,
        ready: entries.filter(isReady).length,
        done: entries.filter(isDone).length
      };
      // 合并流水线计数（主会话行与卡片共用）：已批准含失效（要用户重新批），已合入含已发布
      const flowCounts = {
        ready: entries.filter((entry) => entry.category === 'ready' && !['approved', 'merged', 'released'].includes(entry.approval?.stage)).length,
        approved: entries.filter((entry) => entry.approval?.stage === 'approved' || entry.approval?.stage === 'stale').length,
        merged: entries.filter((entry) => entry.approval?.stage === 'merged' || entry.approval?.stage === 'released').length
      };
      // 会话少于 3 个时不给筛选，直接全列
      const showFilters = entries.length >= 3;
      const rule = (showFilters ? FILTERS.find(([key]) => key === filter) : undefined) ?? FILTERS[0];
      const matched = entries.filter(rule[2]);
      // 「全部」里空白 / 久未活动的会话合成一行，点开再列
      const quiet = rule[0] === 'all' ? matched.filter((entry) => QUIET.has(categoryOf(entry))) : [];
      // 「全部」里已结束的收在底部，点开最多先列 50 条
      const done = rule[0] === 'all' ? matched.filter(isDone) : [];
      const shown = rule[0] === 'all' ? matched.filter((entry) => !isDone(entry) && (quietOpen || !QUIET.has(categoryOf(entry)))) : matched;
      const quietText = ['blank', 'idle'].map((key) => [key, quiet.filter((entry) => categoryOf(entry) === key).length]).filter(([, n]) => n > 0).map(([key, n]) => t(CATEGORY_LABEL[key]) + ' ' + n).join(' · ');
      // 版本线正文本身常以「Version line：」开头，标签已经写了「版本线公告」，显示时去掉前缀避免重复
      const line = String(board.line?.text ?? '').replace(/^Version line\s*[:：]\s*/i, '');
      const watching = (board.watches ?? []).filter((item) => item.state === 'active');
      const FILTER_ICON = { attention: IconTarget, active: IconPlay, ready: IconCheck, done: IconArchive };
      const chip = (key, label, n, tone) => {
        const FilterIcon = FILTER_ICON[key];
        return h('button', { key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key, 'data-tone': n > 0 ? tone : undefined, onClick: () => setFilter(filter === key ? 'all' : key) },
          FilterIcon ? h(FilterIcon) : null, h('b', null, n), t(label));
      };
      return h(React.Fragment, null,
        h(SessionSearch, { kit, board, sessionId, openSession: kit.openSession }),
        h(Attention, { kit, board, busy, act }),
        main && main.sessionId === sessionId
          ? h('div', { className: 'dshaSv_main dshaSv_row', 'data-self': true, title: t('sideMainSelf') },
            h('span', { className: 'dshaSv_star' }, h(IconStar)),
            h('span', { className: 'dshaSv_title' }, kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) })),
            flowCounts.approved > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok', title: t('mergeSummaryTitle') }, t('mergeApproved') + ' ' + flowCounts.approved) : null,
            flowCounts.ready > 0 ? h('span', { className: 'dshaSv_pill', title: t('mergeSummaryTitle') }, t('mergeReady') + ' ' + flowCounts.ready) : null,
            h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('thisSession')),
            h('span', { className: 'dshaSv_state', 'data-state': main.state, title: kit.stateText(t, main.state) }),
            h(CopyId, { kit, sessionId: main.sessionId, copied: copiedFor(copied, main.sessionId), onCopied }))
        : main
          ? h('div', { className: 'dshaSv_main dshaSv_row', role: 'button', tabIndex: 0, title: main.label ?? main.sessionId, 'aria-label': kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) }),
              onClick: () => kit.openSession(main.sessionId), onKeyDown: (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); kit.openSession(main.sessionId); } } },
            h('span', { className: 'dshaSv_star' }, h(IconStar)),
            h('span', { className: 'dshaSv_title' }, kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) })),
            flowCounts.approved > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok', title: t('mergeSummaryTitle') }, t('mergeApproved') + ' ' + flowCounts.approved) : null,
            flowCounts.ready > 0 ? h('span', { className: 'dshaSv_pill', title: t('mergeSummaryTitle') }, t('mergeReady') + ' ' + flowCounts.ready) : null,
            h('span', { className: 'dshaSv_state', 'data-state': main.state, title: kit.stateText(t, main.state) }),
            h(CopyId, { kit, sessionId: main.sessionId, copied, onCopied }))
          : h('p', { className: 'dshaSv_muted' }, t('mainNone')),
        line
          ? h(LineNotice, { kit, text: line, open: lineOpen, onToggle: () => setLineOpen(!lineOpen) })
          : h('p', { className: 'dshaSv_muted' }, t('lineTitle') + ' · ' + t('lineEmpty')),
        watching.length > 0 ? h('p', { className: 'dshaSv_muted', title: watching.map((item) => item.line).join('\n') }, kit.format(t('sideWatching'), { n: watching.length, what: watching.slice(0, 2).map((item) => item.what).join('；') })) : null,
        h('section', { className: 'dshaSv_sec' },
          showFilters ? h('div', { className: 'dshaSv_filters', role: 'group', 'aria-label': kit.format(t('sideBoard'), { n: entries.length }) },
            chip('attention', 'sideCountAttention', counts.attention, 'warn'),
            chip('active', 'sideCountActive', counts.active),
            chip('ready', 'sideCountReady', counts.ready, 'ok'),
            counts.done > 0 ? chip('done', 'sideFDone', counts.done) : null)
            : h('p', { className: 'dshaSv_h' }, kit.format(t('sideBoard'), { n: entries.length })),
          entries.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('boardEmpty'))
            : shown.length > 0 ? h('div', { className: 'dshaSv_list dshaSv_cardsWide' }, ...shown.map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect, copied: copiedFor(copied, entry.sessionId), onCopied, act, busy, release: board.release, updated: updatedIds instanceof Set && updatedIds.has(entry.sessionId) }))) : null,
          quiet.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': quietOpen, onClick: () => setQuietOpen(!quietOpen) }, (quietOpen ? t('sideLess') : quietText)) : null,
          done.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': doneOpen, onClick: () => setDoneOpen(!doneOpen) }, doneOpen ? t('sideLess') : kit.format(t('sideDoneN'), { n: done.length })) : null,
          doneOpen && done.length > 0 ? h('div', { className: 'dshaSv_list dshaSv_cardsWide' }, ...done.slice(0, 50).map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect, copied: copiedFor(copied, entry.sessionId), onCopied, act, busy, release: board.release, updated: updatedIds instanceof Set && updatedIds.has(entry.sessionId) }))) : null,
          doneOpen && done.length > 50 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: done.length - 50 })) : null));
    }


    const CATEGORY_LABEL = { attention: 'catAttention', ready: 'catReady', active: 'catActive', idle: 'catIdle', blank: 'catBlank', archived: 'sideFDone' };
    /* 需要处理的原因 → 文案键；服务端没给时按汇报状态推（待答复 / 受阻） */
    const REASON_T = { question: 'why_question', blocked: 'why_blocked', failed: 'why_failed', heavy: 'why_heavy' };

    function reasonOf(entry) {
      if (typeof entry.categoryReason === 'string' && REASON_T[entry.categoryReason]) return entry.categoryReason;
      if (entry.status === 'question' && !entry.answered) return 'question';
      if (entry.status === 'blocked') return 'blocked';
      return undefined;
    }
    /* 状态 → 颜色语气 */
    function toneOf(entry) {
      const category = categoryOf(entry);
      if (category === 'attention') { const why = reasonOf(entry); return why === 'blocked' || why === 'failed' ? 'error' : 'warn'; }
      if (category === 'ready') return 'ok';
      if (category === 'active') return 'brand';
      if (category === 'archived') return 'muted';
      return undefined;
    }

    const pillText = (kit, entry) => {
      const category = categoryOf(entry);
      if (category === 'attention') { const why = reasonOf(entry); if (why) return kit.t(REASON_T[why]); }
      if (category === 'blank' || category === 'idle') return kit.t(CATEGORY_LABEL[category]);
      return kit.statusText(kit.t, entry.status) || kit.t(CATEGORY_LABEL[category] ?? 'catActive');
    };
    // 悬停看原始汇报状态（出错时带错误码），胶囊本身只占一行
    const pillTitle = (kit, entry) => {
      if (categoryOf(entry) !== 'attention') return undefined;
      const parts = [kit.statusText(kit.t, entry.status)];
      if (reasonOf(entry) === 'failed' && entry.categoryDetail) parts.push(entry.categoryDetail);
      return parts.filter(Boolean).join(' · ');
    };
    const FILTERS = [
      ['all', 'sideFAll', () => true],
      ['attention', 'sideFAttention', isAttention],
      ['active', 'sideFActive', isActive],
      ['ready', 'sideFReady', isReady],
      ['done', 'sideFDone', isDone]
    ];


    function primaryOf(entry) {
      const category = categoryOf(entry);
      if (category === 'attention') return 'reply';
      if (category === 'ready') return 'assign';
      if (category === 'idle') return 'wake';
      return undefined;
    }
    // 卡片里的表单：点击和按键不冒泡到卡片（否则会进详情）

    function CardAction({ kit, entry, kind, act, onDone }) {
      const { t } = kit;
      const [text, setText] = React.useState(kind === 'assign' ? (entry.assigned ?? '') : '');
      const [busy, setBusy] = React.useState(false);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      const go = () => {
        const body = kind === 'reply' ? { action: 'reply', target: entry.sessionId, text, mode: 'followup' }
          : kind === 'assign' ? { action: 'assign', target: entry.sessionId, value: text.trim(), notify: true }
          : { action: 'wake', target: entry.sessionId, force: 'resume' };
        const ok = kind === 'reply' ? 'sideReplied' : kind === 'assign' ? 'sideAssigned' : 'sideWoken';
        setBusy(true);
        void act(body, kit.format(t(ok), { label: name, v: text.trim() })).then((done) => { setBusy(false); if (done) onDone(); });
      };
      const ready = kind === 'wake' || text.trim() !== '';
      return h('div', { className: 'dshaSv_form', ...keep },
        kind === 'wake' ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideWakeAsk'), { label: name }))
          : h(kind === 'reply' ? 'textarea' : 'input', {
            className: 'dshaSv_input', value: text, rows: kind === 'reply' ? 3 : undefined, maxLength: kind === 'reply' ? 16000 : 80,
            placeholder: kind === 'reply' ? t('replyPlaceholder') : t('assignPlaceholder'), 'aria-label': kind === 'reply' ? t('reply') : t('assign'),
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => { event.stopPropagation(); if (kind === 'assign' && event.key === 'Enter' && ready && !busy) go(); }
          }),
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_grow' }),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(onDone) }, t('cancel')),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !ready, onClick: stop(go) },
            kind === 'reply' ? t('send') : kind === 'assign' ? t('assignSend') : t('wakeConfirm'))));
    }

    /** 轻量富文本：**粗体** / `行内代码` 转标签；保留原始换行（版本线全文、评论正文用）。 */

    function LineNotice({ kit, text, open, onToggle }) {
      const { t } = kit;
      const clean = String(text ?? '').trim();
      const pick = (re) => re.exec(clean)?.[1];
      const main = pick(/origin\/main=([0-9a-f]{7,40})/i) ?? pick(/\bmain=([0-9a-f]{7,40})/i);
      const head = pick(/\bHEAD\s+([0-9a-f]{7,40})/i);
      const tag = pick(/\btag\s+(v?[\w.-]+)/i);
      const checkpoints = pick(/(\d+)\s*个检查点/);
      // 旧公告写「串行测试 410 全过」，新公告常写「串行 410 全过」，两种都收
      const tests = pick(/(?:串行\s*(?:测试\s*)?|测试\s*)(\d+)\s*(?:全过|通过)/) ?? pick(/(?:串行)?测试\s*(\d+)/);
      const unreleased = /未推送|未打 tag|未发 Release|未发布/.test(clean);
      const chips = [
        main ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.format(t('lineMainChip'), { sha: main })) : null,
        head ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.format(t('lineHeadChip'), { sha: head })) : null,
        tag ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.format(t('lineTagChip'), { tag })) : null,
        checkpoints ? h('span', { className: 'dshaSv_pill' }, kit.format(t('lineCheckpoints'), { n: checkpoints })) : null,
        tests ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, kit.format(t('lineTests'), { n: tests })) : null,
        unreleased ? h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, t('lineUnreleased')) : null
      ].filter(Boolean);
      const long = clean.length > 120 || clean.includes('\n');
      const preview = clean.length > 180 ? clean.slice(0, 180) + '…' : clean;
      return h('div', { className: 'dshaSv_lineCard' },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_lineK' }, t('lineTitle')),
          ...chips,
          h('span', { className: 'dshaSv_grow' }),
          long ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': open ? 'true' : 'false', onClick: onToggle }, open ? t('lineCollapse') : t('lineExpand')) : null),
        // 预览也走轻量富文本（去 ** / 反引号，不把 Markdown 记号漏到两行预览里）；全文保留换行
        open && long ? h('p', { className: 'dshaSv_lineFull' }, richLines(clean)) : h('p', { className: 'dshaSv_linePreview', title: clean }, richSummary(preview)));
    }

    /** T14 合并流水线：可合并 → 已批准 → 已合入 → 随 vX.Y.Z 发布（只读展示，来自服务端 approval 视图）。 */
    function mergeFlowNodes(kit, entry, release) {
      const stage = entry?.approval?.stage ?? ((entry?.category === 'ready' || entry?.status === 'ready') ? 'ready' : undefined);
      if (stage === undefined) return null;
      const merged = stage === 'merged' || stage === 'released';
      const approved = stage === 'approved' || stage === 'stale' || merged;
      const tag = entry?.approval?.tag ?? release?.nextTag ?? null;
      const nextLabel = stage === 'released' && entry?.approval?.tag
        ? kit.format(kit.t('mergeReleasedTag'), { tag: entry.approval.tag })
        : tag ? kit.format(kit.t('mergeNext'), { tag }) : kit.t('mergeReleased');
      return [
        { key: 'ready', label: kit.t('mergeReady'), on: true },
        { key: 'approved', label: stage === 'stale' ? kit.t('mergeStale') : kit.t('mergeApproved'), on: approved, tone: stage === 'stale' ? 'warn' : 'ok' },
        { key: 'merged', label: kit.t('mergeMerged'), on: merged, tone: 'ok' },
        { key: 'released', label: nextLabel, on: stage === 'released', tone: 'ok' }
      ];
    }

    function MergeFlow({ kit, entry, release }) {
      const nodes = mergeFlowNodes(kit, entry, release);
      if (nodes === null) return null;
      return h('div', { className: 'dshaSv_metaChips', 'data-flow': entry.approval?.stage ?? 'ready' },
        ...nodes.flatMap((node, index) => [
          index > 0 ? h('span', { key: 'a' + index, className: 'dshaSv_muted', 'aria-hidden': true }, '→') : null,
          h('span', { key: node.key, className: 'dshaSv_pill', 'data-tone': node.on ? node.tone : undefined }, node.label)
        ]));
    }

    /** 卡片上的合并动作：批准 / 稍后 / 打回（理由发给工作会话）；面板不跑 git。 */
    function MergeCardActions({ kit, entry, busy, act }) {
      const { t } = kit;
      const [rejecting, setRejecting] = React.useState(false);
      const [reason, setReason] = React.useState('');
      const reasonText = typeof reason === 'string' ? reason : '';
      const stage = entry.approval?.stage ?? 'ready';
      if (stage === 'merged' || stage === 'released') return h('span', { className: 'dshaSv_muted' }, entry.approval?.tag ? kit.format(t('mergeReleasedTag'), { tag: entry.approval.tag }) : t('mergeMerged'));
      if (stage === 'approved') return h('span', { className: 'dshaSv_muted' }, t('mergeApprovedHint'));
      const run = (action, extra) => act({ action, target: entry.sessionId, sha: entry.commit, ...(extra ?? {}) }, t(action === 'merge-approve' ? 'mergeDoneApprove' : action === 'merge-later' ? 'mergeDoneLater' : 'mergeDoneReject'));
      return h('div', { className: 'dshaSv_stack' },
        stage === 'stale' ? h('span', { className: 'dshaSv_muted' }, t('mergeStaleHint')) : null,
        stage === 'rejected' ? h('span', { className: 'dshaSv_muted' }, kit.format(t('mergeRejectedHint'), { v: entry.approval?.reason ?? '' })) : null,
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_grow' }),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !entry.commit, onClick: (event) => { stop(event); run('merge-approve'); } }, t('mergeApprove')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: (event) => { stop(event); run('merge-later'); } }, t('mergeLaterBtn')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: (event) => { stop(event); setRejecting(!rejecting); } }, t('mergeRejectBtn'))),
        rejecting ? h('div', { className: 'dshaSv_row' },
          h('input', { className: 'dshaSv_input', style: { flex: '1 1 10em' }, value: reasonText, maxLength: 500, placeholder: t('mergeRejectPlaceholder'), 'aria-label': t('mergeRejectLabel'), onClick: stop, onChange: (event) => setReason(event.target.value) }),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || reasonText.trim() === '', onClick: (event) => { stop(event); run('merge-reject', { reason: reasonText }).then(() => { setRejecting(false); setReason(''); }); } }, t('mergeRejectSend'))) : null);
    }

    const EntryCard = memo(function EntryCard({ kit, entry, onSelect, copied, onCopied, act, busy, release, updated = false }) {
      const [open, setOpen] = React.useState(undefined);
      const primary = act ? primaryOf(entry) : undefined;
      const label = { reply: 'reply', assign: 'assign', wake: 'wake' }[primary];
      const { t } = kit;
      const tone = toneOf(entry);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      return h(Card, { tone, updated, onOpen: () => onSelect(entry.sessionId), label: name },
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone, title: pillTitle(kit, entry) }, pillText(kit, entry)),
          h('span', { className: 'dshaSv_title', title: entry.title ?? name }, name),
          h('span', { className: 'dshaSv_state', 'data-state': entry.state, title: kit.stateText(t, entry.state) })),
        entry.summary ? h('div', { className: 'dshaSv_sumBox' }, h('p', { className: 'dshaSv_sum', title: entry.summary }, richSummary(entry.summary))) : null,
        // T14：合并流水线 + 用户动作（只记录 + 通知，不跑 git）；已合入 / 已发布只留结果
        entry.category === 'ready' || entry.status === 'ready' || entry.approval !== undefined ? h(MergeFlow, { kit, entry, release }) : null,
        entry.status === 'ready' ? h(MergeCardActions, { kit, entry, busy, act }) : null,
        // 底行：状态标记 + 一段等宽元信息（短 id · 提交 · 分支，放不下省略，悬停看全）+ 复制；
        // 按钮组靠右，窄栏里整组换到下一行，不再把分支、提交各挤成一行
        h('div', { className: 'dshaSv_foot' },
          entry.answered ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('answered')) : null,
          entry.queue ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, kit.format(t('queueNo'), { n: entry.queue })) : null,
          entry.pending && entry.pending.count > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': entry.pending.level === 'ok' ? undefined : 'warn', title: entry.pending.why ?? '' }, kit.format(t('sidePending'), { n: entry.pending.count })) : null,
          (entry.conflicts?.length ?? 0) > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': 'error' }, '⚠ ' + entry.conflicts.length) : null,
          h('span', { className: 'dshaSv_metaChips' },
            h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: entry.sessionId }, kit.shortId(entry.sessionId)),
            entry.commit ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: entry.commit }, String(entry.commit).slice(0, 7)) : null,
            (entry.branch ?? entry.checkout?.branch) ? h('span', { className: 'dshaSv_metaChip', title: entry.branch ?? entry.checkout?.branch }, entry.branch ?? entry.checkout?.branch) : null,
            entry.checkout?.linked ? h('span', { className: 'dshaSv_metaChip' }, '工作树') : null),
          h(CopyId, { kit, sessionId: entry.sessionId, copied, onCopied }),
          h('span', { className: 'dshaSv_acts' },
            primary ? h('button', { type: 'button', className: 'dshaSv_btn', 'aria-expanded': open === primary, onClick: stop(() => setOpen(open === primary ? undefined : primary)) }, t(label)) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': primary ? undefined : true, onClick: stop(() => kit.openSession(entry.sessionId)) }, h(IconOpen), t('openSession')))),
        open ? h(CardAction, { kit, entry, kind: open, act, onDone: () => setOpen(undefined) }) : null);
    });
    // 只把与本卡片有关的复制状态传下去：别的卡片复制时这张不重画
    const copiedFor = (copied, id) => (copied === id || copied === 'fail:' + id ? copied : undefined);

    /** 读取中占位：与卡片同高的三行，内容出来时不跳。 */

    function Detail({ kit, entry, board, onBack, copied, onCopied }) {
      const { t } = kit;
      const tone = toneOf(entry);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      // 字段：标签 + 胶囊/等宽芯片；状态/队列/分配用胶囊，路径 / sha / 模型用等宽芯片
      const info = [
        // 状态 / 更新时间已在页头，字段里不重复（基线：一个区块只表达一件事）
        ['sideModel', entry.model, 'mono'],
        ['sideBranch', entry.branch ?? entry.checkout?.branch, 'mono'],
        ['sideCommit', entry.commit, 'mono'],
        entry.checkout?.linked ? ['sideWorktree', entry.checkout.path, 'mono'] : undefined,
        entry.checkout?.base ? ['sideBase', String(entry.checkout.base).slice(0, 8) + (entry.checkout.baseRef ? `（${entry.checkout.baseRef}）` : ''), 'mono'] : undefined,
        entry.queue ? ['sideQueue', '#' + entry.queue, 'pill'] : undefined,
        ['sideAssigned', entry.assigned, 'pill']
      ].filter((row) => row !== undefined && row[1] !== undefined && row[1] !== '');
      const files = entry.files === undefined || entry.files === null || entry.files === ''
        ? []
        : (Array.isArray(entry.files) ? entry.files : String(entry.files).split(/[,，、]\s*/)).map((file) => String(file).trim()).filter(Boolean);
      const issues = [
        ...(entry.conflicts ?? []).map((item) => kit.format(t('sideOverlap'), { label: item.label, paths: (item.paths ?? []).join('、') })),
        ...(entry.declarationIssues ?? [])
      ];
      const decl = entry.declaration;
      const valueNode = (kind, value) => {
        const text = String(value);
        if (kind === 'state') return h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone }, text);
        if (kind === 'pill') return h('span', { className: 'dshaSv_pill' }, text);
        return h('span', { className: 'dshaSv_metaChip', 'data-mono': kind === 'mono' ? true : undefined, title: text }, text);
      };
      return h('div', { className: 'dshaSv' },
        h('div', { className: 'dshaSv_bar' },
          h('button', { type: 'button', className: 'dshaSv_btn', onClick: onBack }, h(IconBack), t('sideBack')),
          h('span', { className: 'dshaSv_crumb dshaSv_grow' }, `${board.workspace?.title ?? ''} / ${name}`),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, onClick: () => kit.openSession(entry.sessionId) }, h(IconOpen), t('openSession')),
          h(CopyId, { kit, sessionId: entry.sessionId, copied, onCopied })),
        h('div', { className: 'dshaSv_detailHead' },
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.shortId(entry.sessionId)),
            h('p', { className: 'dshaSv_big dshaSv_grow' }, entry.title ?? name),
            h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone, title: pillTitle(kit, entry) }, '● ' + pillText(kit, entry))),
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_muted dshaSv_grow' }, [name, kit.formatTime(entry.updatedAt)].filter(Boolean).join(' · ')),
            h('span', { className: 'dshaSv_state', 'data-state': entry.state, title: kit.stateText(t, entry.state) }),
            h('span', { className: 'dshaSv_muted' }, kit.stateText(t, entry.state)))),
        entry.question && (entry.status === 'question' || entry.status === 'blocked')
          ? h('p', { className: 'dshaSv_alert', 'data-tone': entry.status === 'blocked' ? 'error' : undefined }, kit.format(t('question'), { v: entry.question })) : null,
        h('div', { className: 'dshaSv_grid' },
        entry.summary ? h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('p', { className: 'dshaSv_h' }, t('sideDetailSummary')),
          h('p', { className: 'dshaSv_sumFull', title: entry.summary }, richSummary(entry.summary))) : null,
        info.length > 0 ? h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('p', { className: 'dshaSv_h' }, t('sideDetailInfo')),
          h('div', { className: 'dshaSv_fields' }, ...info.map(([key, value, kind]) => h('div', { key, className: 'dshaSv_fieldRow' },
            h('span', { className: 'dshaSv_fieldLabel' }, t(key)),
            valueNode(kind, value))))) : null,
        files.length > 0 ? h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('p', { className: 'dshaSv_h' }, t('sideDetailFiles')),
          h('div', { className: 'dshaSv_metaChips' },
            ...files.slice(0, 16).map((file, index) => h('span', { key: file + ':' + index, className: 'dshaSv_metaChip', 'data-mono': true, title: file }, file)),
            files.length > 16 ? h('span', { className: 'dshaSv_pill' }, '+' + (files.length - 16)) : null)) : null,
        decl ? h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('p', { className: 'dshaSv_h' }, t('sideDetailDecl')),
          h('div', { className: 'dshaSv_metaChips' },
            decl.rel ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: decl.rel }, decl.rel) : null,
            decl.mergeLabel ? h('span', { className: 'dshaSv_pill', 'data-tone': /可合并/.test(String(decl.mergeLabel)) ? 'ok' : /不可合并|冲突/.test(String(decl.mergeLabel)) ? 'warn' : undefined }, String(decl.mergeLabel)) : null,
            decl.build ? h('span', { className: 'dshaSv_pill' }, String(decl.build)) : null,
            decl.phase ? h('span', { className: 'dshaSv_pill' }, String(decl.phase)) : null)) : null,
        issues.length > 0 ? h('section', { className: 'dshaSv_sec dshaSv_span' }, h('p', { className: 'dshaSv_h' }, t('sideDetailIssues')),
          ...issues.map((text, index) => h('p', { key: index, className: 'dshaSv_alert', 'data-tone': 'error' }, text))) : null));
    }

    /** 顶栏身份胶囊：当前 GitHub 账号；锁定的账号不在就标红（详情和操作在设置页）。 */

    function Attention({ kit, board, busy, act }) {
      const { t } = kit;
      const asks = Array.isArray(board.asks) ? board.asks : [];
      const alerts = [];
      const gh = board.github;
      if (gh && (gh.match === 'mismatch' || (gh.match === 'missing' && gh.pinned))) alerts.push({ key: 'gh', tone: 'error', text: gh.match === 'mismatch' ? kit.format(t('ghPillMismatch'), { login: gh.login, pinned: gh.pinned?.login ?? '' }) : t('sideAlertGhGone') });
      if (board.unattended?.paused) alerts.push({ key: 'wake', tone: 'warn', text: t('sideAlertWake'), action: { label: t('wakeResume'), body: { action: 'unattended-resume' } } });
      if (board.handoff?.draft) alerts.push({ key: 'handoff', text: t('sideAlertHandoff') });
      if ((board.declarations?.mismatches ?? 0) > 0) alerts.push({ key: 'decl', tone: 'error', text: kit.format(t('sideAlertDecl'), { n: board.declarations.mismatches }) });
      const now = Date.now();
      // 只提示最近 2 小时内真的出问题的核验；cancelled（被后续提交取代）不算，历史记录留在「交接与核验」页里翻
      for (const item of (board.watches ?? []).filter((w) => (w.state === 'failed' || w.state === 'timeout') && now - (w.checkedAt ?? 0) < 2 * 3600_000).slice(0, 3)) alerts.push({ key: 'w' + item.id, tone: 'error', text: item.line });
      if (asks.length === 0 && alerts.length === 0) return null;
      return h('section', { className: 'dshaSv_sec', 'aria-label': t('askTitle') },
        ...asks.map((ask) => h('div', { key: ask.id, className: 'dshaSv_ask', role: 'group', 'aria-label': t('askTitle') },
          h('p', { className: 'dshaSv_h' }, t('askTitle') + (ask.byLabel ? ' · ' + ask.byLabel : '')),
          h('p', { className: 'dshaSv_askQ' }, ask.question),
          h('div', { className: 'dshaSv_filters' },
            ...ask.options.map((option) => h('button', { key: option, type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => act({ action: 'ask-answer', id: ask.id, option }, t('askAnswered')) }, option)),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'ask-dismiss', id: ask.id }, t('askDismissed')) }, t('askDismiss'))))),
        ...alerts.map((item) => h('div', { key: item.key, className: 'dshaSv_alert dshaSv_row', 'data-tone': item.tone, role: item.tone === 'error' ? 'alert' : 'status' },
          h('span', { className: 'dshaSv_grow' }, item.text),
          item.action ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act(item.action.body, undefined) }, item.action.label) : null)));
    }

    // 与 lib/github.js 的 IMPLIED_SCOPES 保持一致：判断「这一档是否已经补足」时按隐含闭包摊平

    const QUIET = new Set(['blank', 'idle']);

    /* ---------------------------------------------------------------- 页签壳 */


    function SessionSearch({ kit, board, sessionId, openSession }) {
      const { t } = kit;
      const [open, setOpen] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [found, setFound] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [working, setWorking] = React.useState(false);
      const [mode, setMode] = React.useState('session');
      const [hits, setHits] = React.useState(undefined);
      const run = (event) => {
        event?.preventDefault?.();
        const text = query.trim();
        if (text === '') return;
        setWorking(true);
        setError(undefined);
        const base = { scope: 'workspace', ...(board.workspace?.id ? { workspace: board.workspace.id } : {}), ...(sessionId ? { session: sessionId, fromSession: sessionId } : {}) };
        const request = mode === 'session'
          ? { view: 'find', q: text, ...base }
          : { view: 'search', q: text, maxSessions: 10, maxHits: 24, ...base };
        kit.request('GET', undefined, request).then(
          (payload) => {
            if (mode === 'session') setFound(payload?.find ?? null);
            else setHits(payload?.search ?? null);
            setWorking(false);
          },
          (failure) => { setError(kit.errorText(t, failure)); setWorking(false); });
      };
      const switchMode = (next) => { setMode(next); setFound(undefined); setHits(undefined); setError(undefined); };
      const results = Array.isArray(found?.results) ? found.results : [];
      const groups = Array.isArray(hits?.groups) ? hits.groups : [];
      const resultRow = (item) => {
        const entry = item.kind === 'board' ? item.entry : item.session;
        const id = entry?.sessionId;
        if (typeof id !== 'string' || id === '') return null;
        return h('div', { key: id, className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_grow' }, (entry.label ? entry.label + ' ' : '') + (entry.title ? '「' + entry.title + '」' : kit.shortId(id))),
          item.kind === 'board' ? null : h('span', { className: 'dshaSv_muted' }, t('findNotJoined')),
          h('button', { type: 'button', className: 'dshaSv_link', onClick: () => openSession(id) }, t('openSession')));
      };
      const contentResult = hits === undefined ? null : h(React.Fragment, null,
        h('p', { className: 'dshaSv_muted' }, kit.format(t('searchStats'), {
          scanned: hits.scanned ?? 0, hits: hits.total ?? 0,
          skipped: Number(hits.skipped) > 0 ? kit.format(t('searchSkipped'), { n: hits.skipped }) : ''
        })),
        groups.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('searchNoResults')) : null,
        ...groups.slice(0, 8).map((group) => h('div', { key: group.sessionId, className: 'dshaSv_card' },
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_h dshaSv_grow' }, group.title || group.label || kit.shortId(group.sessionId)),
            h('button', { type: 'button', className: 'dshaSv_link', onClick: () => openSession(group.sessionId) }, t('searchOpen'))),
          ...(group.hits ?? []).slice(0, 4).map((hit, index) => h('p', { key: String(hit.seq) + '-' + index, className: 'dshaSv_muted' },
            `seq ${hit.seq} · turn ${hit.turn} · ${hit.kind}/${hit.label}：${hit.snippet}`)))));
      return h('section', { className: 'dshaSv_sec' },
        h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': open, onClick: () => setOpen(!open) }, t('findTitle')),
        open ? h(React.Fragment, null,
          h('div', { className: 'dshaSv_row' },
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': mode === 'session' ? true : undefined, 'aria-pressed': mode === 'session', onClick: () => switchMode('session') }, t('findMode')),
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': mode === 'content' ? true : undefined, 'aria-pressed': mode === 'content', onClick: () => switchMode('content') }, t('contentMode'))),
          h('form', { className: 'dshaSv_row', onSubmit: run },
            h('input', {
              className: 'dshaSv_input', type: 'search', value: query, maxLength: mode === 'content' ? 300 : 120,
              placeholder: mode === 'session' ? t('findPlaceholder') : t('searchPlaceholder'),
              'aria-label': mode === 'session' ? t('findPlaceholder') : t('searchPlaceholder'),
              onChange: (event) => setQuery(event.target.value)
            }),
            h('button', { type: 'submit', className: 'dshaSv_btn', disabled: working || query.trim() === '' }, working ? t('searchLoading') : t('searchSubmit'))),
          mode === 'content' ? h('p', { className: 'dshaSv_muted' }, t('searchHint')) : null,
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          mode === 'session'
            ? (found === undefined ? null
              : results.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('findEmpty'))
                : h('div', { className: 'dshaSv_list' }, ...results.slice(0, 12).map(resultRow)))
            : contentResult) : null);
    }

    /** 动态页的邮箱：公共通知全文；标已读 / 归档只由用户点。 */

      return { SessionsTab, SessionDetail: Detail, SessionSearch, Attention, EntryCard, LineNotice };
    }

    return { KIT_VERSION: 45, make };
  }
});
