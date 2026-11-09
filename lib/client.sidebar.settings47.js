window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.settings47.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar47.js 按需 require.async 加载；共用件与图标经
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


    const SCOPE_IMPLIED = {
      repo: ['repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events'],
      'admin:org': ['write:org', 'read:org'],
      'admin:repo_hook': ['write:repo_hook', 'read:repo_hook'],
      'admin:public_key': ['write:public_key', 'read:public_key'],
      'admin:gpg_key': ['write:gpg_key', 'read:gpg_key'],
      user: ['read:user', 'user:email', 'user:follow'],
      project: ['read:project'],
      'write:packages': ['read:packages']
    };
    function expandScopes(granted) {
      const have = new Set(Array.isArray(granted) ? granted : []);
      for (const scope of [...have]) for (const child of SCOPE_IMPLIED[scope] ?? []) have.add(child);
      return have;
    }

    /** scope 的短中文标签：dictionary 里是 scope_<scope 下划线化>；未知 scope 原样显示。 */
    const scopeLabel = (t, scope) => {
      const key = 'scope_' + String(scope).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const label = t(key);
      return label === key ? String(scope) : label;
    };

    /**
     * GitHub 登录卡：点顶栏账号胶囊就地展开。宿主没有「打开设置页」的公开 API，
     * 所以把登录/补权限/锁定做成侧栏内的一张卡；权限分三档，用胶囊选，动作和设置页走同一套路由。
     */
    function GitHubCard({ kit, github, busy, act, onClose }) {
      const { t } = kit;
      const [tier, setTier] = usePersisted('ghTier', 'repo');
      const [resetAsk, setResetAsk] = React.useState(false);
      // 「重新读取」的本地中间态：请求在飞时按钮不能再点，也不能显示成没反应
      const [refreshing, setRefreshing] = React.useState(false);
      const gh = github ?? {};
      const flow = gh.loginFlow;
      const pending = flow !== null && flow !== undefined && flow.state === 'pending';
      const bad = gh.match === 'mismatch' || (gh.match === 'missing' && gh.pinned !== null);
      // 还没读到任何身份：显示「正在读取」而不是「未知 / 读取失败」
      const loading = gh.state === null || gh.state === undefined;
      const reading = gh.reading === true || refreshing;
      const refresh = () => {
        if (typeof act !== 'function' || refreshing) return;
        setRefreshing(true);
        try {
          Promise.resolve(act({ action: 'github-refresh' })).then(() => {}, () => {}).finally(() => { setRefreshing(false); });
        } catch { setRefreshing(false); }
      };
      const TIERS = [
        ['basic', 'ghTierBasic', 'ghTierHintBasic'],
        ['repo', 'ghTierRepo', 'ghTierHintRepo'],
        ['all', 'ghTierAll', 'ghTierHintAll']
      ];
      const TIER_RULE = TIERS.find(([key]) => key === tier) ?? TIERS[1];
      // 状态压成胶囊：账号 / 锁定 / 登录流程 / 来源，长解释放悬停
      const account = gh.state === 'ready'
        ? { text: '@' + gh.login, tone: bad ? 'warn' : 'ok', title: kit.format(t('ghReady'), { login: gh.login, id: gh.accountId }) }
        : gh.state === 'missing' ? { text: t('ghStateMissing'), tone: 'warn', title: t('ghMissing') }
        : gh.state === 'unavailable' ? { text: t('ghStateUnavailable'), tone: 'error', title: t('ghUnavailable') }
        : gh.state === 'error' ? { text: t('ghStateError'), tone: 'error', title: kit.format(t('ghError'), { v: gh.error ?? '' }) }
        : { text: t('ghStateReading'), tone: 'brand', title: t('ghReadingHint') };
      const pin = gh.state !== 'ready' ? null
        : gh.match === 'ok' ? { text: t('ghPinPinned'), tone: 'ok', title: kit.format(t('ghPinnedOk'), { login: gh.login }) }
        : gh.match === 'mismatch' ? { text: t('ghPinMismatch'), tone: 'error', title: kit.format(t('ghPinnedBad'), { login: gh.login, pinned: gh.pinned?.login ?? '' }) }
        : gh.match === 'missing' && gh.pinned !== null ? { text: t('ghPinGone'), tone: 'error', title: kit.format(t('ghPinnedGone'), { pinned: gh.pinned?.login ?? '' }) }
        : { text: t('ghPinUnpinned'), tone: undefined, title: t('ghUnpinnedNote') };
      const flowPill = pending ? { text: t('ghStateLoggingIn'), tone: 'brand' }
        : flow?.state === 'expired' ? { text: t('ghFlowExpiredPill'), tone: 'warn', title: t('ghFlowExpired') }
        : flow?.state === 'failed' ? { text: t('ghFlowFailedPill'), tone: 'error', title: kit.format(t('ghFlowFailed'), { v: flow.error ?? '' }) }
        : flow?.state === 'done' ? { text: t('ghFlowDone'), tone: 'ok' }
        : null;
      const have = expandScopes(gh.scopes)
      const covered = (key) => {
        const list = gh.tiers?.[key]
        return gh.state === 'ready' && Array.isArray(list) && list.length > 0 && list.every((scope) => have.has(scope))
      }
      const grantedAll = covered(TIER_RULE[0])
      const go = () => act({ action: gh.state === 'ready' ? 'github-relogin' : 'github-login', tier })
      return h('section', { className: 'dshaSv_sec dshaSv_ghCard', 'aria-label': t('ghTitle') },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('ghTitle')),
          h('button', { type: 'button', className: 'dshaSv_icon', 'aria-label': t('cancel'), title: t('cancel'), onClick: onClose }, '×')),
        h('div', { className: 'dshaSv_ghStatus' },
          h('span', { className: 'dshaSv_pill', 'data-tone': account.tone, 'data-mono': gh.state === 'ready' ? true : undefined, title: account.title }, account.text),
          reading && !loading ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand', role: 'status', title: t('ghReadingHint') }, t('ghStateReading')) : null,
          pin ? h('span', { className: 'dshaSv_pill', 'data-tone': pin.tone, title: pin.title }, pin.text) : null,
          flowPill ? h('span', { className: 'dshaSv_pill', 'data-tone': flowPill.tone, title: flowPill.title }, flowPill.text) : null,
          gh.state === 'ready' && gh.accountId !== null && gh.accountId !== undefined ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: t('ghTitle') + ' id' }, 'id ' + gh.accountId) : null,
          gh.state === 'ready' && (gh.source === 'shell' || gh.source === 'gh') ? h('span', { className: 'dshaSv_pill', title: t(gh.source === 'shell' ? 'ghSourceShell' : 'ghSourceGh') }, t(gh.source === 'shell' ? 'ghSourceShortShell' : 'ghSourceShortGh')) : null),
        gh.state === 'ready' && Array.isArray(gh.scopes) && gh.scopes.length > 0
          ? h('div', { className: 'dshaSv_scopes', 'aria-label': t('ghScopesLabel') },
            ...gh.scopes.map((scope) => h('span', { key: scope, className: 'dshaSv_scope', title: scope }, scopeLabel(t, scope))))
          : null,
        // 中间态：读取中 / 失败原因 + 自动重试 / 上次成功；不再只有一颗红色胶囊
        reading ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('ghReadingHint')) : null,
        !reading && gh.state === 'error'
          ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'status' },
            kit.format(t('ghError'), { v: gh.error ?? '' }),
            gh.retryAt ? h('span', { className: 'dshaSv_muted' }, ' · ' + t('ghRetryAuto')) : null)
          : null,
        gh.state !== 'ready' && gh.lastReady
          ? h('p', { className: 'dshaSv_muted' }, kit.format(t('ghLastGood'), { login: gh.lastReady.login, time: kit.formatTime(gh.lastReady.at) }))
          : null,
        !reading && gh.state === 'ready' && gh.checkedAt
          ? h('p', { className: 'dshaSv_muted' }, kit.format(t('ghUpdated'), { time: kit.formatTime(gh.checkedAt) }))
          : null,
        h('div', { className: 'dshaSv_ghTier' },
          h('p', { className: 'dshaSv_h' }, t('ghTier')),
          h('div', { className: 'dshaSv_filters', role: 'group', 'aria-label': t('ghTier') },
            ...TIERS.map(([key, labelKey, hintKey]) => h('button', {
              key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': tier === key, title: t(hintKey),
              onClick: () => setTier(key)
            }, t(labelKey) + (covered(key) ? ' ✓' : '')))),
          h('p', { className: 'dshaSv_muted' }, t(TIER_RULE[2]))),
        pending
          ? h('div', { className: 'dshaSv_ghFlow' },
            h('p', { className: 'dshaSv_muted' }, t('ghCode')),
            flow.userCode ? h('div', { className: 'dshaSv_row dshaSv_grow' },
              h('code', { className: 'dshaSv_code dshaSv_grow' }, flow.userCode),
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => { void kit.copyText(flow.userCode) } }, h(IconCopy), t('ghCopyCode'))) : null,
            flow.verificationUri ? h('p', { className: 'dshaSv_muted' }, h('a', { className: 'dshaSv_a', href: flow.verificationUri, target: '_blank', rel: 'noopener noreferrer', title: flow.verificationUri }, t('ghCodeOpen') + flow.verificationUri)) : null,
            h('p', { className: 'dshaSv_muted' }, t('ghCodeOpened'))) : null,
        h('div', { className: 'dshaSv_taskActs' },
          loading
            ? h('span', { className: 'dshaSv_btn', 'data-primary': true, 'aria-disabled': true, role: 'status' }, t('ghRefreshBusy'))
            : gh.state === 'ready' && grantedAll
              ? h('span', { className: 'dshaSv_btn', 'data-primary': true, 'aria-disabled': true, role: 'status', title: t('ghTierCoveredHint') }, '✓ ' + kit.format(t('ghTierCovered'), { tier: t(TIER_RULE[1]) }))
              : h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || pending, onClick: go },
                gh.state === 'ready' ? kit.format(t('ghTierUpgrade'), { tier: t(TIER_RULE[1]) }) : t('ghLogin')),
          gh.state === 'ready'
            ? (gh.match === 'ok'
              ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'github-unpin' }, t('ghUnpinDone')) }, t('ghUnpin'))
              : h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'github-pin' }, t('ghPinDone')) }, t(gh.match === 'mismatch' ? 'ghRepin' : 'ghPin')))
            : null,
          pending ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'github-login-cancel' }, t('ghCancelled')) }, t('ghCancel')) : null,
          gh.state === 'ready' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || pending, 'aria-expanded': resetAsk, onClick: () => setResetAsk(!resetAsk) }, t('ghResetLogin')) : null,
          h('span', { className: 'dshaSv_grow' }),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || reading, onClick: refresh }, reading ? t('ghRefreshBusy') : t('ghRefresh'))),
        h('p', { className: 'dshaSv_muted' }, t('ghTierNote')),
        flow?.state === 'done' && Array.isArray(flow.missing) && flow.missing.length > 0
          ? h('div', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' },
            h('p', null, kit.format(t('ghGrantedMissing'), { n: flow.missingTotal ?? flow.missing.length, list: flow.missing.map((scope) => scopeLabel(t, scope)).join('、') })),
            h('p', { className: 'dshaSv_muted' }, t('ghGrantedMissingHint'))) : null,
        flow?.state === 'failed' ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'status' }, kit.format(t('ghFlowFailed'), { v: flow.error ?? '' })) : null,
        resetAsk ? h('div', { className: 'dshaSv_ghFlow' },
          h('p', { className: 'dshaSv_muted' }, t('ghResetAsk')),
          h('div', { className: 'dshaSv_row' },
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || pending, onClick: () => { setResetAsk(false); void act({ action: 'github-reset-login', tier }) } }, t('ghResetConfirm')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setResetAsk(false) }, t('cancel')))) : null);
    }


    const RW_DEFER = { busy: 'rwDeferBusy', rate: 'rwDeferRate', activeHours: 'rwDeferHours', session: 'rwDeferSession' };
    /** 设置页「核验」清单的状态胶囊：[文案 key, 色调]；服务端实际有 active / done / failed / timeout / cancelled 五态。 */
    const VERIFY_STATE = {
      active: ['verifyStateActive', 'brand'],
      done: ['verifyStateDone', 'ok'],
      failed: ['verifyStateFailed', 'error'],
      timeout: ['verifyStateTimeout', 'warn'],
      cancelled: ['verifyStateCancelled', undefined]
    };
    const listOf = (value) => String(value ?? '').split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);

    function watchStateOf(t, watch) {
      return watch.enabled ? (watch.observe ? t('rwStateObserve') : t('rwStateOn')) : t('rwStateOff');
    }

    function watchToneOf(watch) {
      return watch.lastError ? 'error' : !watch.enabled ? undefined : watch.deferReason === 'rate' ? 'warn' : 'ok';
    }

    function WatchBacklogPill({ kit, watch }) {
      const { t } = kit;
      if (!watch.backlog || Number(watch.backlogHours) === 0) return null;
      return h('span', { className: 'dshaSv_pill', 'data-tone': watch.backlog.pending ? 'warn' : 'ok' },
        watch.backlog.pending ? kit.format(t('rwBacklogPending'), { n: watch.backlog.hours }) : t('rwBacklogDone'));
    }

    /** 总览：每条守候的状态、间隔、上次唤醒 / 批次与快捷动作。 */
    function WatchCard({ kit, watch, act, busy }) {
      const { t } = kit;
      const batch = Array.isArray(watch.lastBatch?.items) ? watch.lastBatch.items : [];
      const numbers = batch.map((item) => item.number);
      return h('div', { className: 'dshaSv_box' },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_pill', 'data-mono': true, title: watch.id }, watch.repo),
          h('span', { className: 'dshaSv_pill', 'data-tone': watchToneOf(watch) }, watchStateOf(t, watch)),
          h('span', { className: 'dshaSv_grow' }),
          h(WatchBacklogPill, { kit, watch })),
        watch.sessionLabel ? h('p', { className: 'dshaSv_muted' }, watch.sessionLabel) : null,
        h('p', { className: 'dshaSv_muted' }, [
          kit.format(t('rwInterval'), { n: watch.intervalSec }),
          watch.goal ? t('rwGoal') + watch.goal : null,
          watch.activeHours ? t('rwHours') + watch.activeHours : null
        ].filter(Boolean).join(' · ')),
        h('p', { className: 'dshaSv_muted' }, watch.lastWake ? kit.format(t('rwLastWake'), { time: kit.formatTime(watch.lastWake) }) : t('rwNeverWake')),
        batch.length > 0 ? h('div', { className: 'dshaSv_snapItem' },
          h('span', { className: 'dshaSv_muted' }, t('rwLastBatch')),
          ...batch.slice(0, 3).map((item) => h('span', { key: item.number, className: 'dshaSv_metaChip', title: '#' + item.number + ' ' + item.title }, '#' + item.number + ' ' + item.title)),
          batch.length > 3 ? h('span', { className: 'dshaSv_pill' }, '+' + (batch.length - 3)) : null) : null,
        watch.lastError ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, kit.format(t('rwError'), { v: watch.lastError })) : null,
        watch.deferReason ? h('p', { className: 'dshaSv_muted', role: 'status' }, t(RW_DEFER[watch.deferReason] ?? 'rwDeferOther')) : null,
        h('div', { className: 'dshaSv_taskActs' },
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-check', id: watch.id }) }, t('rwCheck')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-toggle', id: watch.id, enabled: !watch.enabled }) }, watch.enabled ? t('rwPause') : t('rwResume')),
          numbers.length > 0 ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-ack', id: watch.id, numbers }) }, t('rwAckGithub')) : null));
    }

    /** 判定：为什么叫醒 / 没叫醒、过滤与退避。 */
    function WatchJudge({ kit, watch }) {
      const { t } = kit;
      const history = Array.isArray(watch.history) ? watch.history.slice(-5).reverse() : [];
      const filtered = Array.isArray(watch.filteredLog) ? watch.filteredLog.slice(-4).reverse() : [];
      const reason = (row) => row.reason === 'wake' ? t('rwJudgeWake') : row.reason === 'observe' ? t('rwJudgeObserve') : t('rwJudgePoll');
      return h('div', { className: 'dshaSv_box' },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_pill', 'data-mono': true }, watch.repo),
          h('span', { className: 'dshaSv_pill', 'data-tone': watchToneOf(watch) }, watchStateOf(t, watch)),
          h('span', { className: 'dshaSv_grow' })),
        h('p', { className: 'dshaSv_muted' }, kit.format(t('rwJudgeRate'), { n: watch.wakeCountLastHour ?? 0, max: watch.maxWakesPerHour })),
        watch.deferReason ? h('p', { className: 'dshaSv_muted' }, t(RW_DEFER[watch.deferReason] ?? 'rwDeferOther') + (watch.lastDeferred?.at ? ' · ' + kit.formatTime(watch.lastDeferred.at) : '')) : null,
        watch.consecutiveFailures > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('rwJudgeBackoff'), { n: watch.consecutiveFailures })) : null,
        h('p', { className: 'dshaSv_muted' }, t('rwJudgeHistory')),
        history.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('rwNoHistory'))
          : h('div', { className: 'dshaSv_list' }, ...history.map((row, index) => {
            const line = [reason(row), Array.isArray(row.numbers) && row.numbers.length > 0 ? row.numbers.map((number) => '#' + number).join(' ') : '', row.error ?? '', row.at ? kit.formatTime(row.at) : ''].filter(Boolean).join(' · ');
            return h('p', { key: index, className: 'dshaSv_muted dshaSv_watchLine', title: line }, line);
          })),
        filtered.length > 0 ? (() => {
          const line = t('rwFiltered') + filtered.map((item) => '#' + item.number + ' ' + item.reason).join('；');
          return h('p', { className: 'dshaSv_muted dshaSv_watchLine', title: line }, line);
        })() : null);
    }

    /** 触发：快捷动作 + 登记表单。 */
    function WatchTrigger({ kit, watch, act, busy }) {
      const { t } = kit;
      const numbers = (Array.isArray(watch.lastBatch?.items) ? watch.lastBatch.items : []).map((item) => item.number);
      return h('div', { className: 'dshaSv_box' },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_pill', 'data-mono': true, title: watch.id }, watch.repo),
          h('span', { className: 'dshaSv_grow' }),
          h('span', { className: 'dshaSv_pill', 'data-tone': watchToneOf(watch) }, watchStateOf(t, watch))),
        h('div', { className: 'dshaSv_taskActs' },
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-check', id: watch.id }) }, t('rwCheck')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-toggle', id: watch.id, enabled: !watch.enabled }) }, watch.enabled ? t('rwPause') : t('rwResume')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-update', id: watch.id, observe: !watch.observe }) }, t('rwObserve')),
          numbers.length > 0 ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-ack', id: watch.id, numbers }) }, t('rwAckLocal')) : null,
          numbers.length > 0 ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-watch-ack', id: watch.id, numbers }) }, t('rwAckGithub')) : null));
    }

    /** 登记新守候。 */
    function WatchStart({ kit, act, busy }) {
      const { t } = kit;
      const [repo, setRepo] = React.useState('');
      const [goal, setGoal] = React.useState('');
      const [interval, setInterval] = React.useState('120');
      const [hours, setHours] = React.useState('');
      const [backlog, setBacklog] = React.useState('0');
      const [observe, setObserve] = React.useState(false);
      const [advanced, setAdvanced] = React.useState(false);
      const [labels, setLabels] = React.useState('');
      const [ignore, setIgnore] = React.useState('');
      const [authors, setAuthors] = React.useState('');
      const [assignee, setAssignee] = React.useState('');
      const [onlyAssigned, setOnlyAssigned] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      const submit = (event) => {
        event?.preventDefault?.();
        if (repo.trim() === '' || busy) return;
        setNote(undefined);
        act({
          action: 'repo-watch-start', repo: repo.trim(), goal: goal.trim() || undefined,
          intervalSec: Number(interval) || undefined, activeHours: hours.trim() || undefined,
          backlogHours: Number(backlog) || 0, observe,
          ...(advanced ? {
            labels: listOf(labels), ignoreLabels: listOf(ignore), allowAuthors: listOf(authors),
            assignee: assignee.trim() || undefined, onlyAssigned
          } : {})
        }).then((payload) => { if (payload !== undefined) { setRepo(''); setGoal(''); setNote({ pulse: Date.now() }); } }, () => {});
      };
      return h('form', { className: 'dshaSv_splitForm', onSubmit: submit },
        h('p', { className: 'dshaSv_h' }, t('rwStartTitle')),
        h('label', { className: 'dshaSv_muted' }, t('rwRepo')),
        h('input', { className: 'dshaSv_input', value: repo, maxLength: 300, placeholder: t('rwRepoPh'), 'aria-label': t('rwRepo'), onChange: (event) => setRepo(event.target.value) }),
        h('label', { className: 'dshaSv_muted' }, t('rwGoal')),
        h('input', { className: 'dshaSv_input', value: goal, maxLength: 500, placeholder: t('rwGoalPh'), 'aria-label': t('rwGoal'), onChange: (event) => setGoal(event.target.value) }),
        h('div', { className: 'dshaSv_row' },
          h('label', { className: 'dshaSv_muted' }, t('rwIntervalField')),
          h('input', { className: 'dshaSv_input', value: interval, inputMode: 'numeric', maxLength: 4, 'aria-label': t('rwIntervalField'), onChange: (event) => setInterval(event.target.value) })),
        h('div', { className: 'dshaSv_row' },
          h('label', { className: 'dshaSv_muted' }, t('rwActiveHoursField')),
          h('input', { className: 'dshaSv_input', value: hours, maxLength: 20, placeholder: '09:00-22:00', 'aria-label': t('rwActiveHoursField'), onChange: (event) => setHours(event.target.value) })),
        h('div', { className: 'dshaSv_row' },
          h('label', { className: 'dshaSv_muted' }, t('rwBacklogField')),
          h('input', { className: 'dshaSv_input', value: backlog, inputMode: 'numeric', maxLength: 3, 'aria-label': t('rwBacklogField'), onChange: (event) => setBacklog(event.target.value) })),
        h('p', { className: 'dshaSv_muted' }, t('rwBacklogHint')),
        h('label', { className: 'dshaSv_check' },
          h('input', { type: 'checkbox', checked: observe, onChange: (event) => setObserve(event.target.checked) }),
          h('span', null, t('rwObserve'))),
        h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': advanced ? 'true' : undefined, onClick: () => setAdvanced(!advanced) }, advanced ? t('sideLess') : t('rwAdvanced')),
        advanced ? h(React.Fragment, null,
          h('label', { className: 'dshaSv_muted' }, t('rwLabelsField')),
          h('input', { className: 'dshaSv_input', value: labels, maxLength: 300, 'aria-label': t('rwLabelsField'), onChange: (event) => setLabels(event.target.value) }),
          h('label', { className: 'dshaSv_muted' }, t('rwIgnoreLabelsField')),
          h('input', { className: 'dshaSv_input', value: ignore, maxLength: 300, 'aria-label': t('rwIgnoreLabelsField'), onChange: (event) => setIgnore(event.target.value) }),
          h('label', { className: 'dshaSv_muted' }, t('rwAuthorsField')),
          h('input', { className: 'dshaSv_input', value: authors, maxLength: 300, 'aria-label': t('rwAuthorsField'), onChange: (event) => setAuthors(event.target.value) }),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwAssigneeField')),
            h('input', { className: 'dshaSv_input', value: assignee, maxLength: 80, 'aria-label': t('rwAssigneeField'), onChange: (event) => setAssignee(event.target.value) })),
          h('label', { className: 'dshaSv_check' },
            h('input', { type: 'checkbox', checked: onlyAssigned, onChange: (event) => setOnlyAssigned(event.target.checked) }),
            h('span', null, t('rwOnlyAssigned')))) : null,
        note?.pulse ? h('span', { className: 'dshaSv_actionPulse', 'aria-hidden': 'true' }) : null,
        h('div', { className: 'dshaSv_row' },
          h('button', { type: 'submit', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || repo.trim() === '' }, t('rwStart'))));
    }

    /** 单条守候的编辑 / 停止。 */
    function WatchEdit({ kit, watch, act, busy }) {
      const { t } = kit;
      const [interval, setInterval] = React.useState(String(watch.intervalSec ?? 120));
      const [batch, setBatch] = React.useState(String(watch.batchLimit ?? 5));
      const [wakes, setWakes] = React.useState(String(watch.maxWakesPerHour ?? 6));
      const [hours, setHours] = React.useState(watch.activeHours ?? '');
      const [ackLabel, setAckLabel] = React.useState(watch.ackLabel ?? 'relay:ack');
      const [backlog, setBacklog] = React.useState(String(watch.backlogHours ?? 0));
      const [observe, setObserve] = React.useState(watch.observe === true);
      const [labels, setLabels] = React.useState((watch.filters?.labels ?? []).join(', '));
      const [ignore, setIgnore] = React.useState((watch.filters?.ignoreLabels ?? []).join(', '));
      const [authors, setAuthors] = React.useState((watch.filters?.allowAuthors ?? []).join(', '));
      const [assignee, setAssignee] = React.useState(watch.filters?.assignee ?? '');
      const [onlyAssigned, setOnlyAssigned] = React.useState(watch.filters?.onlyAssigned === true);
      const [stopAsk, setStopAsk] = React.useState(false);
      const save = (event) => {
        event?.preventDefault?.();
        if (busy) return;
        act({
          action: 'repo-watch-update', id: watch.id,
          intervalSec: Number(interval) || undefined, batchLimit: Number(batch) || undefined,
          maxWakesPerHour: Number(wakes) || undefined, activeHours: hours.trim() || undefined,
          ackLabel: ackLabel.trim() || undefined, backlogHours: Number(backlog) || 0, observe,
          labels: listOf(labels), ignoreLabels: listOf(ignore), allowAuthors: listOf(authors),
          assignee: assignee.trim() || undefined, onlyAssigned
        });
      };
      return h('details', { className: 'dshaSv_box', key: watch.id },
        h('summary', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_pill', 'data-mono': true }, watch.repo),
          h('span', { className: 'dshaSv_pill', 'data-tone': watchToneOf(watch) }, watchStateOf(t, watch)),
          h('span', { className: 'dshaSv_grow' })),
        h('form', { className: 'dshaSv_splitForm', onSubmit: save },
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwIntervalField')),
            h('input', { className: 'dshaSv_input', value: interval, inputMode: 'numeric', maxLength: 4, 'aria-label': t('rwIntervalField'), onChange: (event) => setInterval(event.target.value) })),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwBatchField')),
            h('input', { className: 'dshaSv_input', value: batch, inputMode: 'numeric', maxLength: 2, 'aria-label': t('rwBatchField'), onChange: (event) => setBatch(event.target.value) })),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwWakesField')),
            h('input', { className: 'dshaSv_input', value: wakes, inputMode: 'numeric', maxLength: 2, 'aria-label': t('rwWakesField'), onChange: (event) => setWakes(event.target.value) })),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwActiveHoursField')),
            h('input', { className: 'dshaSv_input', value: hours, maxLength: 20, placeholder: '09:00-22:00', 'aria-label': t('rwActiveHoursField'), onChange: (event) => setHours(event.target.value) })),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwAckLabelField')),
            h('input', { className: 'dshaSv_input', value: ackLabel, maxLength: 50, 'aria-label': t('rwAckLabelField'), onChange: (event) => setAckLabel(event.target.value) })),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwBacklogField')),
            h('input', { className: 'dshaSv_input', value: backlog, inputMode: 'numeric', maxLength: 3, 'aria-label': t('rwBacklogField'), onChange: (event) => setBacklog(event.target.value) })),
          h('p', { className: 'dshaSv_muted' }, t('rwBacklogHint')),
          h('label', { className: 'dshaSv_check' },
            h('input', { type: 'checkbox', checked: observe, onChange: (event) => setObserve(event.target.checked) }),
            h('span', null, t('rwObserve'))),
          h('label', { className: 'dshaSv_muted' }, t('rwLabelsField')),
          h('input', { className: 'dshaSv_input', value: labels, maxLength: 300, 'aria-label': t('rwLabelsField'), onChange: (event) => setLabels(event.target.value) }),
          h('label', { className: 'dshaSv_muted' }, t('rwIgnoreLabelsField')),
          h('input', { className: 'dshaSv_input', value: ignore, maxLength: 300, 'aria-label': t('rwIgnoreLabelsField'), onChange: (event) => setIgnore(event.target.value) }),
          h('label', { className: 'dshaSv_muted' }, t('rwAuthorsField')),
          h('input', { className: 'dshaSv_input', value: authors, maxLength: 300, 'aria-label': t('rwAuthorsField'), onChange: (event) => setAuthors(event.target.value) }),
          h('div', { className: 'dshaSv_row' },
            h('label', { className: 'dshaSv_muted' }, t('rwAssigneeField')),
            h('input', { className: 'dshaSv_input', value: assignee, maxLength: 80, 'aria-label': t('rwAssigneeField'), onChange: (event) => setAssignee(event.target.value) })),
          h('label', { className: 'dshaSv_check' },
            h('input', { type: 'checkbox', checked: onlyAssigned, onChange: (event) => setOnlyAssigned(event.target.checked) }),
            h('span', null, t('rwOnlyAssigned'))),
          h('div', { className: 'dshaSv_row' },
            h('button', { type: 'submit', className: 'dshaSv_btn', 'data-primary': true, disabled: busy }, t('rwSave')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setStopAsk(!stopAsk) }, t('rwStop')))),
        stopAsk ? h('div', { className: 'dshaSv_alert', 'data-tone': 'warn', role: 'group' },
          h('p', null, t('rwStopConfirm')),
          h('div', { className: 'dshaSv_taskActs' },
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => act({ action: 'repo-watch-stop', id: watch.id }) }, t('rwStop')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setStopAsk(false) }, t('cancel')))) : null);
    }

    function RepoWatchSettings({ kit, board, act, busy }) {
      const { t } = kit;
      const data = board.repoWatches;
      const [sub, setSub] = React.useState('overview');
      if (data === undefined || data === null) return null;
      const watches = Array.isArray(data.watches) ? data.watches : [];
      const tabs = [['overview', 'rwTabOverview'], ['judge', 'rwTabJudge'], ['trigger', 'rwTabTrigger'], ['settings', 'rwTabSettings']];
      const empty = h('div', { className: 'dshaSv_quote' }, t('rwEmpty'));
      let body;
      if (sub === 'judge') body = watches.length === 0 ? empty : watches.map((watch) => h(WatchJudge, { key: watch.id, kit, watch }));
      else if (sub === 'trigger') body = [watches.map((watch) => h(WatchTrigger, { key: watch.id, kit, watch, act, busy })), h(WatchStart, { key: 'start', kit, act, busy })];
      else if (sub === 'settings') body = watches.length === 0 ? empty : watches.map((watch) => h(WatchEdit, { key: watch.id, kit, watch, act, busy }));
      else body = watches.length === 0 ? empty : watches.map((watch) => h(WatchCard, { key: watch.id, kit, watch, act, busy }));
      return h('section', { className: 'dshaSv_sec dshaSv_span' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('rwTitle')),
          data.total > 0 ? h('span', { className: 'dshaSv_pill' }, kit.format(t('rwCount'), { active: data.active ?? 0, total: data.total })) : null),
        h('p', { className: 'dshaSv_muted' }, t('rwHint')),
        h('div', { className: 'dshaSv_chips', role: 'tablist' }, ...tabs.map(([key, label]) => h('button', {
          key, type: 'button', role: 'tab', className: 'dshaSv_chipF', 'aria-selected': sub === key ? 'true' : 'false',
          onClick: () => setSub(key)
        }, t(label)))),
        body);
    }

    /* ---------------------------------------------------------------- 工作项共用详情（P1a） */

    // 详情缓存：模块级共享（右栏 / 嵌入面板 / 同一实例里的多个页签）。关闭后短 TTL 内重开不再拉。

    function RepoBox({ kit, board, act, busy }) {
      const { t } = kit;
      const repo = board.repo;
      if (repo === null || repo === undefined) return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('repoTitle')),
        h('p', { className: 'dshaSv_muted', role: 'status' }, t('loadingDetails')));
      if (repo.available !== true) {
        return h('section', { className: 'dshaSv_sec' },
          h('p', { className: 'dshaSv_h' }, t('repoTitle')),
          h('p', { className: 'dshaSv_muted' }, t('repoNoRepo') + (repo.reason ?? '')));
      }
      const extra = board.workspace?.id === undefined ? {} : { workspaceId: board.workspace.id };
      const switches = Array.isArray(repo.switches) ? repo.switches : [];
      return h('section', { className: 'dshaSv_sec' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('repoTitle')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'repo-refresh', ...extra }) }, t('repoRefresh'))),
        h('p', { className: 'dshaSv_muted', title: repo.repo }, repo.source === 'ok' ? t('repoProbeOk') : t('repoProbeFail') + (repo.error ?? '')),
        ...switches.map((item) => h('label', {
          key: item.key, className: 'dshaSv_check' + (item.available !== true ? ' dshaSv_checkOff' : ''), title: item.hint ?? ''
        },
          h('input', {
            type: 'checkbox', checked: item.enabled === true, disabled: busy || item.available !== true,
            onChange: (event) => act({ action: 'repo-switch', key: item.key, enabled: event.target.checked, ...extra },
              kit.format(event.target.checked ? t('repoSwitchOn') : t('repoSwitchOff'), { label: item.label }))
          }),
          h('span', null, item.label),
          item.available !== true && item.reason ? h('span', { className: 'dshaSv_muted' }, ' · ' + t('repoUnavailable') + item.reason) : null)));
    }

    /** 设置 → 核验：工作树声明摘要 + 最近的核验记录；原文收在「展开明细」里。 */
    function VerifyBox({ kit, board }) {
      const { t } = kit;
      const [open, setOpen] = React.useState(false);
      const decl = board.declarations;
      const watches = Array.isArray(board.watches) ? board.watches : [];
      const bad = (decl?.mismatches ?? 0) > 0;
      // 服务端已只给活跃 / 待发通知 / 24 小时内结束的核验，这里按最新 5 条列（含 done / cancelled）
      const recent = watches.slice(0, 5);
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('sideVerifyTitle')),
        decl === null || decl === undefined
          ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('loadingDetails'))
          : h(React.Fragment, null,
              h('p', { className: bad ? 'dshaSv_alert' : 'dshaSv_muted', 'data-tone': bad ? 'error' : undefined, role: bad ? 'alert' : 'status' },
                bad ? kit.format(t('sideVerifySum'), { active: decl.active, mismatches: decl.mismatches }) : t('sideVerifyOk')),
              decl.main ? h('p', { className: 'dshaSv_muted' }, kit.format(t('declMain'), { build: decl.main.build ?? '?', sha: decl.main.short ?? '?', subject: decl.main.subject ?? '' })) : null,
              decl.main ? h('p', { className: 'dshaSv_muted' }, decl.main.released ? kit.format(t('declReleased'), { build: decl.main.released.build, tag: decl.main.released.tag, gap: '' }) : t('declReleasedNone')) : null,
              h('p', { className: 'dshaSv_muted' }, kit.format(t('declExtra'), {
                landed: Array.isArray(decl.landed) ? decl.landed.length : 0,
                overlaps: Array.isArray(decl.overlaps) ? decl.overlaps.length : 0,
                bg: decl.backgroundAttention ?? 0
              })),
              decl.text ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': open, onClick: () => setOpen(!open) }, open ? t('declHide') : t('declShow')) : null,
              open && decl.text ? h('pre', { className: 'dshaSv_pre' }, decl.text) : null),
        h('p', { className: 'dshaSv_h' }, t('watchTitle')),
        recent.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('sideNoChecks'))
          : h('div', { className: 'dshaSv_list' }, ...recent.map((item) => {
            const state = VERIFY_STATE[item.state];
            return h('div', { key: item.id, className: 'dshaSv_row' },
              // 未知状态显示服务端原值，不再 fallback 成「核验中」
              h('span', { className: 'dshaSv_pill', 'data-tone': state === undefined ? undefined : state[1] }, state === undefined ? String(item.state) : t(state[0])),
              h('span', { className: 'dshaSv_muted dshaSv_watchLine dshaSv_grow', title: item.line }, item.what ?? item.line),
              item.checkedAt ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: item.line }, kit.formatTime(item.checkedAt)) : null);
          })));
    }

    /* ---------------------------------------------------------------- 模型选择（交接页与设置页共用） */

    // 模型目录按会话缓存 30 秒：交接页和设置页来回切时不重复请求；保存角色模型后主动失效

    function LineBox({ kit, board, act, busy }) {
      const { t } = kit;
      const current = board.line?.text ?? '';
      const [draft, setDraft] = React.useState(current);
      const max = 1500;
      const dirty = draft.trim() !== current;
      const extra = board.workspace?.id === undefined ? {} : { workspaceId: board.workspace.id };
      const line = board.line;
      const who = line?.setBy === 'user' ? t('whoUser') : t('whoModel');
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('lineTitle')),
        h('p', { className: 'dshaSv_muted' }, t('lineHint')),
        h('div', { className: 'dshaSv_card' },
          h('textarea', {
            className: 'dshaSv_input', rows: 4, value: draft, maxLength: max, placeholder: t('linePlaceholder'), 'aria-label': t('lineTitle'),
            onChange: (event) => setDraft(event.target.value)
          }),
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_muted' }, line ? kit.format(t('lineSetBy'), { time: kit.formatTime(line.setAt), who }) : t('lineEmpty')),
            h('span', { className: 'dshaSv_muted' }, kit.format(t('chars'), { n: draft.length, max })),
            h('span', { className: 'dshaSv_grow' }),
            line ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'line-clear', ...extra }, t('lineCleared')) }, t('clear')) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !dirty || draft.trim() === '', onClick: () => act({ action: 'line', text: draft, ...extra }, t('saved')) }, t('save')))));
    }

    /** 设置 → 新建会话用的模型：本工作区主会话 / 工作会话各一组（只有用户能改）。 */
    function RoleModelsBox({ kit, board, act, busy, sessionId }) {
      const { t } = kit;
      const [nonce, setNonce] = React.useState(0);
      const data = useModelsView(kit, sessionId, true, nonce);
      const refresh = () => { modelsCache.delete(String(sessionId ?? '')); setNonce((value) => value + 1); };
      const row = (role) => h(RoleModelRow, {
        key: role + ':' + (data?.labels?.[role] ?? 'follow'),
        kit, data, role, act, busy, onSaved: refresh
      });
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('modelRolesTitle')),
        data === undefined ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('modelLoading'))
          : data === null || data.supported === false
            ? h('p', { className: 'dshaSv_muted' }, t('modelUnsupported'))
            : h(React.Fragment, null, row('main'), row('worker')));
    }

    function RoleModelRow({ kit, data, role, act, busy, onSaved }) {
      const { t } = kit;
      const current = data?.roles?.[role] ?? null;
      const [value, setValue] = React.useState(current ?? 'default');
      // 推理强度也是选择的一部分：只改强度也要能保存
      const selectionKey = (v) => modelSelectValue(v) + '@' + (v && typeof v === 'object' ? (v.reasoningEffort ?? '') : '');
      const changed = selectionKey(value) !== selectionKey(current ?? 'default');
      const save = () => {
        const choice = value === 'default' ? 'default' : value;
        return act({ action: 'role-model', role, model: choice }, t('saved')).then((payload) => { if (payload) onSaved(); });
      };
      return h('div', { className: 'dshaSv_card' },
        h('p', { className: 'dshaSv_h' }, t(role === 'main' ? 'modelRoleMain' : 'modelRoleWorker')),
        h('p', { className: 'dshaSv_muted' }, t(role === 'main' ? 'modelRoleMainHint' : 'modelRoleWorkerHint')),
        h('div', { className: 'dshaSv_row' },
          h(ModelSelect, { kit, data, value, allowFollow: false, disabled: busy, onChange: setValue }),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !changed, onClick: save }, t('save'))),
        h(ModelEffort, { kit, data, value, disabled: busy, onChange: setValue }),
        h('p', { className: 'dshaSv_muted' }, kit.format(t('modelRoleNow'), { v: data?.labels?.[role] ?? t('modelFollow') })));
    }

    /** 设置 → 常设授权：你不在时主会话可以自己决定什么。 */
    function DelegationBox({ kit, board, act, busy }) {
      const { t } = kit;
      const current = board.delegation?.text ?? '';
      const [draft, setDraft] = React.useState(current || (board.delegationDefault ?? ''));
      const max = board.delegationLimit ?? 600;
      const extra = board.workspace?.id === undefined ? {} : { workspaceId: board.workspace.id };
      const changed = draft.trim() !== current;
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('delegTitle')),
        h('p', { className: 'dshaSv_muted' }, t('delegHint')),
        h('p', { className: 'dshaSv_muted' }, t('delegBoundary')),
        h('div', { className: 'dshaSv_card' },
          h('textarea', { className: 'dshaSv_input', rows: 4, value: draft, maxLength: max, 'aria-label': t('delegTitle'), onChange: (event) => setDraft(event.target.value) }),
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_muted' }, board.delegation ? kit.format(t('delegSet'), { time: kit.formatTime(board.delegation.setAt) }) : t('delegNone')),
            h('span', { className: 'dshaSv_muted' }, kit.format(t('chars'), { n: draft.length, max })),
            h('span', { className: 'dshaSv_grow' }),
            board.delegation ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'delegate-clear', ...extra }, t('delegCleared')) }, t('clear')) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !changed || draft.trim() === '', onClick: () => act({ action: 'delegate', text: draft, ...extra }, t('delegSaved')) }, t('save')))));
    }

    /** 设置 → 自动置顶：主会话与进行中的工作会话排到会话列表前面。 */
    function PinBox({ kit, board, act, busy }) {
      const { t } = kit;
      const pin = board.autoPin;
      if (pin === null || pin === undefined) return null;
      const extra = board.workspace?.id === undefined ? {} : { workspaceId: board.workspace.id };
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('pinTitle')),
        h('p', { className: 'dshaSv_muted' }, t('pinHint')),
        h('div', { className: 'dshaSv_card' },
          h('label', { className: 'dshaSv_check' },
            h('input', {
              type: 'checkbox', checked: pin.enabled === true, disabled: busy || pin.available !== true,
              onChange: (event) => act({ action: 'auto-pin', enabled: event.target.checked, ...extra }, event.target.checked ? t('pinOn') : t('pinOff'))
            }),
            h('span', null, t('pinLabel'))),
          pin.enabled ? h('p', { className: 'dshaSv_muted' }, kit.format(t('pinOwned'), { n: pin.owned })) : null));
    }

    /** 设置 → 开发者模式：限时只读查看所有工作区的会话（全局开关）。 */
    function DevBox({ kit, board, act, busy }) {
      const { t } = kit;
      const dev = board.devMode;
      if (dev === null || dev === undefined) return null;
      const [hours, setHours] = React.useState(String(dev.defaultHours ?? 2));
      const until = dev.until ? new Date(dev.until).toLocaleString() : '';
      const maxHours = dev.maxHours ?? 24;
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('devTitle')),
        h('p', { className: 'dshaSv_muted' }, t('devHint')),
        h('p', { className: 'dshaSv_muted' }, t('devBoundary')),
        h('div', { className: 'dshaSv_card' },
          dev.enabled
            ? h('div', { className: 'dshaSv_row' },
                h('span', { className: 'dshaSv_alert dshaSv_grow', 'data-tone': 'error', role: 'status' }, kit.format(t('devActive'), { time: until })),
                h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'dev-mode', enabled: false }, t('devOffDone')) }, t('devDisable')))
            : h('div', { className: 'dshaSv_row' },
                h('span', { className: 'dshaSv_muted' }, t('devHours')),
                h('input', {
                  className: 'dshaSv_input', type: 'number', min: '0.25', max: String(maxHours), step: '0.25', value: hours,
                  style: { maxWidth: '6em' }, 'aria-label': t('devHours'), onChange: (event) => setHours(event.target.value)
                }),
                h('span', { className: 'dshaSv_grow' }),
                h('button', {
                  type: 'button', className: 'dshaSv_btn', 'data-primary': true,
                  disabled: busy || !(Number(hours) > 0 && Number(hours) <= maxHours),
                  onClick: () => act({ action: 'dev-mode', enabled: true, hours: Number(hours) }, t('devOn'))
                }, t('devEnable')))));
    }

    /** 设置 → 空闲后重启：等这一轮空闲再重启，并发手机通知。 */
    function RestartBox({ kit, board, act, busy }) {
      const { t } = kit;
      const restart = board.restart;
      if (restart === null || restart === undefined) return null;
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('restartTitle')),
        h('div', { className: 'dshaSv_card' },
          h('p', { className: 'dshaSv_muted' }, restart.text ?? ''),
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_grow' }),
            restart.phase === 'watching'
              ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'restart-cancel' }) }, t('restartCancel'))
              : h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => act({ action: 'restart-watch' }, t('saved')) }, t('restartStart')))));
    }

    /** 设置 → 指令模板：列表、新建/编辑/删除、复制用法（与 /relay tpl 同一存储）。 */
    function TemplateEditor({ kit, initial, max, busy, onSave, onCancel }) {
      const { t } = kit;
      const [name, setName] = React.useState(initial?.name ?? '');
      const [text, setText] = React.useState(initial?.text ?? '');
      const valid = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(name.trim().toLowerCase());
      return h('div', { className: 'dshaSv_card' },
        h('label', { className: 'dshaSv_muted' }, t('tplName')),
        h('input', {
          className: 'dshaSv_input', value: name, maxLength: 32, placeholder: 'claim', 'aria-label': t('tplName'),
          onChange: (event) => setName(event.target.value)
        }),
        h('p', { className: 'dshaSv_muted' }, t('tplNameHint')),
        h('label', { className: 'dshaSv_muted' }, t('tplText')),
        h('textarea', {
          className: 'dshaSv_input', rows: 5, value: text, maxLength: max, 'aria-label': t('tplText'),
          onChange: (event) => setText(event.target.value)
        }),
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_muted' }, kit.format(t('chars'), { n: text.length, max })),
          h('span', { className: 'dshaSv_grow' }),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: onCancel }, t('cancel')),
          h('button', {
            type: 'button', className: 'dshaSv_btn', 'data-primary': true,
            disabled: busy || !valid || text.trim() === '',
            onClick: () => onSave(name.trim().toLowerCase(), text)
          }, t('save'))));
    }

    function TemplateBox({ kit, act, busy }) {
      const { t } = kit;
      const [data, setData] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [editing, setEditing] = React.useState(undefined);
      const [confirm, setConfirm] = React.useState(undefined);
      const load = React.useCallback(() => {
        kit.request('GET', undefined, { view: 'settings' }).then(
          (payload) => { setData({ templates: Array.isArray(payload?.templates) ? payload.templates : [], limits: payload?.limits ?? {} }); setError(undefined); },
          (failure) => setError(kit.errorText(t, failure)));
      }, [kit, t]);
      React.useEffect(() => { load(); }, [load]);
      const max = data?.limits?.text ?? 16000;
      const templates = data?.templates ?? [];
      const save = (name, text) => act({
        action: 'save', name, text,
        previousName: editing === 'new' ? null : editing,
        overwrite: editing !== 'new' && editing === name
      }, t('saved')).then((payload) => { if (payload) { setEditing(undefined); load(); } });
      const remove = (name) => act({ action: 'remove', name }, t('removed')).then((payload) => { if (payload) { setConfirm(undefined); load(); } });
      const templateRow = (template) => {
        const actions = confirm === template.name
          ? h(React.Fragment, null,
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => remove(template.name) }, t('confirmRemove')),
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setConfirm(undefined) }, t('cancel')))
          : h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setConfirm(template.name) }, t('remove'));
        return h('div', { key: template.name, className: 'dshaSv_card' },
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_h dshaSv_grow' }, template.name),
            h('span', { className: 'dshaSv_muted' }, kit.formatTime(template.updatedAt)),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => kit.copyText(`/relay new --as ${template.name}1 --tpl ${template.name}`) }, t('copyUse')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || editing !== undefined, onClick: () => { setConfirm(undefined); setEditing(template.name); } }, t('edit')),
            actions));
      };
      return h('section', { className: 'dshaSv_sec' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('tplTitle')),
          data !== undefined && editing === undefined
            ? h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => setEditing('new') }, t('tplNew'))
            : null),
        h('p', { className: 'dshaSv_muted' }, t('tplHint')),
        error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
        data === undefined && error === undefined ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('loading')) : null,
        data !== undefined && templates.length === 0 && editing === undefined ? h('p', { className: 'dshaSv_muted' }, t('tplEmpty')) : null,
        editing === 'new' ? h(TemplateEditor, { key: 'new', kit, max, busy, onSave: save, onCancel: () => setEditing(undefined) }) : null,
        ...templates.map((template) => editing === template.name
          ? h(TemplateEditor, { key: template.name, kit, initial: template, max, busy, onSave: save, onCancel: () => setEditing(undefined) })
          : templateRow(template)));
    }

    /** T14 发布状态卡：只读 package.json / git / tag / gh Release；动作只复制命令 / 唤醒主会话 / 打开链接。 */
    function ReleaseBox({ kit, board, sessionId, busy, act }) {
      const { t } = kit;
      const [data, setData] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [loading, setLoading] = React.useState(false);
      const [copied, setCopied] = React.useState(false);
      const serial = React.useRef(0);
      const load = React.useCallback((force) => {
        const mine = ++serial.current;
        setLoading(true);
        kit.request('GET', undefined, { view: 'release', ...(sessionId ? { session: sessionId } : {}), ...(force ? { force: '1' } : {}) }).then(
          (payload) => { if (mine === serial.current) { setData(payload?.release ?? null); setError(undefined); } },
          (failure) => { if (mine === serial.current) setError(kit.errorText(t, failure)); }
        ).finally(() => { if (mine === serial.current) setLoading(false); });
      }, [kit, t, sessionId]);
      React.useEffect(() => { load(false); return () => { serial.current++; }; }, [load]);
      const copy = () => {
        kit.copyText(data?.command ?? '').then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      };
      const main = board?.coordinator?.sessionId;
      const wake = () => { if (main !== undefined && typeof act === 'function') act({ action: 'wake', target: main, note: t('releaseWakeNote') }); };
      const release = data?.release ?? {};
      const steps = Array.isArray(data?.stages) ? data.stages : [];
      const stateText = (state) => t(state === 'done' ? 'releaseStateDone' : state === 'pending' ? 'releaseStatePending' : 'releaseStateUnknown');
      const capitalized = (key) => key.charAt(0).toUpperCase() + key.slice(1);
      const stageLabel = (key) => t('releaseStage' + capitalized(key));
      const hint = (key) => t('releaseStageHint' + capitalized(key));
      const size = (bytes) => {
        const n = Number(bytes) || 0;
        if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
        if (n >= 1024) return Math.round(n / 1024) + ' KB';
        return n + ' B';
      };
      const head = data?.head ?? null;
      const mainInfo = data?.main ?? null;
      const asset = data?.tgz ?? (data?.packed ? { name: data.packed.file, size: data.packed.size, digest: data.packed.sha256 } : null);
      const facts = data === undefined || data === null ? [] : [
        [t('releaseVersion'), data.version ? 'v' + data.version : t('releaseUnknown'), 'pill'],
        [t('releaseHead'), head ? (head.short + (head.branch ? ' · ' + head.branch : '')) : t('releaseUnknown'), 'mono'],
        [t('releaseMain'), mainInfo ? (mainInfo.short + (mainInfo.build ? ' · ' + mainInfo.build : '')) : t('releaseUnknown'), 'mono'],
        [t('releaseTag'), data.latestTag ?? t('releaseMissing'), 'pill'],
        [t('releaseRelease'), release.state === 'ready' ? (release.tag ?? '') : release.state === 'missing' ? t('releaseMissing') : t('releaseUnknown'), 'pill']
      ];
      return h('section', { className: 'dshaSv_sec dshaSv_relCard', 'aria-label': t('releaseTitle') },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('releaseTitle')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => load(true) }, h(IconRefresh), t('releaseRefresh'))),
        h('p', { className: 'dshaSv_muted' }, t('releaseHint')),
        loading && data === undefined ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('releaseLoading')) : null,
        error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
        data?.available === false ? h('p', { className: 'dshaSv_alert', 'data-tone': 'warn' }, kit.format(t('releaseUnavailable'), { reason: data.reason ?? '' })) : null,
        data?.available !== false && steps.length > 0 ? h('div', { className: 'dshaSv_stageBar', role: 'list', 'aria-label': t('releaseTitle') },
          ...steps.flatMap((step, index) => [
            index > 0 ? h('span', { key: 'a' + index, className: 'dshaSv_stageArrow', 'aria-hidden': true }, '→') : null,
            h('span', { key: step.key, className: 'dshaSv_stage', 'data-state': step.state, title: hint(step.key), role: 'listitem' },
              h('span', { className: 'dshaSv_stageDot', 'aria-hidden': true }), stageLabel(step.key), ' ', stateText(step.state))
          ])) : null,
        facts.length > 0 ? h('div', { className: 'dshaSv_relFacts' },
          ...facts.map(([label, value, kind], index) => h('span', { key: 'f' + index, className: kind === 'pill' ? 'dshaSv_pill' : 'dshaSv_metaChip', 'data-mono': kind === 'mono' ? true : undefined, title: label + '：' + value }, label + ' ' + value))) : null,
        asset ? h('p', { className: 'dshaSv_muted', title: asset.digest ?? '' }, kit.format(t('releaseTgzLine'), { name: asset.name, size: size(asset.size), sha: String(asset.digest ?? '').replace(/^sha256:/, '').slice(0, 12) || t('releaseUnknown') })) : null,
        data?.available !== false ? h('div', { className: 'dshaSv_row' },
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: !data?.command, onClick: copy }, t(copied ? 'releaseCopied' : 'releaseCommand')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || main === undefined || typeof act !== 'function', title: main === undefined ? t('releaseNoMain') : undefined, onClick: wake }, t('releaseWake')),
          release.state === 'ready' && release.url ? h('a', { className: 'dshaSv_btn', href: release.url, target: '_blank', rel: 'noopener noreferrer' }, t('releaseOpen')) : null) : null,
        data?.checkedAt ? h('p', { className: 'dshaSv_muted' }, kit.format(t('releaseChecked'), { t: kit.formatTime(data.checkedAt) })) : null);
    }

    /** 设置：GitHub 账号、仓库开关、同步与核验；从顶栏齿轮进入，返回原页签。 */
    function SettingsTab({ kit, board, act, busy, onBack, sessionId }) {
      const { t } = kit;
      const gh = board.github;
      return h(React.Fragment, null,
        h('div', { className: 'dshaSv_settingsHead' },
          h('button', { type: 'button', className: 'dshaSv_btn', onClick: onBack }, h(IconBack), t('sideBack')),
          h('span', { className: 'dshaSv_h dshaSv_grow' }, t('sideSettings'))),
        h('p', { className: 'dshaSv_muted' }, t('sideSettingsHint')),
        h('div', { className: 'dshaSv_grid' },
          h(GitHubCard, { kit, github: gh ?? { state: null, reading: true, match: 'unknown', pinned: null, scopes: [], loginFlow: null, error: null }, busy, act }),
          h(RepoBox, { kit, board, act, busy }),
          h(RepoWatchSettings, { kit, board, act, busy }),
          board.sync === null || board.sync === undefined
            ? h('section', { className: 'dshaSv_sec' },
                h('p', { className: 'dshaSv_h' }, t('syncTitle')),
                h('p', { className: 'dshaSv_muted', role: 'status' }, t('loadingDetails')))
            : board.sync.available === true ? h(SyncStatus, { kit, sync: board.sync, act, busy }) : null,
          h(VerifyBox, { kit, board }),
          h(ReleaseBox, { kit, board, sessionId, busy, act }),
          h(LineBox, { kit, board, act, busy }),
          h(TemplateBox, { kit, act, busy }),
          h(RoleModelsBox, { kit, board, act, busy, sessionId }),
          h(DelegationBox, { kit, board, act, busy }),
          h(PinBox, { kit, board, act, busy }),
          h(DevBox, { kit, board, act, busy }),
          h(RestartBox, { kit, board, act, busy })));
    }

    /** 交接快照：把引擎生成的几行原文拆成会话行 / 摘要行，避免整段 <pre> 又长又密。 */

      return { SettingsTab, GitHubCard, RepoBox, VerifyBox, RepoWatchSettings, WatchStart, WatchEdit, LineBox, TemplateBox, RoleModelsBox, DelegationBox, PinBox, DevBox, RestartBox, ReleaseBox };
    }

    return { KIT_VERSION: 47, make };
  }
});
