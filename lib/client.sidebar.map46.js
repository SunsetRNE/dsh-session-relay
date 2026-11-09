window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.map46.js',
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
        WorkItemChips, WorkItemDetail, TicketCockpit, useLazyDetail, prefetchWorkItemDetail, workItemTabKey, workItemCacheClear, WORK_ITEM_TTL_MS,
        useRemoteList, PopoverPicker, ModelSelect, ModelEffort, useModelsView, modelField, modelsCache, modelSelectValue
      } = deps.shared;
      const { agoText, categoryOf, isAttention, isReady, isActive, isDone, collectPrs, FOLD_PAGES, memo, usePersisted } = deps.ui;


    /** 地图页：任务地图票子 + 本地票子（原「动态」的地图与票子区）。 */
    function MapTab({ kit, board, act, busy, onBack, focus, onFocusConsumed, onOpenWorkItem }) {
      const { t } = kit;
      const [splitOpen, setSplitOpen] = React.useState(false);
      const [splitParent, setSplitParent] = React.useState('');
      const [splitText, setSplitText] = React.useState('');
      const [splitSerial, setSplitSerial] = React.useState(false);
      const taskBoard = board.taskBoard;
      const map = Array.isArray(taskBoard?.map) ? taskBoard.map : [];
      const sync = board.sync;
      const links = Array.isArray(sync?.links) ? sync.links : [];
      const syncLinks = new Map(links.map((item) => [String(item.id).toUpperCase(), item]));
      const childTotal = map.reduce((sum, group) => sum + (Number(group.childTotal) || (Array.isArray(group.children) ? group.children.length : 0)), 0);
      const mapMore = Number(taskBoard?.mapMore) || 0;
      const openSplit = (parentId = '') => { setSplitParent(parentId); setSplitOpen(true); };
      const submitSplit = (event) => {
        event?.preventDefault?.();
        if (typeof act !== 'function') return;
        const parent = splitParent.trim().toUpperCase();
        const subtasks = splitText.split(/\|\||\n/).map((item) => item.trim()).filter(Boolean);
        if (parent === '' || subtasks.length === 0) return;
        const pending = act({ action: 'task-split', task: parent, subtasks, serial: splitSerial });
        if (pending !== undefined && typeof pending.then === 'function') pending.then((payload) => {
          if (payload !== undefined) { setSplitOpen(false); setSplitText(''); setSplitSerial(false); }
        });
      };
      const titleOf = new Map();
      for (const row of [...(taskBoard?.open ?? []), ...(taskBoard?.claimedRows ?? []), ...(taskBoard?.endedRows ?? [])]) {
        if (row?.id) titleOf.set(String(row.id).toUpperCase(), row.title ?? String(row.id));
      }
      for (const group of map) {
        titleOf.set(String(group.id).toUpperCase(), group.title);
        for (const child of Array.isArray(group.children) ? group.children : []) titleOf.set(String(child.id).toUpperCase(), child.title);
      }
      const statusOf = (item) => {
        if (item.approvalLabel) return { text: item.approvalLabel, tone: 'warn' };
        if (item.stageLabel) return { text: item.stageLabel, tone: item.stage === 'review' ? 'warn' : undefined };
        if (item.kind === 'ended') return { text: t('sideTaskEnded') };
        if (item.kind === 'active') return { text: t('sideTaskActive'), tone: 'brand' };
        if (item.kind === 'open') return { text: t('sideTaskOpen'), tone: 'ok' };
        return undefined;
      };
      const statePill = (item) => {
        const status = statusOf(item);
        return status === undefined ? null : h('span', { className: 'dshaSv_pill', 'data-tone': status.tone }, status.text);
      };
      const ticketOf = (item) => {
        if (item.issue && item.issueUrl) return { number: item.issue, url: item.issueUrl, remoteState: item.issueRemoteState ?? null };
        const link = syncLinks.get(String(item.id).toUpperCase());
        return link && link.issue ? { number: link.issue, url: link.url ?? null, remoteState: link.remoteState ?? null } : null;
      };
      const ticketNo = (item) => {
        const ticket = ticketOf(item);
        if (ticket === null) return h('span', { className: 'dshaSv_ticketNo', 'data-missing': true }, t('sideMapNoTicket'));
        return ticket.url
          ? h('a', { className: 'dshaSv_ticketNo', href: ticket.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen'), onClick: (event) => event?.stopPropagation?.() }, '#' + ticket.number)
          : h('span', { className: 'dshaSv_ticketNo' }, '#' + ticket.number);
      };
      // 当前地图票 → 共用详情数据；focus 由 RelaySidebar.openWorkItem 传入，挂载 / 变化时打开
      const findTicket = (id) => {
        const key = String(id ?? '').toUpperCase();
        if (key === '') return undefined;
        for (const group of map) {
          if (String(group.id).toUpperCase() === key) return { item: group, parent: undefined };
          for (const child of Array.isArray(group.children) ? group.children : []) {
            if (String(child.id).toUpperCase() === key) return { item: child, parent: group };
          }
        }
        return undefined;
      };
      const workItemOf = (item, parent) => {
        const ticket = ticketOf(item);
        return {
          kind: 'map-ticket', id: String(item.id), title: item.title ?? String(item.id),
          status: statusOf(item), link: ticket === null ? undefined : { text: '#' + ticket.number, url: ticket.url ?? undefined },
          source: item, parent, issue: ticket,
          dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
          children: Array.isArray(item.children) ? item.children : [],
          childTotal: Number(item.childTotal) || 0
        };
      };
      const mapLoaded = taskBoard !== null && taskBoard !== undefined;
      const [detail, setDetail] = React.useState(() => {
        if (focus === undefined || focus === null || focus.kind !== 'map-ticket') return undefined;
        const hit = findTicket(focus.id);
        return hit === undefined ? undefined : workItemOf(hit.item, hit.parent);
      });
      React.useEffect(() => {
        if (focus === undefined || focus === null || focus.kind !== 'map-ticket') return;
        const hit = findTicket(focus.id);
        if (hit !== undefined) setDetail(workItemOf(hit.item, hit.parent));
        // 看板还没到就留着 focus，等 map 数据到了再试；数据到了但票不在（已结束/没投影）才放弃
        if (hit !== undefined || mapLoaded) {
          if (typeof onFocusConsumed === 'function') onFocusConsumed();
        }
      }, [focus?.seq, focus?.id, focus?.kind, map.length, mapLoaded]);
      const ticketState = (item) => {
        const ticket = ticketOf(item);
        const state = typeof ticket?.remoteState === 'string' ? ticket.remoteState.toLowerCase() : '';
        if (state === '') return null;
        return h('span', { className: 'dshaSv_pill', 'data-tone': state === 'open' ? 'ok' : state === 'closed' ? undefined : 'warn' }, state.toUpperCase());
      };
      const openTicket = (item, parent) => setDetail(workItemOf(item, parent));
      const ticketCard = (group) => h('div', {
        key: group.id, className: 'dshaSv_ticket dshaSv_workRow', role: 'button', tabIndex: 0,
        'aria-label': group.title ?? String(group.id),
        onClick: () => openTicket(group, undefined),
        onKeyDown: (event) => {
          if (event !== null && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault?.(); openTicket(group, undefined); }
        }
      },
        h('div', { className: 'dshaSv_ticketHead' },
          ticketNo(group),
          h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': group.kind === 'ended' ? undefined : 'brand' }, group.id),
          h('span', { className: 'dshaSv_grow', title: group.title }, group.title),
          ticketState(group),
          statePill(group),
          group.kind === 'ended' ? null : h('button', { type: 'button', className: 'dshaSv_link', disabled: busy, onClick: (event) => { event?.stopPropagation?.(); openSplit(group.id); } }, t('sideMapSplit'))),
        ...(Array.isArray(group.children) ? group.children.map((child) => h('div', {
          key: child.id, className: 'dshaSv_ticketChild dshaSv_workRow', role: 'button', tabIndex: 0,
          'aria-label': child.title ?? String(child.id),
          onClick: (event) => { event?.stopPropagation?.(); openTicket(child, group); },
          onKeyDown: (event) => {
            if (event !== null && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault?.(); openTicket(child, group); }
          }
        },
          h('span', { className: 'dshaSv_tree', 'aria-hidden': 'true' }, '↳'),
          ticketNo(child),
          h('span', { className: 'dshaSv_pill', 'data-mono': true }, child.id),
          h('span', { className: 'dshaSv_grow', title: child.title }, child.title),
          ticketState(child),
          statePill(child),
          Array.isArray(child.dependsOn) && child.dependsOn.length > 0
            ? h('span', { className: 'dshaSv_muted', title: child.dependsOn.join('、') }, kit.format(t('sideMapDepends'), { v: child.dependsOn.join('、') }))
            : null)) : []),
        Number(group.childTotal) > (Array.isArray(group.children) ? group.children.length : 0)
          ? h('p', { className: 'dshaSv_muted dshaSv_ticketChild' }, '+' + (Number(group.childTotal) - group.children.length))
          : null);
      const mapBody = taskBoard === null
        ? h('p', { className: 'dshaSv_muted' }, t('sideMapNoBoard'))
        : map.length === 0
          ? h('div', { className: 'dshaSv_quote' }, t('sideMapEmpty'))
          : h(React.Fragment, null,
            h('div', { className: 'dshaSv_tickets' }, ...map.map(ticketCard)),
            mapMore > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideMapMore'), { n: mapMore })) : null);
      const splitForm = splitOpen ? h('form', { className: 'dshaSv_splitForm', onSubmit: submitSplit },
        h('div', { className: 'dshaSv_row' },
          h('input', {
            className: 'dshaSv_input', style: { maxWidth: '10em' }, value: splitParent, maxLength: 32,
            placeholder: t('sideMapSplitParent'), 'aria-label': t('sideMapSplitParent'),
            onChange: (event) => setSplitParent(event.target.value)
          }),
          h('label', { className: 'dshaSv_check' },
            h('input', { type: 'checkbox', checked: splitSerial, onChange: (event) => setSplitSerial(event.target.checked) }),
            h('span', null, t('sideMapSplitSerial')))),
        h('textarea', {
          className: 'dshaSv_input', rows: 3, value: splitText, maxLength: 4000,
          placeholder: t('sideMapSplitChildren'), 'aria-label': t('sideMapSplitChildren'),
          onChange: (event) => setSplitText(event.target.value)
        }),
        h('p', { className: 'dshaSv_muted' }, t('sideMapSplitHint')),
        h('div', { className: 'dshaSv_row' },
          h('button', { type: 'submit', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || splitParent.trim() === '' || splitText.trim() === '' }, t('sideMapSplitSubmit')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setSplitOpen(false) }, t('cancel')))) : null;
      const ticketList = links.slice(-8).reverse();
      const syncState = { synced: 'syncStateSynced', queued: 'syncStateQueued', 'in-flight': 'syncStateInflight', unknown: 'syncStateUnknown', failed: 'syncStateFailed', local: 'syncStateLocal', conflict: 'syncStateConflict' };
      const detailNode = detail === undefined ? null : h(WorkItemDetail, {
        key: 'map:' + detail.id,
        kit,
        item: detail,
        fields: [
          [t('workItemStage'), detail.source.stageLabel ?? '—'],
          [t('workItemApproval'), detail.source.approvalLabel ?? '—'],
          [t('workItemDepends'), detail.dependsOn.length > 0 ? detail.dependsOn.join('、') : '—'],
          [t('workItemChildren'), detail.children.length > 0
            ? detail.children.map((child) => child.id + ' ' + (child.title ?? '')).join('、')
            : (detail.childTotal > 0 ? '+' + detail.childTotal : '—')],
          [t('workItemParent'), detail.parent === undefined ? '—' : detail.parent.id + ' ' + (detail.parent.title ?? '')],
          [t('workItemIssue'), detail.issue === null
            ? h('span', { className: 'dshaSv_muted' }, t('sideMapNoTicket'))
            : h(React.Fragment, null,
              onOpenWorkItem === undefined
                ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, '#' + detail.issue.number)
                : h('button', {
                  type: 'button', className: 'dshaSv_pill', 'data-mono': true, title: t('workItemIssueOpen'),
                  onClick: () => onOpenWorkItem({ kind: 'issue', id: detail.issue.number })
                }, '#' + detail.issue.number),
              detail.issue.url ? h('a', { className: 'dshaSv_link', href: detail.issue.url, target: '_blank', rel: 'noopener noreferrer' }, t('sidePrOpen')) : null)]
        ],
        body: h(TicketCockpit, {
          kit, task: detail.source, skills: taskBoard?.skills, entries: board.entries, act, busy,
          sessionId: board.self?.sessionId, withApproval: true
        }),
        actions: h(React.Fragment, null,
          detail.source.kind === 'ended' ? null : h('button', {
            type: 'button', className: 'dshaSv_btn', 'data-primary': true,
            onClick: () => { setDetail(undefined); openSplit(detail.id); }
          }, t('sideMapSplit')),
          detail.issue !== null && detail.issue.url !== undefined && detail.issue.url !== null && detail.issue.url !== ''
            ? h('a', { className: 'dshaSv_btn', href: detail.issue.url, target: '_blank', rel: 'noopener noreferrer' }, t('sidePrOpen'))
            : null),
        onClose: () => setDetail(undefined)
      });
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h(BackMore, { kit, onBack }),
            h('span', { className: 'dshaSv_star dshaSv_mapIcon' }, h(IconMap)),
            h('span', { className: 'dshaSv_h dshaSv_grow' }, t('sideMapTitle')),
            map.length > 0 ? h('span', { className: 'dshaSv_pill' }, kit.format(t('sideMapGroups'), { n: map.length, children: childTotal })) : null,
            h('button', {
              type: 'button', className: 'dshaSv_btn', disabled: busy || taskBoard === null,
              'aria-expanded': splitOpen ? 'true' : undefined,
              onClick: () => { if (splitOpen) setSplitOpen(false); else openSplit(); }
            }, t('sideMapSplit'))),
          h('p', { className: 'dshaSv_muted' }, t('sideMapHint')),
          splitForm,
          mapBody),
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_star dshaSv_mapIcon' }, h(IconList)),
            h('span', { className: 'dshaSv_h dshaSv_grow' }, t('sideTicketTitle')),
            ticketList.length > 0 ? h('span', { className: 'dshaSv_pill' }, String(ticketList.length)) : null),
          ticketList.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('sideTicketEmpty'))
            : h('div', { className: 'dshaSv_tickets' }, ...ticketList.map((link) => {
              const hit = findTicket(link.id);
              return h('div', {
                key: link.id, className: 'dshaSv_ticket' + (hit === undefined ? '' : ' dshaSv_workRow'),
                role: hit === undefined ? undefined : 'button', tabIndex: hit === undefined ? undefined : 0,
                'aria-label': hit === undefined ? undefined : (hit.item.title ?? String(hit.item.id)),
                onClick: hit === undefined ? undefined : () => openTicket(hit.item, hit.parent),
                onKeyDown: hit === undefined ? undefined : (event) => {
                  if (event !== null && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault?.(); openTicket(hit.item, hit.parent); }
                }
              },
              h('div', { className: 'dshaSv_ticketHead' },
                link.issue
                  ? (link.url ? h('a', { className: 'dshaSv_ticketNo', href: link.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen'), onClick: (event) => event?.stopPropagation?.() }, '#' + link.issue) : h('span', { className: 'dshaSv_ticketNo' }, '#' + link.issue))
                  : h('span', { className: 'dshaSv_ticketNo', 'data-missing': true }, t('sideMapNoTicket')),
                h('span', { className: 'dshaSv_pill', 'data-mono': true }, link.id),
                h('span', { className: 'dshaSv_grow', title: titleOf.get(String(link.id).toUpperCase()) ?? String(link.id) }, titleOf.get(String(link.id).toUpperCase()) ?? String(link.id)),
                link.remoteState ? h('span', { className: 'dshaSv_pill', 'data-tone': String(link.remoteState).toLowerCase() === 'open' ? 'ok' : undefined }, String(link.remoteState).toUpperCase()) : null,
                h('span', { className: 'dshaSv_pill' }, t(syncState[link.state] ?? 'syncStateUnknown'))));
            }))),
        detailNode);
    }

    // 侧栏远端列表的内存缓存：切走再回来 / 侧栏重开时先用上次数据渲染，再后台刷新

      return { MapTab };
    }

    return { KIT_VERSION: 46, make };
  }
});
