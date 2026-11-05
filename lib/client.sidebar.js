window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.js',
  factory: (require) => {
    'use strict';
    /*
     * 右侧边栏「协作」标签的正文：只在用户打开这个标签时才下载执行。
     * 不能同步 require 别的 client*.js：文案、请求、复制等由入口经 kit 传入。
     * 样式也在这里，标签挂载时注入、全部卸载后移除；只用 --dsw-alias-* 主题变量，
     * 不用 backdrop-filter，不做常驻动画。只在标签可见、页面可见时轮询。
     */
    const React = require('react');
    const h = React.createElement;
    const POLL_MS = 20000;
    // 数据新鲜度：超过 5 分钟变黄、30 分钟变红（轮询停了或接口一直失败时看得出来）
    const STALE_WARN_MS = 5 * 60000;
    const STALE_ERROR_MS = 30 * 60000;
    // 上次拿到的看板（按会话）：重开标签先画它，再后台刷新
    const lastBoards = new Map();
    // 筛选与各折叠的开合：记在本机，切换会话、重开标签后保持（每个会话的侧栏是各自的组件实例）
    const UI_KEY = 'dshaSv.ui.v1';
    let uiCache;
    function readUi() {
      if (uiCache !== undefined) return uiCache;
      try { const value = JSON.parse(window.localStorage.getItem(UI_KEY) || '{}'); uiCache = value && typeof value === 'object' ? value : {}; } catch { uiCache = {}; }
      return uiCache;
    }
    function usePersisted(name, initial) {
      const [value, setValue] = React.useState(() => { const saved = readUi()[name]; return saved === undefined ? initial : saved; });
      const set = React.useCallback((next) => {
        setValue(next);
        const ui = readUi();
        ui[name] = next;
        try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
      }, [name]);
      return [value, set];
    }
    const memo = (component) => (typeof React.memo === 'function' ? React.memo(component) : component);
    const STYLE_ID = 'dsh-session-relay/sidebar.css';

    const css = [
      '.dshaSv{--accent:var(--dsw-alias-button-info-fill,var(--dsw-alias-link,#4176e6));--accent-hover:var(--dsw-alias-button-info-hover,var(--accent));box-sizing:border-box;height:100%;overflow:auto;display:grid;align-content:start;gap:12px;padding:10px 12px 20px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;container-type:inline-size}',
      '.dshaSv p{margin:0}',
      '.dshaSv_bar{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dshaSv_grow{flex:1;min-width:0}',
      '.dshaSv_ws{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 10px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_ago{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
      '.dshaSv_btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dshaSv_btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_btn[data-primary]{border-color:transparent;background:var(--accent);color:#fff;font-weight:600}',
      '.dshaSv_btn[data-primary]:hover{background:var(--accent-hover)}',
      '.dshaSv_icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshaSv_icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_btn:focus-visible,.dshaSv_icon:focus-visible,.dshaSv_card:focus-visible,.dshaSv_chipF:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_filters{display:flex;flex-wrap:wrap;gap:6px}',
      '.dshaSv_chipF{height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
      '.dshaSv_chipF[aria-pressed=true]{border-color:var(--accent);color:var(--accent);font-weight:600}',
      '.dshaSv_h{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}',
      '.dshaSv_sec{display:grid;gap:6px}',
      '.dshaSv_list{display:grid;gap:6px}',
      '.dshaSv_card{position:relative;display:grid;gap:6px;padding:9px 10px 9px 13px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;overflow:hidden}',
      '.dshaSv_card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--dsw-alias-border-l2)}',
      '.dshaSv_card:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_card[data-tone=warn]::before{background:var(--dsw-alias-state-warn-primary)}',
      '.dshaSv_card[data-tone=error]::before{background:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_card[data-tone=ok]::before{background:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_card[data-tone=brand]::before{background:var(--accent)}',
      '.dshaSv_card[data-tone=muted]{opacity:.7}',
      '.dshaSv_row{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_title{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_sum{color:var(--dsw-alias-label-secondary);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dshaSv_pills{display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0}',
      '.dshaSv_pill{display:inline-flex;align-items:center;height:20px;max-width:100%;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_pill[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshaSv_pill[data-tone=warn]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
      '.dshaSv_pill[data-tone=error]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_pill[data-tone=ok]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_pill[data-tone=brand]{border-color:var(--accent);color:var(--accent)}',
      '.dshaSv_state{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l2))}',
      '.dshaSv_state[data-state=running]{background:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_state[data-state=idle]{background:var(--dsw-alias-state-idle-primary)}',
      '.dshaSv_star{color:var(--dsw-alias-state-warn-primary);flex:none;display:inline-flex}',
      '.dshaSv_link{justify-self:start;padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:12px;cursor:pointer}',
      '.dshaSv_task{display:flex;align-items:center;gap:6px;min-width:0;padding:3px 0}',
      '.dshaSv_task .dshaSv_grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dshaSv_alert{padding:6px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:6px;color:var(--dsw-alias-state-warn-primary);font-size:12px}',
      '.dshaSv_alert[data-tone=error]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_hr{height:1px;background:var(--dsw-alias-border-l1)}',
      '.dshaSv_kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:12px}',
      '.dshaSv_kv dt{color:var(--dsw-alias-label-secondary)}',
      '.dshaSv_kv dd{margin:0;min-width:0;overflow-wrap:anywhere}',
      '.dshaSv_crumb{color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_big{font-size:15px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}',
      '.dshaSv_chipF{display:inline-flex;align-items:center;gap:4px}',
      '.dshaSv_chipF b{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshaSv_chipF[data-tone=warn] b{color:var(--dsw-alias-state-warn-primary)}',
      '.dshaSv_chipF[data-tone=ok] b{color:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_chipF[aria-pressed=true] b{color:var(--accent)}',
      '.dshaSv_main{padding:6px 8px;border-radius:8px;border-left:3px solid var(--accent);background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
      '.dshaSv_main:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_main:focus-visible,.dshaSv_line:focus-visible,.dshaSv_link:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_line{display:flex;gap:8px;align-items:baseline;min-width:0;padding:0;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.dshaSv_lineK{flex:none;font-weight:600}',
      '.dshaSv_lineV{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_line[data-open] .dshaSv_lineV{white-space:pre-wrap;word-break:break-word}',
      '.dshaSv_ask{display:grid;gap:6px;padding:8px 10px;border:1px solid var(--accent);border-radius:8px}',
      '.dshaSv_askQ{white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshaSv_alert.dshaSv_row{padding:4px 4px 4px 10px}',
      '.dshaSv_btn:disabled{opacity:.5;cursor:default}',
      '.dshaSv_ago[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}',
      '.dshaSv_ago[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_icon[data-flash=ok]{color:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_icon[data-flash=fail]{color:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_skel{height:72px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '@media (pointer:coarse){.dshaSv_btn{height:32px}.dshaSv_icon{width:32px;height:32px}.dshaSv_chipF{height:30px}}'
    ].join('');

    let styleUsers = 0;
    let styleTag;
    function useStyle() {
      React.useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        styleUsers += 1;
        if (styleTag === undefined || !styleTag.isConnected) {
          // 热更新后旧代码留下的同名标签换成新的样式文本
          document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']')?.remove();
          styleTag = document.createElement('style');
          styleTag.dataset.plugin = 'dsh-session-relay';
          styleTag.dataset.pluginCss = STYLE_ID;
          styleTag.textContent = css;
          document.head.appendChild(styleTag);
        }
        return () => {
          styleUsers -= 1;
          if (styleUsers <= 0) { styleUsers = 0; styleTag?.remove(); styleTag = undefined; }
        };
      }, []);
    }

    /* 小图标：16px 线条，跟随文字颜色 */
    const svg = (d, size = 14) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d }));
    const IconRefresh = () => svg('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3');
    const IconCopy = () => svg('M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z');
    const IconBack = () => svg('M10 3.5 5.5 8l4.5 4.5');
    const IconOpen = () => svg('M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3', 12);
    const IconStar = () => h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true }, h('path', { d: 'M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.1l-3.9 2.2.9-4.3-3.3-3 4.4-.5z' }));

    /* 分组：以服务端按事实给的 category 为准，没有时按汇报状态推 */
    function categoryOf(entry) {
      if (typeof entry.category === 'string') return entry.category;
      if ((entry.status === 'question' || entry.status === 'blocked') && !entry.answered) return 'attention';
      if (entry.status === 'ready') return 'ready';
      if (entry.status === 'done' || entry.status === 'abandoned') return 'archived';
      return 'active';
    }
    const CATEGORY_LABEL = { attention: 'catAttention', ready: 'catReady', active: 'catActive', idle: 'catIdle', blank: 'catBlank', archived: 'sideFDone' };
    /* 状态 → 颜色语气 */
    function toneOf(entry) {
      const category = categoryOf(entry);
      if (category === 'attention') return entry.status === 'blocked' ? 'error' : 'warn';
      if (category === 'ready') return 'ok';
      if (category === 'active') return 'brand';
      if (category === 'archived') return 'muted';
      return undefined;
    }
    const isAttention = (entry) => categoryOf(entry) === 'attention';
    const isReady = (entry) => categoryOf(entry) === 'ready';
    const isDone = (entry) => categoryOf(entry) === 'archived';
    const isActive = (entry) => categoryOf(entry) === 'active';
    // 状态胶囊：空白 / 久未活动显示分组名，不显示可能过时的汇报状态
    const pillText = (kit, entry) => {
      const category = categoryOf(entry);
      if (category === 'blank' || category === 'idle') return kit.t(CATEGORY_LABEL[category]);
      return kit.statusText(kit.t, entry.status) || kit.t(CATEGORY_LABEL[category] ?? 'catActive');
    };
    const FILTERS = [
      ['all', 'sideFAll', () => true],
      ['attention', 'sideFAttention', isAttention],
      ['active', 'sideFActive', isActive],
      ['ready', 'sideFReady', isReady],
      ['done', 'sideFDone', isDone]
    ];

    function agoText(t, format, at, now) {
      if (!Number.isFinite(at)) return '';
      const minutes = Math.floor(Math.max(0, now - at) / 60000);
      if (minutes < 1) return t('sideJustNow');
      if (minutes < 60) return format(t('sideMinAgo'), { n: minutes });
      return format(t('sideHourAgo'), { n: Math.floor(minutes / 60) });
    }

    function useVisible(useTabInfo) {
      let visible = true;
      try { const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined; if (info?.tab && info.tab.visible === false) visible = false; } catch {}
      return visible;
    }

    function useBoard(kit, sessionId, visible) {
      const [state, setState] = React.useState(() => lastBoards.get(sessionId) ?? { board: undefined, error: undefined, at: undefined });
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        if (!visible || typeof sessionId !== 'string' || sessionId === '') return undefined;
        let alive = true;
        let controller;
        const load = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          controller?.abort?.();
          controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          kit.request('GET', undefined, { view: 'board', session: sessionId }, controller?.signal).then(
            (payload) => {
              if (!alive || !Array.isArray(payload.entries)) return;
              setState((prev) => {
                // 内容没变的条目沿用旧对象，卡片（memo）就不重画
                const old = new Map((prev.board?.entries ?? []).map((entry) => [entry.sessionId, entry]));
                const entries = payload.entries.map((entry) => { const before = old.get(entry.sessionId); return before !== undefined && JSON.stringify(before) === JSON.stringify(entry) ? before : entry; });
                const next = { board: { ...payload, entries }, error: undefined, at: Date.now() };
                lastBoards.set(sessionId, next);
                if (lastBoards.size > 8) lastBoards.delete(lastBoards.keys().next().value);
                return next;
              });
            },
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ ...prev, error: kit.errorText(kit.t, error) })); });
        };
        load();
        const timer = setInterval(load, POLL_MS);
        return () => { alive = false; clearInterval(timer); controller?.abort?.(); };
      }, [kit, sessionId, visible, tick]);
      return [state, () => setTick((value) => value + 1)];
    }

    /* 卡片：整张可点（键盘 Enter / 空格），里面的按钮不冒泡 */
    function Card({ tone, onOpen, label, children }) {
      return h('div', {
        className: 'dshaSv_card', 'data-tone': tone, role: 'button', tabIndex: 0, 'aria-label': label,
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

    const EntryCard = memo(function EntryCard({ kit, entry, onSelect, copied, onCopied }) {
      const { t } = kit;
      const tone = toneOf(entry);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      return h(Card, { tone, onOpen: () => onSelect(entry.sessionId), label: name },
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone }, pillText(kit, entry)),
          h('span', { className: 'dshaSv_title', title: entry.title ?? name }, name),
          h('span', { className: 'dshaSv_state', 'data-state': entry.state, title: kit.stateText(t, entry.state) })),
        entry.summary ? h('p', { className: 'dshaSv_sum' }, entry.summary) : null,
        h('div', { className: 'dshaSv_row' },
          h('div', { className: 'dshaSv_pills' },
            h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.shortId(entry.sessionId)),
            entry.answered ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('answered')) : null,
            entry.queue ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, kit.format(t('queueNo'), { n: entry.queue })) : null,
            entry.branch ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: entry.branch }, entry.branch) : null,
            entry.commit ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, String(entry.commit).slice(0, 7)) : null,
            (entry.conflicts?.length ?? 0) > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': 'error' }, '⚠ ' + entry.conflicts.length) : null),
          h(CopyId, { kit, sessionId: entry.sessionId, copied, onCopied }),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, onClick: stop(() => kit.openSession(entry.sessionId)) }, h(IconOpen), t('openSession'))));
    });
    // 只把与本卡片有关的复制状态传下去：别的卡片复制时这张不重画
    const copiedFor = (copied, id) => (copied === id || copied === 'fail:' + id ? copied : undefined);

    /** 读取中占位：与卡片同高的三行，内容出来时不跳。 */
    function Skeleton() {
      return h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' })));
    }

    function Detail({ kit, entry, board, onBack, copied, onCopied }) {
      const { t } = kit;
      const tone = toneOf(entry);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      const rows = [
        ['sideState', kit.stateText(t, entry.state)],
        ['sideModel', entry.model],
        ['sideUpdated', kit.formatTime(entry.updatedAt)],
        ['sideBranch', entry.branch],
        ['sideCommit', entry.commit],
        ['sideQueue', entry.queue ? '#' + entry.queue : undefined],
        ['sideAssigned', entry.assigned]
      ].filter(([, value]) => value);
      const issues = [
        ...(entry.conflicts ?? []).map((item) => kit.format(t('sideOverlap'), { label: item.label, paths: (item.paths ?? []).join('、') })),
        ...(entry.declarationIssues ?? [])
      ];
      const decl = entry.declaration;
      return h('div', { className: 'dshaSv' },
        h('div', { className: 'dshaSv_bar' },
          h('button', { type: 'button', className: 'dshaSv_btn', onClick: onBack }, h(IconBack), t('sideBack')),
          h('span', { className: 'dshaSv_crumb dshaSv_grow' }, `${board.workspace?.title ?? ''} / ${name}`)),
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.shortId(entry.sessionId)),
          h('span', { className: 'dshaSv_grow' }),
          h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone }, '● ' + pillText(kit, entry))),
        h('p', { className: 'dshaSv_big' }, entry.title ?? name),
        h('p', { className: 'dshaSv_muted' }, [name, kit.stateText(t, entry.state), kit.formatTime(entry.updatedAt)].filter(Boolean).join(' · ')),
        entry.question && (entry.status === 'question' || entry.status === 'blocked')
          ? h('p', { className: 'dshaSv_alert', 'data-tone': entry.status === 'blocked' ? 'error' : undefined }, kit.format(t('question'), { v: entry.question })) : null,
        h('div', { className: 'dshaSv_bar' },
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, onClick: () => kit.openSession(entry.sessionId) }, h(IconOpen), t('openSession')),
          h(CopyId, { kit, sessionId: entry.sessionId, copied, onCopied })),
        h('div', { className: 'dshaSv_hr' }),
        entry.summary ? h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_h' }, t('sideDetailSummary')), h('p', null, entry.summary)) : null,
        rows.length > 0 ? h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_h' }, t('sideDetailInfo')),
          h('dl', { className: 'dshaSv_kv' }, ...rows.flatMap(([key, value]) => [h('dt', { key: key + 'k' }, t(key)), h('dd', { key: key + 'v' }, String(value))]))) : null,
        entry.files ? h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_h' }, t('sideDetailFiles')), h('p', { className: 'dshaSv_muted' }, entry.files)) : null,
        decl ? h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_h' }, t('sideDetailDecl')),
          h('p', { className: 'dshaSv_muted' }, [decl.rel, decl.mergeLabel, decl.build, decl.phase].filter(Boolean).join(' · '))) : null,
        issues.length > 0 ? h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_h' }, t('sideDetailIssues')),
          ...issues.map((text, index) => h('p', { key: index, className: 'dshaSv_alert', 'data-tone': 'error' }, text))) : null);
    }

    /** 顶栏身份胶囊：当前 GitHub 账号；锁定的账号不在就标红（详情和操作在设置页）。 */
    function GitHubPill({ kit, github }) {
      if (!github || github.state === null || github.state === undefined || github.state === 'unavailable') return null;
      const { t } = kit;
      const bad = github.match === 'mismatch' || (github.match === 'missing' && github.pinned);
      const tone = bad ? 'error' : github.match === 'ok' ? 'ok' : github.state === 'ready' ? undefined : 'warn';
      const text = github.state === 'ready' ? '@' + github.login : t('ghPillOut');
      const title = github.match === 'mismatch' ? kit.format(t('ghPillMismatch'), { login: github.login, pinned: github.pinned?.login ?? '' })
        : github.match === 'ok' ? kit.format(t('ghPillPinned'), { login: github.login })
        : github.state === 'ready' ? kit.format(t('ghPillUnpinned'), { login: github.login }) : t('ghPillOutHint');
      return h('span', { className: 'dshaSv_pill', 'data-tone': tone, title, 'aria-label': title, role: bad ? 'alert' : undefined }, bad ? '⚠ ' + text : text);
    }

    /** 需要你处理的事：主会话的提问（直接点选项）与提醒条。只在有事时出现。 */
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
      for (const item of (board.watches ?? []).filter((w) => (w.state === 'failed' || w.state === 'timeout') && now - (w.checkedAt ?? 0) < 24 * 3600_000).slice(0, 3)) alerts.push({ key: 'w' + item.id, tone: 'error', text: item.line });
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

    const QUIET = new Set(['blank', 'idle']);

    function RelaySidebar({ kit, sessionId, useTabInfo }) {
      const { t } = kit;
      useStyle();
      const visible = useVisible(useTabInfo);
      const [{ board, error, at }, refresh] = useBoard(kit, sessionId, visible);
      const [filter, setFilter] = usePersisted('filter', 'all');
      const [selected, setSelected] = React.useState(undefined);
      const [lineOpen, setLineOpen] = usePersisted('line', false);
      const [copied, setCopied] = React.useState(undefined);
      const [quietOpen, setQuietOpen] = usePersisted('quiet', false);
      const [tasksOpen, setTasksOpen] = usePersisted('tasks', false);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      const [doneOpen, setDoneOpen] = usePersisted('done', false);
      // 进详情前记下列表滚动位置，返回时还原
      const rootRef = React.useRef(null);
      const scrollKeep = React.useRef(0);
      React.useEffect(() => { if (selected === undefined && rootRef.current) rootRef.current.scrollTop = scrollKeep.current; }, [selected]);
      const select = React.useCallback((id) => { scrollKeep.current = rootRef.current?.scrollTop ?? 0; setSelected(id); }, []);
      const copyTimer = React.useRef(undefined);
      React.useEffect(() => () => clearTimeout(copyTimer.current), []);
      // 回调保持同一引用，memo 的卡片才不会每轮都重画
      const onCopied = React.useCallback((id) => { setCopied(id); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(undefined), 1500); }, []);
      // 写操作（回答提问、继续自动唤醒）：与协作页同一条路由，以用户身份执行；做完立即刷新
      const act = (body, okText) => {
        setBusy(true);
        return kit.request('POST', { ...body, fromSession: sessionId }).then(
          () => { setNote(okText ? { text: okText } : undefined); refresh(); },
          (failure) => setNote({ text: kit.errorText(t, failure), tone: 'error' })
        ).finally(() => setBusy(false));
      };
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      if (board === undefined) {
        return h('div', { className: 'dshaSv' },
          h('p', { className: 'dshaSv_muted', role: error ? 'alert' : 'status' }, error ?? t('loading')),
          error ? null : h(Skeleton),
          error ? h('button', { type: 'button', className: 'dshaSv_btn', onClick: refresh }, h(IconRefresh), t('tasksRefresh')) : null);
      }
      const entries = board.entries;
      const picked = selected === undefined ? undefined : entries.find((entry) => entry.sessionId === selected);
      if (picked !== undefined) return h(Detail, { kit, entry: picked, board, onBack: () => setSelected(undefined), copied, onCopied });
      const main = board.coordinator;
      const tasks = board.taskBoard;
      const counts = { attention: entries.filter(isAttention).length, active: entries.filter(isActive).length, ready: entries.filter(isReady).length, done: entries.filter(isDone).length };
      // 会话少于 3 个时不给筛选，直接全列
      const showFilters = entries.length >= 3;
      const rule = (showFilters ? FILTERS.find(([key]) => key === filter) : undefined) ?? FILTERS[0];
      const matched = entries.filter(rule[2]);
      // 「全部」里空白 / 久未活动的会话合成一行，点开再列
      const quiet = rule[0] === 'all' ? matched.filter((entry) => QUIET.has(categoryOf(entry))) : [];
      // 「全部」里已结束的收在底部，点开最多先列 50 条
      const done = rule[0] === 'all' ? matched.filter(isDone) : [];
      const shown = rule[0] === 'all' ? matched.filter((entry) => !isDone(entry) && (quietOpen || !QUIET.has(categoryOf(entry)))) : matched;
      const age = Number.isFinite(at) ? Date.now() - at : 0;
      const fresh = age > STALE_ERROR_MS ? 'error' : age > STALE_WARN_MS ? 'warn' : undefined;
      const quietText = ['blank', 'idle'].map((key) => [key, quiet.filter((entry) => categoryOf(entry) === key).length]).filter(([, n]) => n > 0).map(([key, n]) => t(CATEGORY_LABEL[key]) + ' ' + n).join(' · ');
      const line = board.line?.text ?? '';
      const longLine = line.length > 40 || line.includes('\n');
      const watching = (board.watches ?? []).filter((item) => item.state === 'active');
      const openTasks = tasks ? tasks.open : [];
      const taskRows = tasksOpen ? openTasks.slice(0, 30) : openTasks.slice(0, 3);
      const chip = (key, label, n, tone) => h('button', { key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key, 'data-tone': n > 0 ? tone : undefined, onClick: () => setFilter(filter === key ? 'all' : key) }, h('b', null, n), t(label));
      return h('div', { className: 'dshaSv', ref: rootRef },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_ws', title: board.workspace?.path ?? '' }, board.workspace?.title ?? '—'),
          h(GitHubPill, { kit, github: board.github }),
          h('span', { className: 'dshaSv_grow' }),
          error ? h('span', { className: 'dshaSv_ago', role: 'alert', title: error }, '⚠') : null,
          fresh ? h('span', { className: 'dshaSv_ago', 'data-tone': fresh, role: 'status' }, agoText(t, kit.format, at, Date.now())) : null,
          h('button', { type: 'button', className: 'dshaSv_icon', title: t('tasksRefresh') + ' · ' + agoText(t, kit.format, at, Date.now()), 'aria-label': t('tasksRefresh'), onClick: refresh }, h(IconRefresh))),
        note ? h('p', { className: note.tone === 'error' ? 'dshaSv_alert' : 'dshaSv_muted', 'data-tone': note.tone, role: 'status' }, note.text) : null,
        h(Attention, { kit, board, busy, act }),
        main
          ? h('div', { className: 'dshaSv_main dshaSv_row', role: 'button', tabIndex: 0, title: main.label ?? main.sessionId, 'aria-label': kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) }),
              onClick: () => kit.openSession(main.sessionId), onKeyDown: (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); kit.openSession(main.sessionId); } } },
            h('span', { className: 'dshaSv_star' }, h(IconStar)),
            h('span', { className: 'dshaSv_title' }, kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) })),
            h('span', { className: 'dshaSv_state', 'data-state': main.state, title: kit.stateText(t, main.state) }),
            h(CopyId, { kit, sessionId: main.sessionId, copied, onCopied }))
          : h('p', { className: 'dshaSv_muted' }, t('mainNone')),
        line
          ? h('button', { type: 'button', className: 'dshaSv_line', 'data-open': lineOpen ? true : undefined, 'aria-expanded': longLine ? lineOpen : undefined, title: lineOpen ? undefined : line, onClick: () => { if (longLine) setLineOpen(!lineOpen); } },
            h('span', { className: 'dshaSv_lineK' }, t('lineTitle')), h('span', { className: 'dshaSv_lineV' }, line))
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
            : shown.length === 0 && quiet.length === 0 && done.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('sideFEmpty'))
            : h('div', { className: 'dshaSv_list' }, ...shown.map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied }))),
          quiet.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': quietOpen, onClick: () => setQuietOpen(!quietOpen) }, (quietOpen ? t('sideLess') : quietText)) : null,
          done.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': doneOpen, onClick: () => setDoneOpen(!doneOpen) }, doneOpen ? t('sideLess') : kit.format(t('sideDoneN'), { n: done.length })) : null,
          doneOpen && done.length > 0 ? h('div', { className: 'dshaSv_list' }, ...done.slice(0, 50).map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied }))) : null,
          doneOpen && done.length > 50 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: done.length - 50 })) : null,
          board.othersTotal > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideOthers'), { n: board.othersTotal })) : null),
        h('section', { className: 'dshaSv_sec' },
          h('div', { className: 'dshaSv_bar' },
            h('p', { className: 'dshaSv_h dshaSv_grow' }, tasks ? t('tasksTitle') + ' · ' + kit.format(t('sideCountOpenN'), { n: openTasks.length }) : t('sideNoTasks')),
            tasks ? h('span', { className: 'dshaSv_muted' }, kit.format(t('sideClaimed'), { n: tasks.claimed })) : null),
          ...taskRows.map((row) => h('div', { key: row.id, className: 'dshaSv_task', title: row.title },
            h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': 'brand' }, row.id),
            row.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(row.priority) ? 'warn' : undefined }, row.priority) : null,
            h('span', { className: 'dshaSv_grow' }, row.title))),
          openTasks.length > 3 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': tasksOpen, onClick: () => setTasksOpen(!tasksOpen) }, tasksOpen ? t('sideLess') : kit.format(t('sideMoreTasks'), { n: openTasks.length - 3 })) : null,
          tasks && openTasks.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('sideNoOpenTasks')) : null));
    }

    // 与入口 makeSidebarTab 里的 SIDEBAR_KIT 对齐：kit 的字段一变就加 1，入口发现不配套时不渲染本文件
    return { RelaySidebar, KIT_VERSION: 2 };
  }
});
