window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.prs42.js',
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


    const PR_DECISION_LABEL = { APPROVED: 'prReviewApproved', CHANGES_REQUESTED: 'prReviewChanges', REVIEW_REQUIRED: 'prReviewRequired' };

    /** 长正文 / 长评论：轻量富文本按散文渲染，默认折四行，点「展开全文」再看；短文本不出按钮。 */
    function Clamp({ kit, text }) {
      const [open, setOpen] = React.useState(false);
      if (typeof text !== 'string' || text === '') return null;
      const fold = text.length > 140 || (text.match(/\n/g) ?? []).length >= 3;
      return h('div', { className: 'dshaSv_clamp' + (fold && !open ? ' dshaSv_clampFold' : '') },
        h('p', { className: 'dshaSv_prose' }, richLines(text)),
        fold ? h('button', {
          type: 'button', className: 'dshaSv_link', 'aria-expanded': open ? 'true' : undefined,
          onClick: () => setOpen(!open)
        }, open ? kit.t('prCollapse') : kit.t('prExpand')) : null);
    }

    /** PR 详情：评论与评审正文；P1a 起由 WorkItemDetail 外壳承载，数据走懒加载 / 预取缓存。 */
    function PrDetail({ kit, sessionId, number }) {
      const { t } = kit;
      const { data, error, loading, open, invalidate } = useLazyDetail({ kit, params: { view: 'pr-detail', session: sessionId, number } });
      const reload = () => { invalidate(); return open(); };
      const detail = data?.prDetail?.detail;
      const REVIEW_LABEL = { approved: 'prReviewApproved', 'changes-requested': 'prReviewChanges', commented: 'prReviewCommented', dismissed: 'prReviewDismissed', pending: 'prReviewPending' };
      const reviewPill = (state) => {
        const label = REVIEW_LABEL[state];
        if (label === undefined) return null;
        const tone = state === 'approved' ? 'ok' : state === 'changes-requested' ? 'error' : 'warn';
        return h('span', { className: 'dshaSv_pill', 'data-tone': tone }, t(label));
      };
      if (error) return h(React.Fragment, null,
        h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error),
        h('button', { type: 'button', className: 'dshaSv_link', onClick: () => reload() }, t('tasksRefresh')));
      if (detail === undefined) {
        return loading
          ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1].map((index) => h('div', { key: index, className: 'dshaSv_skel' })))
          : h('div', { className: 'dshaSv_quote' }, t('prDetailEmpty'));
      }
      const files = Array.isArray(detail.files) ? detail.files : [];
      const shownFiles = files.slice(0, 30);
      const changeLabel = { ADDED: 'prChangeAdded', MODIFIED: 'prChangeModified', REMOVED: 'prChangeRemoved', RENAMED: 'prChangeRenamed' };
      const authorLink = (login) => h('a', { className: 'dshaSv_link', href: 'https://github.com/' + login, target: '_blank', rel: 'noopener noreferrer' }, '@' + login);
      const row = (key, head, time, body) => h('div', { key, className: 'dshaSv_listRow' },
        h('div', { className: 'dshaSv_listMain' },
          h('div', { className: 'dshaSv_bar' }, head, h('span', { className: 'dshaSv_grow' }), time ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: time }, kit.formatTime(Date.parse(time))) : null),
          body ? h(Clamp, { kit, text: body }) : null));
      const diffBar = h('div', { className: 'dshaSv_bar' },
        h('p', { className: 'dshaSv_h dshaSv_grow' }, t('prDiffTitle') + ' · ' + kit.format(t('prDiffFiles'), { n: Number(detail.changedFiles) || files.length })),
        h('span', { className: 'dshaSv_diffAdd' }, '+' + (Number(detail.additions) || 0)),
        h('span', { className: 'dshaSv_diffDel' }, '−' + (Number(detail.deletions) || 0)),
        detail.url ? h('a', { className: 'dshaSv_link', href: detail.url, target: '_blank', rel: 'noopener noreferrer' }, t('prOpenPr')) : null);
      return h('div', { className: 'dshaSv_box' },
        detail.body ? h(Clamp, { kit, text: detail.body }) : null,
        diffBar,
        files.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('prDiffEmpty'))
          : h('div', { className: 'dshaSv_list' }, ...shownFiles.map((file) => h('div', { key: file.path, className: 'dshaSv_listRow' },
            h('div', { className: 'dshaSv_listMain' },
              h('div', { className: 'dshaSv_bar' },
                h('span', { className: 'dshaSv_filePath dshaSv_grow', title: file.path }, file.path),
                changeLabel[file.changeType] ? h('span', { className: 'dshaSv_pill' }, t(changeLabel[file.changeType])) : null,
                h('span', { className: 'dshaSv_diffAdd' }, '+' + (Number(file.additions) || 0)),
                h('span', { className: 'dshaSv_diffDel' }, '−' + (Number(file.deletions) || 0))))))),
        files.length > shownFiles.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('prDiffMore'), { n: files.length - shownFiles.length })) : null,
        h('p', { className: 'dshaSv_h' }, t('prReviewsTitle') + ' · ' + detail.reviews.length),
        detail.reviews.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('prNoReviews'))
          : detail.reviews.map((review, index) => row('r' + index, h('span', { className: 'dshaSv_grow' }, authorLink(review.login), reviewPill(review.state)), review.submittedAt, review.body)),
        h('p', { className: 'dshaSv_h' }, t('prCommentsTitle') + ' · ' + detail.comments.length),
        detail.comments.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('prNoComments'))
          : detail.comments.map((comment, index) => row('c' + index, h('span', { className: 'dshaSv_grow' }, authorLink(comment.login)), comment.createdAt, comment.body)),
        h('button', { type: 'button', className: 'dshaSv_link', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh')));
    }


    /** PR 页：远端 PR 列表、审批 / 评论 / 关闭（只由用户点击）。 */
    function PrTab({ kit, board, act, busy, sessionId, onBack, focus, onFocusConsumed, onOpenWorkItem }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'pr-list', session: sessionId });
      const [filter, setFilter] = React.useState('all');
      const [openNo, setOpenNo] = React.useState(undefined);
      const [comment, setComment] = React.useState('');
      const [pending, setPending] = React.useState(undefined);
      const [running, setRunning] = React.useState(undefined);
      const [prState, setPrState] = React.useState('open');
      const [detailNo, setDetailNo] = React.useState(() => {
        if (focus === undefined || focus === null || focus.kind !== 'pr') return undefined;
        const number = Number(focus.id);
        return Number.isSafeInteger(number) && number > 0 ? number : undefined;
      });
      const [linkTask, setLinkTask] = React.useState('');
      const [detailVersion, setDetailVersion] = React.useState(0);
      const [aiRunning, setAiRunning] = React.useState(undefined);
      const view = data?.prs;
      const prs = Array.isArray(view?.items) ? view.items : [];
      const linked = new Map(collectPrs(board.taskBoard).map((row) => [Number(row.number), row]));
      const baseQuery = { view: 'pr-list', session: sessionId, ...(prState === 'closed' ? { state: 'closed' } : {}) };
      const switchState = (next) => {
        if (next === prState) return;
        setPrState(next); setOpenNo(undefined); setDetailNo(undefined); setPending(undefined); setComment(''); setLinkTask('');
        reload(true, { view: 'pr-list', session: sessionId, ...(next === 'closed' ? { state: 'closed' } : {}) });
      };
      const matched = prs.filter((item) => filter === 'all' || prState === 'closed'
        ? true
        : filter === 'draft' ? item.draft
          : filter === 'approved' ? item.reviewDecision === 'APPROVED'
            : filter === 'changes' ? item.reviewDecision === 'CHANGES_REQUESTED'
              : filter === 'review' ? (!item.draft && item.reviewDecision !== 'APPROVED' && item.reviewDecision !== 'CHANGES_REQUESTED')
                : true);
      const filterCount = (key) => key === 'all' ? prs.length
        : key === 'draft' ? prs.filter((item) => item.draft).length
          : key === 'approved' ? prs.filter((item) => item.reviewDecision === 'APPROVED').length
            : key === 'changes' ? prs.filter((item) => item.reviewDecision === 'CHANGES_REQUESTED').length
              : prs.filter((item) => !item.draft && item.reviewDecision !== 'APPROVED' && item.reviewDecision !== 'CHANGES_REQUESTED').length;
      const run = (key, body) => {
        setRunning(key);
        act(body).then((payload) => {
          setRunning(undefined);
          if (payload !== undefined) {
            // 写动作（审批 / 评论 / 关闭重开 / 关联任务）后 PR 详情会变；hover 预取可能在动作前就写了旧数据，
            // 所以整份工作项详情缓存都清掉，让重新挂载的 PrDetail 一定重新请求（不靠 detailNo 是否还在）。
            workItemCacheClear();
            setPending(undefined); setComment(''); setLinkTask(''); setOpenNo(undefined); setDetailVersion((value) => value + 1); reload(true, baseQuery);
          }
        }, () => setRunning(undefined));
      };
      React.useEffect(() => {
        if (focus === undefined || focus === null || focus.kind !== 'pr') return;
        const number = Number(focus.id);
        if (Number.isSafeInteger(number) && number > 0) setDetailNo(number);
        // PR 列表还没到就留着 focus；到了（或失败）但筛选里没有这个号才放弃
        if (view !== undefined || error !== undefined) {
          if (typeof onFocusConsumed === 'function') onFocusConsumed();
        }
      }, [focus?.seq, focus?.id, focus?.kind, view !== undefined, prs.length]);
      const prefetched = React.useRef(new Set());
      const prefetchDetail = (number) => {
        const n = Number(number);
        if (prefetched.current.has(n)) return;
        prefetched.current.add(n);
        // 预取只填 workItemCache；详情真正打开时直接复用，不再发第二次
        prefetchWorkItemDetail(kit, { view: 'pr-detail', session: sessionId, number: n });
      };
      const launchAi = (item) => {
        setAiRunning(item.number);
        act({ action: 'pr-ai-review', number: item.number }).then((payload) => {
          setAiRunning(undefined);
          const created = payload?.result?.sessionId;
          if (typeof created === 'string' && created !== '') kit.openSession(created);
        }, () => setAiRunning(undefined));
      };
      const reviewPill = (item) => {
        const label = PR_DECISION_LABEL[item.reviewDecision];
        if (label === undefined) return null;
        const tone = item.reviewDecision === 'APPROVED' ? 'ok' : item.reviewDecision === 'CHANGES_REQUESTED' ? 'error' : 'warn';
        return h('span', { className: 'dshaSv_pill', 'data-tone': tone }, t(label));
      };
      const decisionPill = (item) => {
        if (item.merged === true) return h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('prMerged'));
        // 已关闭列表里「关了但没合并」的 PR 要明确标「已关闭」，不能和打开列表长得一样
        if (prState === 'closed') return h('span', { className: 'dshaSv_pill' }, t('prStateClosed'));
        if (item.draft) return h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, t('prDraft'));
        return reviewPill(item);
      };
      const prStatus = (item) => {
        if (item.merged === true) return { text: t('prMerged'), tone: 'ok' };
        if (prState === 'closed') return { text: t('prStateClosed') };
        if (item.draft) return { text: t('prDraft'), tone: 'warn' };
        const label = PR_DECISION_LABEL[item.reviewDecision];
        if (label === undefined) return undefined;
        return { text: t(label), tone: item.reviewDecision === 'APPROVED' ? 'ok' : item.reviewDecision === 'CHANGES_REQUESTED' ? 'error' : 'warn' };
      };
      const prWorkItem = (item) => ({
        kind: 'pr', id: '#' + item.number, title: item.title,
        status: prStatus(item),
        owner: item.author ? '@' + item.author : undefined,
        branch: item.head && item.base ? item.head + ' → ' + item.base : undefined,
        link: item.url ? { text: '#' + item.number, url: item.url } : undefined,
        source: item
      });
      const confirmRow = (item) => {
        if (pending === undefined || pending.number !== item.number) return null;
        const text = pending.kind === 'close' ? kit.format(t('prConfirmClose'), { n: item.number })
          : pending.kind === 'reopen' ? kit.format(t('prConfirmReopen'), { n: item.number })
            : kit.format(t('prConfirmApprove'), { n: item.number });
        const key = pending.kind;
        const body = pending.kind === 'close' ? { action: 'pr-state', number: item.number, state: 'close' }
          : pending.kind === 'reopen' ? { action: 'pr-state', number: item.number, state: 'reopen' }
            : { action: 'pr-review', number: item.number, verdict: 'approve', ...(comment.trim() === '' ? {} : { body: comment }) };
        return h('div', { className: 'dshaSv_listRow' },
          h('span', { className: 'dshaSv_grow' }, text),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || running !== undefined, onClick: () => run(key, body) }, t('prConfirm')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || running !== undefined, onClick: () => setPending(undefined) }, t('cancel')));
      };
      const actions = (item) => {
        const key = 'pr:' + item.number;
        const working = running !== undefined;
        const area = h('textarea', {
          className: 'dshaSv_input', rows: 2, maxLength: 4000, value: openNo === item.number ? comment : '', placeholder: t('prCommentPh'), 'aria-label': t('prCommentPh'),
          onChange: (event) => { setOpenNo(item.number); setComment(event.target.value); }
        });
        const linkRow = h('div', { className: 'dshaSv_row', style: { flex: '1 1 100%' } },
          h('input', {
            className: 'dshaSv_input', style: { flex: '1 1 10em' }, value: linkTask, maxLength: 40,
            placeholder: t('sidePrTask'), 'aria-label': t('sidePrTask'),
            onChange: (event) => setLinkTask(event.target.value)
          }),
          h('button', {
            type: 'button', className: 'dshaSv_btn',
            disabled: busy || working || linkTask.trim() === '',
            onClick: () => run(key + ':task', { action: 'task-pr', task: linkTask.trim().toUpperCase(), pr: String(item.number) })
          }, t('prLinkTask')));
        if (prState === 'closed') {
          return h('div', { className: 'dshaSv_listActions' }, area,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':comment', { action: 'pr-comment', number: item.number, body: comment }) }, t('prComment')),
            item.merged === true ? null : h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'reopen' }) }, t('prReopen')), linkRow);
        }
        return h('div', { className: 'dshaSv_listActions' }, area,
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'approve' }) }, t('prApprove')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':changes', { action: 'pr-review', number: item.number, verdict: 'request-changes', body: comment }) }, t('prRequestChanges')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':comment', { action: 'pr-comment', number: item.number, body: comment }) }, t('prComment')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'close' }) }, t('prClose')), linkRow);
      };
      const detailItem = detailNo === undefined ? undefined : prs.find((item) => Number(item.number) === Number(detailNo));
      const detailNode = detailItem === undefined ? null : h(WorkItemDetail, {
        key: 'pr:' + detailItem.number,
        kit,
        item: prWorkItem(detailItem),
        fields: [
          [t('workItemAuthor'), detailItem.author ? '@' + detailItem.author : '—'],
          [t('workItemBranch'), detailItem.head && detailItem.base ? detailItem.head + ' → ' + detailItem.base : '—'],
          [t('workItemUpdated'), detailItem.updatedAt ? kit.formatTime(Date.parse(detailItem.updatedAt)) : '—'],
          [t('workItemComments'), String(Number(detailItem.comments) || 0)],
          [t('workItemChanges'), '+' + (Number(detailItem.additions) || 0) + ' −' + (Number(detailItem.deletions) || 0) + (Number(detailItem.changedFiles) > 0 ? ' · ' + kit.format(t('prDiffFiles'), { n: Number(detailItem.changedFiles) }) : '')],
          [t('workItemLinkedTask'), linked.has(detailItem.number)
            ? (onOpenWorkItem === undefined
              ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, linked.get(detailItem.number).id)
              : h('button', { type: 'button', className: 'dshaSv_pill', 'data-mono': true, onClick: () => onOpenWorkItem({ kind: 'task', id: linked.get(detailItem.number).id }) }, linked.get(detailItem.number).id))
            : h('span', { className: 'dshaSv_muted' }, '—')]
        ],
        body: () => h(PrDetail, { key: 'detail:' + detailVersion + ':' + detailItem.number, kit, sessionId, number: detailItem.number }),
        actions: () => h(React.Fragment, null,
          confirmRow(detailItem),
          actions(detailItem),
          h('button', {
            type: 'button', className: 'dshaSv_link', title: t('prAiReviewHint'),
            disabled: busy || running !== undefined || aiRunning !== undefined,
            onClick: () => launchAi(detailItem)
          }, aiRunning === detailItem.number ? t('prAiReviewRunning') : t('prAiReview'))),
        onClose: () => setDetailNo(undefined)
      });
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h(BackMore, { kit, onBack }),
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabPr')),
            loading && view !== undefined ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand', role: 'status' }, t('reloading')) : null,
            view?.repo ? h('span', { className: 'dshaSv_pill dshaSv_repoPill', 'data-mono': true, title: view.repo }, view.repo) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true, baseQuery) }, t('tasksRefresh'))),
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          view?.error ? h('p', { className: 'dshaSv_muted' }, view.error) : null,
          view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
          view === undefined && !loading && error === undefined ? h('div', { className: 'dshaSv_quote' }, t('prUnavailable')) : null,
          view !== undefined ? h('div', { className: 'dshaSv_chips' },
            h('button', { type: 'button', className: 'dshaSv_chipF', 'aria-pressed': prState === 'open' ? 'true' : undefined, onClick: () => switchState('open') }, t('prStateOpen')),
            h('button', { type: 'button', className: 'dshaSv_chipF', 'aria-pressed': prState === 'closed' ? 'true' : undefined, onClick: () => switchState('closed') }, t('prStateClosed')),
            prState === 'open' ? h('span', { className: 'dshaSv_chipDivider', 'aria-hidden': 'true' }) : null,
            prState === 'open' ? ['all', 'review', 'changes', 'approved', 'draft']
              .filter((key) => key === 'all' || key === filter || filterCount(key) > 0)
              .map((key) => h('button', {
                key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key ? 'true' : undefined, onClick: () => setFilter(key)
              }, t('prFilter' + key[0].toUpperCase() + key.slice(1)), h('span', { className: 'dshaSv_muted' }, String(filterCount(key))))) : null) : null,
          matched.length > 0 ? h('div', { className: 'dshaSv_list' }, ...matched.map((item) => h('div', {
            key: item.number, className: 'dshaSv_listRow dshaSv_workRow',
            // 行空白 / 非交互区可点开详情；a / button / 表单控件按 closest 排除，交给控件自己处理
            onClick: (event) => {
              const target = event === undefined || event === null ? undefined : event.target;
              if (target !== undefined && target !== null) {
                if (typeof target.closest !== 'function') return;
                if (target.closest('a,button,input,textarea,select,label') !== null) return;
              }
              setDetailNo(detailNo === item.number ? undefined : item.number);
              setOpenNo(undefined);
              setPending(undefined);
              setLinkTask('');
            }
          },
            h('div', { className: 'dshaSv_listMain' },
              h('div', { className: 'dshaSv_bar' },
                h('a', { className: 'dshaSv_ticketNo', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen'), onClick: (event) => event?.stopPropagation?.() }, '#' + item.number),
                h('a', { className: 'dshaSv_grow dshaSv_titleLink', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.title, onClick: (event) => event?.stopPropagation?.() }, item.title),
                decisionPill(item),
                prState === 'closed' ? reviewPill(item) : null,
                linked.has(item.number)
                  ? (onOpenWorkItem === undefined
                    ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, linked.get(item.number).id)
                    : h('button', {
                      type: 'button', className: 'dshaSv_pill', 'data-mono': true, title: t('workItemLinkedTask'),
                      onClick: () => onOpenWorkItem({ kind: 'task', id: linked.get(item.number).id })
                    }, linked.get(item.number).id))
                  : null,
                h('button', {
                  type: 'button', className: 'dshaSv_link', title: t('prAiReviewHint'),
                  disabled: busy || running !== undefined || aiRunning !== undefined,
                  onClick: () => launchAi(item)
                }, aiRunning === item.number ? t('prAiReviewRunning') : t('prAiReview')),
                h('button', {
                  type: 'button', className: 'dshaSv_link',
                  'aria-expanded': detailNo === item.number ? 'true' : undefined,
                  onPointerEnter: () => prefetchDetail(item.number),
                  onFocus: () => prefetchDetail(item.number),
                  onClick: () => setDetailNo(detailNo === item.number ? undefined : item.number)
                }, detailNo === item.number ? t('cancel') : t('prOpenDetail'))),
              h('p', { className: 'dshaSv_muted' }, ['@' + item.author, item.head && item.base ? item.head + ' → ' + item.base : '', item.updatedAt ? kit.formatTime(Date.parse(item.updatedAt)) : '', item.comments > 0 ? kit.format(t('prCommentCount'), { n: item.comments }) : '', (Number(item.additions) || 0) + (Number(item.deletions) || 0) > 0 ? '+' + (Number(item.additions) || 0) + ' −' + (Number(item.deletions) || 0) : '', Number(item.changedFiles) > 0 ? kit.format(t('prDiffFiles'), { n: Number(item.changedFiles) }) : ''].filter(Boolean).join(' · ')),
              detailNo === item.number ? null : confirmRow(item),
              detailNo !== item.number && (openNo === item.number || pending?.number === item.number) ? actions(item) : null),
            detailNo === item.number ? null : h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': openNo === item.number ? 'true' : undefined, onClick: () => { setOpenNo(openNo === item.number ? undefined : item.number); setPending(undefined); setLinkTask(''); } }, openNo === item.number ? t('cancel') : t('prHandle'))))) : null,
          view !== undefined && !view.error && matched.length === 0 ? h('div', { className: 'dshaSv_quote' }, prState === 'closed' ? t('prClosedEmpty') : filter !== 'all' ? t('prNoMatch') : t('prEmpty')) : null),
        detailNode);
    }

    /** 问题页：远端 issue 列表（只读，与地图分开）；支持搜索、指派给我与标签筛选。 */

      return { PrTab, PrDetail, Clamp };
    }

    return { KIT_VERSION: 42, make };
  }
});
