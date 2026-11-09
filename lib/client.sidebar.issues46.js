window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.issues46.js',
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


    /** 问题页：远端 issue 列表（只读，与地图分开）；支持搜索、指派给我与标签筛选。 */
    function IssueTab({ kit, board, sessionId, onBack, focus, onFocusConsumed, onOpenWorkItem }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'issue-list', session: sessionId });
      const [query, setQuery] = React.useState('');
      const [filter, setFilter] = React.useState('all');
      const [label, setLabel] = React.useState(undefined);
      const view = data?.issues;
      const items = Array.isArray(view?.items) ? view.items : [];
      const login = typeof board?.github?.login === 'string' ? board.github.login.toLowerCase() : '';
      const q = query.trim().toLowerCase();
      const labelCounts = new Map();
      for (const item of items) for (const name of item.labels) labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
      const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
      const mine = (item) => login !== '' && item.assignees.some((name) => String(name).toLowerCase() === login);
      const matched = items
        .filter((item) => filter === 'all' || (filter === 'mine' && mine(item)))
        .filter((item) => label === undefined || item.labels.includes(label))
        .filter((item) => q === '' || String(item.number).includes(q) || String(item.title).toLowerCase().includes(q))
        .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
      const linked = new Map();
      for (const link of Array.isArray(board?.sync?.links) ? board.sync.links : []) {
        if (link?.issue) linked.set(Number(link.issue), String(link.id));
      }
      const findIssue = (id) => items.find((item) => Number(item.number) === Number(id));
      const issueWorkItem = (item) => ({
        kind: 'issue', id: '#' + item.number, title: item.title,
        status: { text: t('issueStateOpen'), tone: 'ok' },
        owner: item.assignees.length > 0 ? '@' + item.assignees[0] : (item.author ? '@' + item.author : undefined),
        link: item.url ? { text: '#' + item.number, url: item.url } : undefined,
        source: item
      });
      const issuesLoaded = view !== undefined || error !== undefined;
      const [detail, setDetail] = React.useState(() => {
        if (focus === undefined || focus === null || focus.kind !== 'issue') return undefined;
        const hit = findIssue(focus.id);
        return hit === undefined ? undefined : issueWorkItem(hit);
      });
      React.useEffect(() => {
        if (focus === undefined || focus === null || focus.kind !== 'issue') return;
        const hit = findIssue(focus.id);
        if (hit !== undefined) setDetail(issueWorkItem(hit));
        // issue 列表还没到就留着 focus；到了但列表里没有这个号才放弃
        if (hit !== undefined || issuesLoaded) {
          if (typeof onFocusConsumed === 'function') onFocusConsumed();
        }
      }, [focus?.seq, focus?.id, focus?.kind, items.length, issuesLoaded]);
      const openIssue = (item) => setDetail(issueWorkItem(item));
      const chip = (key, text, n, active, onClick) => h('button', {
        key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': active ? 'true' : undefined, onClick
      }, text, n === undefined ? null : h('span', { className: 'dshaSv_muted' }, String(n)));
      const detailNode = detail === undefined ? null : h(WorkItemDetail, {
        key: 'issue:' + detail.source.number,
        kit,
        item: detail,
        fields: [
          [t('workItemAuthor'), detail.source.author ? '@' + detail.source.author : '—'],
          [t('workItemLabels'), detail.source.labels.length > 0
            ? h(React.Fragment, null, ...detail.source.labels.map((name) => h('span', { key: 'l-' + name, className: 'dshaSv_pill' }, name)))
            : '—'],
          [t('workItemAssignees'), detail.source.assignees.length > 0
            ? h(React.Fragment, null, ...detail.source.assignees.map((name) => h('span', { key: 'a-' + name, className: 'dshaSv_metaChip' }, '@' + name)))
            : '—'],
          [t('workItemUpdated'), detail.source.updatedAt ? kit.formatTime(Date.parse(detail.source.updatedAt)) : '—'],
          [t('workItemComments'), String(Number(detail.source.comments) || 0)],
          [t('workItemLinkedTask'), linked.has(Number(detail.source.number))
            ? (onOpenWorkItem === undefined
              ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, linked.get(Number(detail.source.number)))
              : h('button', {
                type: 'button', className: 'dshaSv_pill', 'data-mono': true,
                onClick: () => onOpenWorkItem({ kind: 'task', id: linked.get(Number(detail.source.number)) })
              }, linked.get(Number(detail.source.number))))
            : h('span', { className: 'dshaSv_muted' }, '—')]
        ],
        actions: detail.source.url ? h('a', { className: 'dshaSv_btn', href: detail.source.url, target: '_blank', rel: 'noopener noreferrer' }, t('sidePrOpen')) : null,
        onClose: () => setDetail(undefined)
      });
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h(BackMore, { kit, onBack }),
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabIssues')),
            loading && view !== undefined ? h('span', { className: 'dshaSv_actionPulse', 'aria-hidden': 'true' }) : null,
            view?.repo ? h('span', { className: 'dshaSv_pill dshaSv_repoPill', 'data-mono': true, title: view.repo }, view.repo) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh'))),
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          view?.error ? h('p', { className: 'dshaSv_muted' }, view.error) : null,
          view !== undefined ? h('input', {
            className: 'dshaSv_input', value: query, maxLength: 120, placeholder: t('issueSearch'), 'aria-label': t('issueSearch'),
            onChange: (event) => setQuery(event.target.value)
          }) : null,
          view !== undefined ? h('div', { className: 'dshaSv_chips' },
            chip('all', t('issueFilterAll'), items.length, filter === 'all' && label === undefined, () => { setFilter('all'); setLabel(undefined); }),
            login !== '' ? chip('mine', t('issueFilterMine'), items.filter(mine).length, filter === 'mine' && label === undefined, () => { setFilter(filter === 'mine' ? 'all' : 'mine'); setLabel(undefined); }) : null,
            ...topLabels.map(([name, n]) => chip('l:' + name, name, n, label === name, () => setLabel(label === name ? undefined : name)))) : null,
          view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
          view !== undefined && matched.length > 0 ? h('div', { className: 'dshaSv_list' }, ...matched.map((item) => h('div', {
            key: item.number, className: 'dshaSv_listRow dshaSv_workRow', role: 'button', tabIndex: 0,
            'aria-label': item.title ?? ('#' + item.number),
            // 整行可点（标题 / 摘要 / 空白都行）；行内 a / button 各自 stopPropagation，不会误触
            onClick: () => openIssue(item),
            onKeyDown: (event) => {
              if (event !== null && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault?.(); openIssue(item); }
            }
          },
            h('div', { className: 'dshaSv_listMain' },
              h('div', { className: 'dshaSv_bar' },
                h('a', { className: 'dshaSv_ticketNo', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen'), onClick: (event) => event?.stopPropagation?.() }, '#' + item.number),
                h('span', { className: 'dshaSv_grow', title: item.title }, item.title),
                mine(item) ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('issueFilterMine')) : null,
                linked.has(item.number)
                  ? (onOpenWorkItem === undefined
                    ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, linked.get(item.number))
                    : h('button', {
                      type: 'button', className: 'dshaSv_pill', 'data-mono': true, title: t('workItemLinkedTask'),
                      onClick: (event) => { event?.stopPropagation?.(); onOpenWorkItem({ kind: 'task', id: linked.get(item.number) }); }
                    }, linked.get(item.number)))
                  : null,
                h('button', { type: 'button', className: 'dshaSv_link', onClick: (event) => { event?.stopPropagation?.(); openIssue(item); } }, t('prOpenDetail'))),
              h('p', { className: 'dshaSv_muted' }, ['@' + item.author, item.updatedAt ? kit.formatTime(Date.parse(item.updatedAt)) : '', item.comments > 0 ? kit.format(t('prCommentCount'), { n: item.comments }) : ''].filter(Boolean).join(' · ')),
              item.labels.length > 0 || item.assignees.length > 0 ? h('div', { className: 'dshaSv_row' },
                ...item.labels.map((name) => h('button', { key: 'l-' + name, type: 'button', className: 'dshaSv_pill', onClick: (event) => { event?.stopPropagation?.(); setLabel(label === name ? undefined : name); } }, name)),
                ...item.assignees.map((name) => h('span', { key: 'a-' + name, className: 'dshaSv_muted' }, '@' + name))) : null)))) : null,
          view !== undefined && matched.length === 0 ? h('div', { className: 'dshaSv_quote' }, q !== '' || filter !== 'all' || label !== undefined ? t('issueNoMatch') : t('issueEmpty')) : null),
        detailNode);
    }

    /** 遗留分支清理：只列被工作树占用的分支；多选后一次确认批量移除，服务端逐条复核。 */

      return { IssueTab };
    }

    return { KIT_VERSION: 46, make };
  }
});
