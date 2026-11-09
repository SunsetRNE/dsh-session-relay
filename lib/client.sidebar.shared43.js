window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.shared43.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar43.js 按需 require.async 加载；共用件与图标经
    // make(deps) 传入，不跨 chunk 同步 require（DSH 模块协议只支持自包含 chunk）。
    function make(deps) {
      const React = deps.React;
      const h = deps.h;
      const {
        IconRefresh, IconCopy, IconBack, IconOpen, IconStar, IconGear, IconMap, IconList, IconSearch, IconChecklist,
        IconHandoff, IconActivity, IconFolder, IconTarget, IconPlay, IconCheck, IconArchive, IconPr, IconBranch, IconIssue,
        IconMore, IconMail
      } = deps.icons;


      const { memo, readRemoteSnapshot, writeRemoteSnapshot, usePersisted } = deps.ui;

    function Card({ tone, onOpen, label, children, updated = false }) {
      return h('div', {
        className: 'dshaSv_card', 'data-tone': tone, 'data-updated': updated ? 'true' : undefined, role: 'button', tabIndex: 0, 'aria-label': label,
        onClick: onOpen,
        onKeyDown: (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }
      }, children);
    }
    const stop = (fn) => (event) => { event?.stopPropagation?.(); fn(); };

    function CopyId({ kit, sessionId, copied, onCopied }) {
      const status = copied === sessionId ? 'ok' : copied === 'fail:' + sessionId ? 'fail' : undefined;
      const label = status === 'ok' ? kit.t('idCopied') : status === 'fail' ? kit.t('copyFailed') : kit.t('copyId');
      return h('button', {
        type: 'button', className: 'dshaSv_icon', 'data-flash': status, title: label, 'aria-label': `${label} ${sessionId}`,
        onClick: stop(() => { void kit.copyText(sessionId).then((ok) => onCopied(ok ? sessionId : 'fail:' + sessionId), () => onCopied('fail:' + sessionId)); })
      }, status === 'ok' ? '✓' : status === 'fail' ? '!' : h(IconCopy));
    }

    /** 卡片主操作：待答复 / 受阻 → 回复；可合并 → 排号；久未活动 → 唤醒；其余只打开。 */

    const keep = { onClick: (event) => event.stopPropagation(), onKeyDown: (event) => event.stopPropagation() };

    /** 卡片上的写操作，每个都要第二次确认（发送 / 排号 / 确认唤醒）；以你的身份执行，走协作页同一路由。 */

    function richLines(text) {
      const raw = String(text ?? '');
      const parts = [];
      const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
      let last = 0;
      let match;
      while ((match = re.exec(raw)) !== null) {
        if (match.index > last) parts.push(raw.slice(last, match.index));
        parts.push(match[1] !== undefined ? h('strong', { key: 'b' + match.index }, match[1]) : h('code', { key: 'c' + match.index }, match[2]));
        last = match.index + match[0].length;
      }
      if (last < raw.length) parts.push(raw.slice(last));
      return parts;
    }

    /** 汇报/说明的轻量富文本：去 Markdown 记号，粗体 / 行内代码转标签，列表压成一行（密排用）。 */
    function richSummary(text) {
      const clean = String(text ?? '').trim();
      if (clean === '') return null;
      const flat = clean.split('\n').map((line) => line.trim()).filter(Boolean)
        .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, ''))
        .join(' · ');
      return richLines(flat);
    }

    /** 会话页版本线：结构化胶囊 + 两行预览，长文按需展开。 */

    const BackMore = ({ kit, onBack }) => typeof onBack !== 'function' ? null : h('button', {
      type: 'button', className: 'dshaSv_icon dshaSv_foldOnly',
      title: kit.t('sideBackMore'), 'aria-label': kit.t('sideBackMore'),
      onClick: onBack
    }, h(IconBack));

    /** 需要你处理的事：主会话的提问（直接点选项）与提醒条。只在有事时出现。 */

    function SyncStatus({ kit, sync, act, busy = false }) {
      const { t } = kit;
      const [open, setOpen] = React.useState(false);
      const [detachAsk, setDetachAsk] = React.useState(undefined);
      if (sync === null || sync === undefined || sync.available !== true) return null;
      const links = Array.isArray(sync.links) ? sync.links : [];
      const enabled = sync.switches?.issues === true;
      const unknown = links.filter((item) => item.state === 'unknown').length;
      const failed = links.filter((item) => item.state === 'failed').length;
      const canAct = typeof act === 'function';
      const run = (body, okText) => { if (canAct) void act(body, okText); };
      const queue = Number(sync.queue) || 0;
      // 标题与状态分开渲染：左边「同步」，右边一颗颗状态胶囊，不再挤成「同步 · 空闲」一整行
      const states = [];
      if (!enabled) states.push({ key: 'off', text: t('syncOff') });
      else {
        if (queue > 0) states.push({ key: 'queue', text: kit.format(t('syncQueue'), { n: queue }), tone: 'brand' });
        if (sync.paused) states.push({ key: 'paused', text: t('syncPaused'), tone: 'warn' });
      }
      if (unknown > 0) states.push({ key: 'unknown', text: kit.format(t('syncUnknown'), { n: unknown }), tone: 'warn' });
      if (failed > 0) states.push({ key: 'failed', text: kit.format(t('syncFailed'), { n: failed }), tone: 'error' });
      if (states.length === 0) states.push({ key: 'idle', text: t('syncIdle') });
      const hint = [sync.repo ?? '', t('syncTitle'), ...states.map((item) => item.text)].filter(Boolean).join(' · ');
      const stateKey = { synced: 'syncStateSynced', queued: 'syncStateQueued', 'in-flight': 'syncStateInflight', unknown: 'syncStateUnknown', failed: 'syncStateFailed', local: 'syncStateLocal', conflict: 'syncStateConflict' };
      return h('div', { className: 'dshaSv_sync' },
        h('button', { type: 'button', className: 'dshaSv_link dshaSv_syncLine', title: hint, 'aria-label': hint, 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(!open) },
          h('span', { className: 'dshaSv_syncK' }, t('syncTitle')),
          ...states.map((item) => h('span', { key: item.key, className: 'dshaSv_pill', 'data-tone': item.tone }, item.text)),
          h('span', { className: 'dshaSv_syncCaret', 'aria-hidden': 'true' }, open ? '▴' : '▾')),
        open ? h(React.Fragment, null,
          canAct ? h('div', { className: 'dshaSv_taskActs' },
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(() => run({ action: 'sync-flush' }, t('syncFlushDone'))) }, h(IconRefresh), t('syncFlush')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(() => run({ action: 'sync-backfill' }, t('syncBackfillDone'))) }, t('syncBackfill')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(() => run({ action: 'sync-pause', paused: !sync.paused }, sync.paused ? t('syncResumeDone') : t('syncPauseDone'))) }, sync.paused ? t('syncResume') : t('syncPause'))) : null,
          links.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('syncEmpty')) : h('div', { className: 'dshaSv_list' }, ...links.slice(0, 10).map((item) => h('div', { key: item.id, className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_pill', 'data-mono': true }, item.id),
            item.issue ? h('a', { className: 'dshaSv_link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, '#' + item.issue) : null,
            h('span', { className: 'dshaSv_muted' }, t(stateKey[item.state] ?? 'syncStateUnknown')),
            item.lastError ? h('span', { className: 'dshaSv_muted', title: item.lastError }, '⚠') : null,
            h('span', { className: 'dshaSv_grow' }),
            canAct && (item.state === 'failed' || item.state === 'unknown' || item.state === 'conflict')
              ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(() => run({ action: 'sync-retry', id: item.id }, t('syncRetryDone'))) }, t('syncRetry'))
              : null,
            canAct ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: stop(() => {
              if (detachAsk !== item.id) { setDetachAsk(item.id); return; }
              setDetachAsk(undefined);
              run({ action: 'sync-detach', id: item.id }, t('syncDetachDone'));
            }) }, detachAsk === item.id ? t('syncDetachAsk') : t('syncDetach')) : null)))) : null);
    }

    /** 任务看板里关联的 PR（只读）：任务详情之外，动态页也汇总一眼。 */

    /* ---------------------------------------------------------------- 工作项共用详情（P1a） */

    // 详情缓存：模块级共享（右栏 / 嵌入面板 / 同一实例里的多个页签）。关闭后短 TTL 内重开不再拉。
    const WORK_ITEM_TTL_MS = 60_000;
    const WORK_ITEM_CACHE_MAX = 24;
    const workItemCache = new Map();
    const workItemInflight = new Map();
    // 跨页跳转：kind → 页签；任务页 P1a 只切页签，不接收详情焦点（design 3）
    const WORK_ITEM_TAB = { task: 'tasks', 'map-ticket': 'map', issue: 'issues', pr: 'prs' };
    const WORK_ITEM_KIND_LABEL = { task: 'workItemKindTask', 'map-ticket': 'workItemKindMap', issue: 'workItemKindIssue', pr: 'workItemKindPr' };

    function workItemTabKey(kind) {
      return WORK_ITEM_TAB[kind];
    }
    function workItemCacheKey(params) {
      return JSON.stringify(params ?? {});
    }
    function workItemCacheGet(key, ttlMs) {
      const hit = workItemCache.get(key);
      if (hit === undefined) return undefined;
      if (Date.now() - hit.at >= ttlMs) { workItemCache.delete(key); return undefined; }
      return hit;
    }
    function workItemCacheSet(key, data) {
      workItemCache.delete(key);
      workItemCache.set(key, { at: Date.now(), data });
      while (workItemCache.size > WORK_ITEM_CACHE_MAX) workItemCache.delete(workItemCache.keys().next().value);
    }
    function workItemCacheClear(key) {
      if (key === undefined) workItemCache.clear();
      else workItemCache.delete(key);
    }

    /**
     * 取工作项详情：同 key 的在途请求共用一份，未过期缓存直接复用。
     * 返回 { key, promise, release }；调用方关闭 / 卸载时 release()，最后一个调用方释放时才 abort。
     */
    function workItemFetch(kit, params, ttlMs = WORK_ITEM_TTL_MS) {
      const key = workItemCacheKey(params);
      const hit = workItemCacheGet(key, ttlMs);
      if (hit !== undefined) return { key, promise: Promise.resolve(hit.data), release: () => {} };
      let entry = workItemInflight.get(key);
      if (entry === undefined) {
        const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
        entry = { key, refs: 0, controller, promise: undefined };
        entry.promise = kit.request('GET', undefined, params, controller === undefined ? undefined : controller.signal).then(
          (payload) => { workItemCacheSet(key, payload); return payload; }
        ).finally(() => { if (workItemInflight.get(key) === entry) workItemInflight.delete(key); });
        workItemInflight.set(key, entry);
      }
      entry.refs += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        entry.refs -= 1;
        if (entry.refs > 0) return;
        if (workItemInflight.get(key) === entry) workItemInflight.delete(key);
        try { entry.controller?.abort?.(); } catch {}
      };
      return { key, promise: entry.promise, release };
    }

    /** hover / focus 预取：只填缓存；请求跟着自己的 promise 收尾，不因预取调用结束而中止。 */
    function prefetchWorkItemDetail(kit, params, ttlMs = WORK_ITEM_TTL_MS) {
      let handle;
      try { handle = workItemFetch(kit, params, ttlMs); } catch { return; }
      const release = () => { try { handle.release(); } catch {} };
      if (handle.promise !== undefined && typeof handle.promise.then === 'function') handle.promise.then(release, release);
      else release();
    }

    /**
     * 详情懒加载：挂载（即打开详情）才请求；hover 预取只填缓存不置 loading；
     * 同一 key 并发只发一份；卸载 / 关闭 release；invalidate 后下次 open 重新拉。
     */
    function useLazyDetail({ kit, key, params, ttlMs = WORK_ITEM_TTL_MS, enabled = true }) {
      const cacheKey = key ?? workItemCacheKey(params);
      const [data, setData] = React.useState(() => workItemCacheGet(cacheKey, ttlMs)?.data);
      const [error, setError] = React.useState(undefined);
      // 打开时没有缓存就直接进骨架屏，避免先闪一句「没有拿到详情」再转圈
      const [loading, setLoading] = React.useState(() => enabled !== false && workItemCacheGet(cacheKey, ttlMs) === undefined);
      const alive = React.useRef(true);
      const active = React.useRef(undefined);
      const opened = React.useRef(false);
      const load = React.useCallback(() => {
        if (enabled === false || opened.current) return Promise.resolve(undefined);
        opened.current = true;
        const cached = workItemCacheGet(cacheKey, ttlMs);
        if (cached !== undefined) { setData(cached.data); setError(undefined); setLoading(false); return Promise.resolve(cached.data); }
        let request;
        try { request = JSON.parse(cacheKey); } catch { request = params ?? {}; }
        setLoading(true);
        let handle;
        try { handle = workItemFetch(kit, request, ttlMs); } catch (failure) {
          setLoading(false);
          setError(kit.errorText(kit.t, failure));
          return Promise.resolve(undefined);
        }
        active.current = handle;
        return handle.promise.then(
          (payload) => { if (alive.current && active.current === handle) { setData(payload); setError(undefined); } return payload; },
          (failure) => { if (alive.current && active.current === handle) setError(kit.errorText(kit.t, failure)); return undefined; }
        ).finally(() => { if (alive.current && active.current === handle) setLoading(false); });
      }, [cacheKey, enabled, kit, ttlMs]);
      React.useEffect(() => {
        alive.current = true;
        if (enabled !== false) load();
        return () => {
          alive.current = false;
          opened.current = false;
          const handle = active.current;
          active.current = undefined;
          if (handle !== undefined) handle.release();
        };
      }, [load]);
      const open = React.useCallback(() => load(), [load]);
      const prefetch = React.useCallback(() => { prefetchWorkItemDetail(kit, params ?? {}, ttlMs); }, [kit, params, ttlMs]);
      const invalidate = React.useCallback(() => {
        workItemCacheClear(cacheKey);
        const handle = active.current;
        active.current = undefined;
        opened.current = false;
        if (handle !== undefined) handle.release();
        setData(undefined);
        setError(undefined);
        setLoading(false);
      }, [cacheKey]);
      return { data, error, loading, open, prefetch, invalidate };
    }

    /** 工作项胶囊组：kind / 状态 / owner / 分支 / 提交 / 链接统一展示；超过 6 个收成 +N。 */
    function WorkItemChips({ kit, item }) {
      const { t } = kit;
      if (item === undefined || item === null) return null;
      const kindLabel = WORK_ITEM_KIND_LABEL[item.kind];
      const chips = [];
      if (kindLabel !== undefined) chips.push(h('span', { key: 'kind', className: 'dshaSv_pill', 'data-tone': 'brand' }, t(kindLabel)));
      if (item.status !== undefined && item.status !== null && item.status.text !== undefined) {
        chips.push(h('span', { key: 'status', className: 'dshaSv_pill', 'data-tone': item.status.tone, title: item.status.title ?? item.status.text }, item.status.text));
      }
      if (item.id !== undefined && item.id !== null && item.id !== '') chips.push(h('span', { key: 'id', className: 'dshaSv_pill', 'data-mono': true, title: String(item.id) }, String(item.id)));
      if (item.owner) chips.push(h('span', { key: 'owner', className: 'dshaSv_metaChip', title: item.owner }, item.owner));
      if (item.branch) chips.push(h('span', { key: 'branch', className: 'dshaSv_metaChip', title: item.branch }, item.branch));
      if (item.commit) chips.push(h('span', { key: 'commit', className: 'dshaSv_metaChip', 'data-mono': true, title: item.commit }, String(item.commit).slice(0, 7)));
      if (item.link !== undefined && item.link !== null && item.link.url) {
        chips.push(h('a', { key: 'link', className: 'dshaSv_pill', href: item.link.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen') }, item.link.text));
      } else if (item.link !== undefined && item.link !== null && item.link.text) {
        chips.push(h('span', { key: 'link', className: 'dshaSv_pill' }, item.link.text));
      }
      const shown = chips.slice(0, 6);
      const more = chips.length - shown.length;
      return h('div', { className: 'dshaSv_workChips' }, ...shown, more > 0 ? h('span', { key: 'more', className: 'dshaSv_pill', title: String(more) }, '+' + more) : null);
    }

    /** 统一的详情抽屉：标题 + chips + 字段行 + 正文槽 + 动作槽 + 关闭；ESC / 遮罩关闭并还原焦点。 */
    function WorkItemDetail({ kit, item, fields, body, actions, onClose }) {
      const { t } = kit;
      const returnFocus = React.useRef(undefined);
      React.useEffect(() => {
        if (typeof document === 'undefined' || document === null) return undefined;
        returnFocus.current = document.activeElement;
        const onKey = (event) => { if (event !== null && event.key === 'Escape' && typeof onClose === 'function') onClose(); };
        if (typeof document.addEventListener === 'function') document.addEventListener('keydown', onKey);
        return () => {
          if (typeof document.removeEventListener === 'function') document.removeEventListener('keydown', onKey);
          const target = returnFocus.current;
          if (target !== undefined && target !== null && typeof target.focus === 'function') { try { target.focus(); } catch {} }
        };
      }, []);
      if (item === undefined || item === null) return null;
      const bodyNode = typeof body === 'function' ? body() : body;
      const actionsNode = typeof actions === 'function' ? actions() : actions;
      const close = () => { if (typeof onClose === 'function') onClose(); };
      return h('div', {
        className: 'dshaSv_workOverlay', role: 'presentation',
        onClick: (event) => { if (event !== null && event.target === event.currentTarget) close(); }
      },
      h('div', {
        className: 'dshaSv_workSheet', role: 'dialog', 'aria-modal': 'true',
        'aria-label': item.title ?? String(item.id ?? ''), tabIndex: -1,
        onKeyDown: (event) => { if (event !== null && event.key === 'Escape') { event.stopPropagation?.(); close(); } }
      },
      h('div', { className: 'dshaSv_workHead' },
        h(WorkItemChips, { kit, item }),
        h('span', { className: 'dshaSv_grow' }),
        h('button', { type: 'button', className: 'dshaSv_icon', title: t('workItemClose'), 'aria-label': t('workItemClose'), onClick: close }, '×')),
      item.title ? h('p', { className: 'dshaSv_workTitle', title: item.title }, item.title) : null,
      Array.isArray(fields) && fields.length > 0 ? h('div', { className: 'dshaSv_workFields' },
        ...fields.map((row, index) => h('div', { key: 'f' + index, className: 'dshaSv_workField' },
          h('span', { className: 'dshaSv_workFieldK' }, row[0]),
          h('div', { className: 'dshaSv_workFieldV' }, row[1])))) : null,
      bodyNode === undefined || bodyNode === null ? null : h('div', { className: 'dshaSv_workBody' }, bodyNode),
      actionsNode === undefined || actionsNode === null ? null : h('div', { className: 'dshaSv_workActs' }, actionsNode)));
    }

    /** 地图页：任务地图票子 + 本地票子（原「动态」的地图与票子区）。 */

    const remoteCache = new Map();
    const rememberRemote = (key, payload) => {
      const entry = { at: Date.now(), data: payload };
      remoteCache.set(key, entry);
      writeRemoteSnapshot(key, entry);
      while (remoteCache.size > 24) remoteCache.delete(remoteCache.keys().next().value);
    };

    /** 侧栏远端列表：拉一次 + 手动刷新；错误用文字，不静默。 */
    function useRemoteList(kit, query) {
      // query 是首屏参数；reload(true, override) 可换筛选条件（如 PR 的已关闭列表）。不传 override 时沿用上一次请求，
      // 这样「刷新」不会把已关闭视图拉回打开的列表；序号保证切页 / 连点时旧响应不覆盖新结果。
      const firstKey = JSON.stringify(query);
      const [data, setData] = React.useState(() => {
        const memory = remoteCache.get(firstKey);
        if (memory !== undefined) return memory.data;
        const saved = readRemoteSnapshot(firstKey);
        if (saved !== undefined) {
          remoteCache.set(firstKey, saved);
          return saved.data;
        }
        return undefined;
      });
      const [error, setError] = React.useState(undefined);
      const [busy, setBusy] = React.useState(false);
      const lastQuery = React.useRef(query);
      const seq = React.useRef(0);
      const load = React.useCallback((force, override) => {
        const next = override ?? lastQuery.current;
        lastQuery.current = next;
        const key = JSON.stringify(next);
        const current = ++seq.current;
        setBusy(true);
        kit.request('GET', undefined, force === true ? { ...next, force: 1 } : next).then(
          (payload) => { rememberRemote(key, payload); if (current === seq.current) { setData(payload); setError(undefined); } },
          (failure) => { if (current === seq.current) setError(kit.errorText(kit.t, failure)); }
        ).finally(() => { if (current === seq.current) setBusy(false); });
      }, []);
      React.useEffect(() => { load(false); }, []);
      return { data, error, busy, reload: load };
    }


    /* ---------------------------------------------------------------- 模型选择（交接页与设置页共用） */

    // 模型目录按会话缓存 30 秒：交接页和设置页来回切时不重复请求；保存角色模型后主动失效
    const MODEL_CACHE_MS = 30000;
    const modelsCache = new Map();
    function useModelsView(kit, sessionId, enabled = true, refreshKey = 0) {
      const key = String(sessionId ?? '');
      const cached = modelsCache.get(key);
      const [data, setData] = React.useState(cached?.value);
      React.useEffect(() => {
        if (!enabled) return undefined;
        const hit = modelsCache.get(key);
        if (hit !== undefined && Date.now() - hit.at < MODEL_CACHE_MS) { setData(hit.value); return undefined; }
        let alive = true;
        kit.request('GET', undefined, { view: 'models', ...(key === '' ? {} : { session: key }) }).then(
          (payload) => { const value = payload?.models ?? null; modelsCache.set(key, { at: Date.now(), value }); if (alive) setData(value); },
          () => { if (alive) setData(null); });
        return () => { alive = false; };
      }, [kit, key, enabled, refreshKey]);
      return data;
    }
    /** 表单值 → 原生 select 的字符串：'follow' | 'default' | 'p:<provider>\u0001<model>'。 */
    function modelSelectValue(value) {
      if (value === 'default') return 'default';
      if (value && typeof value === 'object' && typeof value.provider === 'string' && typeof value.model === 'string') return 'p:' + value.provider + '\u0001' + value.model;
      return 'follow';
    }
    /** 原生 select 的值 → 表单值；选具体模型时带上目录里的默认推理强度。 */
    function modelChoiceOf(raw, data) {
      if (raw === 'default') return 'default';
      if (raw === 'follow') return 'follow';
      const text = String(raw ?? '');
      if (!text.startsWith('p:')) return 'follow';
      const [provider, model] = text.slice(2).split('\u0001');
      if (provider === undefined || model === undefined) return 'follow';
      const group = (data?.catalog?.groups ?? []).find((item) => item.id === provider);
      const meta = group?.models?.find((item) => item.id === model);
      return { provider, model, ...(meta?.defaultEffort ? { reasoningEffort: meta.defaultEffort } : {}) };
    }
    /** 表单值 → 请求体字段：跟随（默认）不带字段；'default' 传字符串；具体模型传对象。 */
    function modelField(value) {
      return value === 'default' ? { model: 'default' } : value && typeof value === 'object' ? { model: value } : {};
    }
    /** 插件风格的下拉：按钮 + 浮层列表（原生 select 在 Android WebView 里整屏弹出、样式不受控）。 */
    function PopoverPicker({ value, rows, onSelect, disabled, ariaLabel }) {
      const [open, setOpen] = React.useState(false);
      const [active, setActive] = React.useState(0);
      const box = React.useRef(null);
      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false); };
        document.addEventListener('pointerdown', onDown, true);
        return () => document.removeEventListener('pointerdown', onDown, true);
      }, [open]);
      const selectable = rows.filter((row) => row.kind !== 'group');
      const current = selectable.find((row) => row.key === value)?.label ?? '';
      const activeKey = selectable[Math.min(active, Math.max(0, selectable.length - 1))]?.key;
      const choose = (row) => { if (row === undefined) return; onSelect(row.key); setOpen(false); };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { setOpen(true); return; }
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          setActive((prev) => Math.min(selectable.length - 1, Math.max(0, prev + delta)));
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!open) { setOpen(true); return; }
          choose(selectable.find((row) => row.key === activeKey));
        }
      };
      return h('div', { className: 'dshaSv_picker', ref: box, 'data-open': open ? 'true' : 'false' },
        h('button', {
          type: 'button', className: 'dshaSv_pickerBtn', disabled, 'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-label': ariaLabel,
          onClick: () => setOpen(!open), onKeyDown
        }, h('span', { className: 'dshaSv_pickerNow' }, current), h('span', { className: 'dshaSv_caret', 'aria-hidden': true }, '▾')),
        open ? h('div', { className: 'dshaSv_pickerPop', role: 'listbox' },
          ...rows.map((row) => row.kind === 'group'
            ? h('p', { key: 'g:' + row.key, className: 'dshaSv_pickerGroup' }, row.label)
            : h('button', {
                key: row.key, type: 'button', role: 'option', className: 'dshaSv_pickerItem',
                'aria-selected': row.key === value ? 'true' : 'false',
                'data-active': row.key === activeKey ? 'true' : undefined,
                onClick: () => choose(row)
              }, h('span', { className: 'dshaSv_pickerTick', 'aria-hidden': true }, row.key === value ? '✓' : ''), h('span', null, row.label)))) : null);
    }

    /** 模型选择：插件自绘浮层；同一模型在多个服务商下出现时补上 provider 名，避免两条一模一样的选项。 */
    function ModelSelect({ kit, data, value, onChange, followLabel, disabled, allowFollow = true }) {
      const { t } = kit;
      if (data === undefined) return h('span', { className: 'dshaSv_muted', role: 'status' }, t('modelLoading'));
      if (data === null || data.supported === false || data.catalog === undefined || data.catalog === null) {
        return h('span', { className: 'dshaSv_muted' }, t('modelUnsupported'));
      }
      const catalog = data.catalog;
      const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
      const duplicates = new Map();
      for (const group of groups) for (const item of group.models ?? []) duplicates.set(item.id, (duplicates.get(item.id) ?? 0) + 1);
      const labelOf = (group, item) => {
        const base = item.name && item.name !== item.id ? `${item.name}（${item.id}）` : item.id;
        if ((duplicates.get(item.id) ?? 0) <= 1) return base;
        const provider = group.name || group.id;
        return item.name && item.name !== item.id ? `${item.name}（${item.id} · ${provider}）` : `${item.id} · ${provider}`;
      };
      const defaultText = data.labels?.default ? kit.format(t('modelGlobalDefault'), { v: data.labels.default }) : t('modelGlobalDefaultBare');
      const followText = followLabel ? kit.format(t('modelFollowIs'), { v: followLabel }) : t('modelFollow');
      const rows = [];
      if (allowFollow) rows.push({ key: 'follow', label: followText });
      rows.push({ key: 'default', label: defaultText });
      for (const group of groups) {
        rows.push({ key: 'g:' + group.id, kind: 'group', label: group.name || group.id });
        for (const item of group.models ?? []) rows.push({ key: 'p:' + group.id + '\u0001' + item.id, label: labelOf(group, item) });
      }
      return h(PopoverPicker, {
        value: modelSelectValue(value), rows, disabled, ariaLabel: t('modelLabel'),
        onSelect: (key) => onChange(modelChoiceOf(key, data))
      });
    }

    /**
     * 推理强度（思考深度）：具体模型支持时才给一排分段按钮。
     * 没选具体模型时只提示先选模型；「默认」清掉显式强度，交给模型自己的默认值。
     */
    function ModelEffort({ kit, data, value, onChange, disabled }) {
      const { t } = kit;
      const picked = value && typeof value === 'object' ? value : undefined;
      const groups = data?.catalog?.groups ?? [];
      if (picked === undefined) {
        return data?.catalog?.default
          ? h('p', { className: 'dshaSv_muted', role: 'status', title: t('modelEffortPickModelHint') }, t('modelEffortPickModel'))
          : null;
      }
      const group = groups.find((item) => item.id === picked.provider);
      const meta = group?.models?.find((item) => item.id === picked.model);
      const efforts = meta?.efforts ?? [];
      if (efforts.length === 0) return null;
      const setEffort = (effort) => onChange({ provider: picked.provider, model: picked.model, ...(effort ? { reasoningEffort: effort } : {}) });
      return h('div', { className: 'dshaSv_row' },
        h('span', { className: 'dshaSv_muted' }, t('modelEffort')),
        h('div', { className: 'dshaSv_filters', role: 'group', 'aria-label': t('modelEffort') },
          h('button', {
            type: 'button', className: 'dshaSv_chipF', disabled,
            'aria-pressed': (picked.reasoningEffort ?? '') === '', title: t('modelEffortDefault'),
            onClick: () => setEffort('')
          }, t('modelEffortAuto')),
          ...efforts.map((effort) => h('button', {
            key: effort.id, type: 'button', className: 'dshaSv_chipF', disabled,
            'aria-pressed': picked.reasoningEffort === effort.id,
            title: meta?.defaultEffort === effort.id ? kit.format(t('modelEffortDefaultIs'), { v: effort.name || effort.id }) : (effort.name || effort.id),
            onClick: () => setEffort(effort.id)
          }, effort.name || effort.id))));
    }

    /** 设置 → 版本线：编辑本工作区的版本线公告（与 /relay line 同一存储）。 */

    /* ---------------------------------------------------------------- 票子驾驶舱（T15） */

    const TICKET_STAGES = ['triage', 'ready', 'doing', 'review'];
    const TICKET_STAGE_LABEL_KEY = {
      triage: 'ticketStageTriage', ready: 'ticketStageReady', doing: 'ticketStageDoing', review: 'ticketStageReview'
    };

    /**
     * 票子驾驶舱：holder / 分支 / 工作树 / 最近汇报 + 服务端 gates 的一行判定，
     * 动作有「拉起会话 / 打开会话 / 唤醒 / 技能选择 / 别称 / 模型 / 阶段」，审批可选。
     * 只发 settings-route 的用户动作：不跑 git、不跑 gh、不 push。
     */
    function TicketCockpit({ kit, task, skills, entries, act, busy = false, sessionId, withApproval = true, onCopied }) {
      const { t } = kit;
      const gates = task === undefined || task === null ? undefined : task.gates;
      const taskId = task === undefined || task === null ? '' : String(task.id ?? '');
      const [alias, setAlias] = React.useState(taskId.toLowerCase());
      const [skill, setSkill] = React.useState(gates?.skill?.name ?? (skills?.defaultSkill ?? 'relay-worker'));
      const [model, setModel] = React.useState(undefined);
      const [note, setNote] = React.useState('');
      const [launching, setLaunching] = React.useState(false);
      const models = useModelsView(kit, sessionId, true);
      if (gates === undefined || gates === null) return null;
      const holderEntry = task.owner === undefined ? undefined : (Array.isArray(entries) ? entries.find((entry) => entry.sessionId === task.owner) : undefined);
      const launchState = task.launch ?? {};
      const branch = launchState.branch ?? holderEntry?.checkout?.branch ?? holderEntry?.branch ?? null;
      const worktree = launchState.worktree ?? task.worktree ?? holderEntry?.checkout?.worktree ?? null;
      const lastReport = holderEntry?.summary ?? null;
      const stageLabel = (value) => (value ? t(TICKET_STAGE_LABEL_KEY[value] ?? value) : t('ticketStageUnset'));
      const approvalKey = { pending: 'ticketApprovalPending', approved: 'ticketApprovalApproved', rejected: 'ticketApprovalRejected' }[gates.approval.value];
      const skillRows = (Array.isArray(skills?.list) ? skills.list : []).map((item) => ({ key: item.name, label: item.name + (item.source === 'project' ? ' · ' + t('ticketSkillProject') : '') }));
      const skillRow = { key: skill, label: skill };
      const chosenSkills = skillRows.some((row) => row.key === skill) ? skillRows : [skillRow, ...skillRows];
      const pill = (key, tone, text, title) => h('span', { key, className: 'dshaSv_pill', 'data-tone': tone, title: title ?? text }, text);
      const checks = [];
      checks.push(pill('deps', gates.deps.ok ? 'ok' : 'warn',
        gates.deps.ok ? kit.format(t('ticketDepsOk'), { ended: gates.deps.ended, total: gates.deps.total }) : kit.format(t('ticketDepsWait'), { ids: gates.deps.pending.map((item) => item.id).join('、') }),
        gates.deps.pending.map((item) => item.id + (item.title ? ' ' + item.title : '')).join('、') || undefined));
      const holderTone = gates.holder.state === 'live' ? 'ok' : gates.holder.state === 'stale' || gates.holder.state === 'unknown' ? 'warn' : gates.holder.state === 'dead' ? 'error' : undefined;
      const holderText = gates.holder.sessionId === null || gates.holder.sessionId === undefined ? t('ticketHolderNone')
        : (gates.holder.state === 'live' ? t('ticketHolderLive') : gates.holder.state === 'stale' ? t('ticketHolderStale') : gates.holder.state === 'dead' ? t('ticketHolderDead') : t('ticketHolderUnknown'));
      checks.push(pill('holder', holderTone, t('ticketHolder') + '：' + holderText, gates.holder.why ?? holderText));
      checks.push(pill('stage', gates.stage.ok ? 'ok' : 'warn', t('ticketStageTitle') + '：' + stageLabel(gates.stage.value), gates.stage.reason));
      checks.push(pill('approval', gates.approval.ok ? undefined : 'warn', t('ticketApproval') + '：' + (approvalKey === undefined ? t('ticketApprovalNone') : t(approvalKey)), gates.approval.reason));
      checks.push(pill('skill', gates.skill.exists ? 'ok' : 'warn', t('ticketSkill') + '：' + gates.skill.name, gates.skill.reason));
      if (gates.holder.sessionId !== null && gates.holder.sessionId !== undefined) {
        checks.push(pill('merge', gates.merge.approved ? 'ok' : undefined,
          gates.merge.stale ? t('ticketMergeStale') : gates.merge.approved ? kit.format(t('ticketMergeApproved'), { sha: String(gates.merge.sha ?? '').slice(0, 7) }) : t('ticketMergeNone')));
      }
      if (gates.release.tag) checks.push(pill('release', gates.release.released ? 'ok' : undefined, kit.format(t('ticketReleaseTag'), { tag: gates.release.tag })));
      const run = (body) => {
        if (typeof act !== 'function' || busy === true) return Promise.resolve(undefined);
        return act(body);
      };
      const openHolder = () => { if (gates.holder.sessionId !== null && gates.holder.sessionId !== undefined && typeof kit.openSession === 'function') kit.openSession(gates.holder.sessionId); };
      const launchNow = () => {
        if (!gates.launch.allowed || launching) return;
        setLaunching(true);
        Promise.resolve(run({
          action: 'ticket-launch', task: taskId,
          ...(alias.trim() === '' ? {} : { alias: alias.trim() }),
          ...(skill === '' ? {} : { skill }),
          ...modelField(model)
        })).then((payload) => {
          setLaunching(false);
          const created = payload?.result?.sessionId;
          if (typeof created === 'string' && created !== '' && typeof kit.openSession === 'function') kit.openSession(created);
        }, () => setLaunching(false));
      };
      const stageButtons = gates.ended ? null : h('div', { className: 'dshaSv_stageRow', role: 'group', 'aria-label': t('ticketStageTitle') },
        ...TICKET_STAGES.map((key) => h('button', {
          key, type: 'button', className: 'dshaSv_btn', 'data-primary': gates.stage.value === key ? true : undefined,
          'aria-pressed': gates.stage.value === key ? 'true' : 'false', disabled: busy === true || gates.stage.value === key,
          onClick: (event) => { event?.stopPropagation?.(); void run({ action: 'ticket-stage', task: taskId, stage: key }); }
        }, stageLabel(key))));
      const approvalBox = withApproval && !gates.ended && (gates.approval.value === 'pending' || gates.stage.value === 'review')
        ? h('div', { className: 'dshaSv_launchBox' },
          h('div', { className: 'dshaSv_row' },
            h('input', {
              className: 'dshaSv_input', style: { flex: '1 1 8em' }, value: note, maxLength: 200,
              placeholder: t('taskApprovalNote'), 'aria-label': t('taskApprovalNote'),
              onChange: (event) => setNote(event.target.value)
            }),
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy === true, onClick: (event) => { event?.stopPropagation?.(); void run({ action: 'task-approval', id: taskId, approved: true, ...(note.trim() === '' ? {} : { note: note.trim() }) }); } }, t('taskApprove')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy === true, onClick: (event) => { event?.stopPropagation?.(); void run({ action: 'task-approval', id: taskId, approved: false, ...(note.trim() === '' ? {} : { note: note.trim() }) }); } }, t('taskReject'))),
          h('p', { className: 'dshaSv_cockpitHint' }, t('ticketApprovalHint')))
        : null;
      const canWake = gates.wake.allowed === true && gates.holder.sessionId !== null && gates.holder.sessionId !== undefined;
      const launchBox = gates.ended ? null : h('div', { className: 'dshaSv_launchBox' },
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_muted' }, t('ticketAlias')),
          h('input', {
            className: 'dshaSv_input', style: { maxWidth: '8em' }, value: alias, maxLength: 32,
            'aria-label': t('ticketAlias'), onChange: (event) => setAlias(event.target.value)
          }),
          h(PopoverPicker, { value: skill, rows: chosenSkills, onSelect: setSkill, disabled: busy === true, ariaLabel: t('ticketSkill') }),
          h(ModelSelect, { kit, data: models, value: model, onChange: setModel, disabled: busy === true })),
        h('div', { className: 'dshaSv_row' },
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy === true || launching || !gates.launch.allowed, title: gates.launch.reason ?? undefined, onClick: (event) => { event?.stopPropagation?.(); launchNow(); } },
            launching ? t('ticketLaunching') : t('ticketLaunch')),
          gates.holder.sessionId !== null && gates.holder.sessionId !== undefined ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy === true, onClick: (event) => { event?.stopPropagation?.(); openHolder(); } }, t('ticketOpenSession')) : null,
          gates.holder.sessionId !== null && gates.holder.sessionId !== undefined ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy === true || !canWake, title: gates.wake.reason ?? undefined, onClick: (event) => { event?.stopPropagation?.(); void run({ action: 'wake', target: gates.holder.sessionId, force: 'resume' }); } }, t('ticketWake')) : null),
        !gates.launch.allowed ? h('p', { className: 'dshaSv_alert dshaSv_cockpitHint', 'data-tone': 'warn', role: 'status' }, kit.format(t('ticketLaunchBlocked'), { reason: gates.launch.reason ?? '' })) : null,
        h('p', { className: 'dshaSv_cockpitHint' }, t('ticketCockpitHint')));
      const holdersLine = gates.holder.sessionId !== null && gates.holder.sessionId !== undefined
        ? h('button', { type: 'button', className: 'dshaSv_link', onClick: (event) => { event?.stopPropagation?.(); openHolder(); } }, t('ticketHolder') + '：' + (gates.holder.label ?? kit.shortId(gates.holder.sessionId)))
        : h('span', { className: 'dshaSv_muted' }, t('ticketHolder') + '：' + t('ticketNoHolder'));
      return h('section', { className: 'dshaSv_cockpit', 'data-task': taskId },
        h('div', { className: 'dshaSv_cockpitHead' },
          h('span', { className: 'dshaSv_h' }, t('ticketTitle')),
          h('span', { className: 'dshaSv_grow' }),
          gates.ended ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('ticketReadOnly')) : null),
        h('div', { className: 'dshaSv_checks', role: 'group', 'aria-label': t('ticketChecks') }, ...checks),
        h('div', { className: 'dshaSv_cockpitGrid' },
          h('div', { className: 'dshaSv_row' }, holdersLine),
          h('p', { className: 'dshaSv_muted' }, t('ticketBranch') + '：' + (branch ?? '—'), ' · ', t('ticketWorktree') + '：' + (worktree ?? '—')),
          lastReport ? h('p', { className: 'dshaSv_muted dshaSv_sum', title: lastReport }, t('ticketLastReport') + '：', ...(richSummary(lastReport) ?? [])) : null),
        stageButtons,
        approvalBox,
        launchBox);
    }

      return {
        Card, CopyId, stop, keep, richLines, richSummary, BackMore, SyncStatus,
        WorkItemChips, WorkItemDetail, useLazyDetail, prefetchWorkItemDetail, workItemTabKey, workItemCacheClear, WORK_ITEM_TTL_MS,
        TicketCockpit,
        useRemoteList, PopoverPicker, ModelSelect, ModelEffort, useModelsView, modelField, modelsCache, modelSelectValue
      };
    }

    return { KIT_VERSION: 43, make };
  }
});
