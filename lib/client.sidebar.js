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
    // 连续没变化时逐步放慢：20 → 40 → 60 秒；有变化、切回页面或手动刷新时回到 20 秒
    const POLL_STEPS = [POLL_MS, POLL_MS, 2 * POLL_MS, 3 * POLL_MS];
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
    const STYLE_ID = 'dsh-session-relay/sidebar.css.v2';

    const css = [
      '.dshaSv{--accent:var(--dsw-alias-button-info-fill,var(--dsw-alias-link,#4176e6));--accent-hover:var(--dsw-alias-button-info-hover,var(--accent));box-sizing:border-box;height:100%;overflow:auto;display:grid;align-content:start;gap:12px;padding:10px 12px 20px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;container-type:inline-size}',
      '.dshaSv p{margin:0}',
      '.dshaSv_bar{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dshaSv_grow{flex:1;min-width:0}',
      '.dshaSv_ws{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 10px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_ago{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
      '.dshaSv_ghCard{gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_ghStatus{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.dshaSv_ghStatus .dshaSv_pill{flex:none;max-width:60%}',
      '.dshaSv_ghTier{display:grid;gap:4px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_scopes{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_scope{display:inline-flex;align-items:center;height:19px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;white-space:nowrap}',
      '.dshaSv_ghTier .dshaSv_filters{margin:2px 0 4px}',
      '.dshaSv_ghCard .dshaSv_row{flex-wrap:wrap}',
      '.dshaSv_ghFlow{display:grid;gap:4px}',
      '.dshaSv_code{padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;font-weight:600;letter-spacing:.06em;white-space:nowrap}',
      '.dshaSv_btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.dshaSv_btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_btn[data-primary]{border-color:transparent;background:var(--accent);color:#fff;font-weight:600}',
      '.dshaSv_btn[data-primary]:hover{background:var(--accent-hover)}',
      '.dshaSv_icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshaSv_icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_btn:focus-visible,.dshaSv_icon:focus-visible,.dshaSv_card:focus-visible,.dshaSv_chipF:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_filters{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_chipF{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}',
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
      '.dshaSv_pill{display:inline-flex;align-items:center;height:20px;max-width:100%;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_pill[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshaSv_pill[data-tone=warn]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
      '.dshaSv_pill[data-tone=error]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dshaSv_pill[data-tone=ok]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_pill[data-tone=brand]{border-color:var(--accent);color:var(--accent)}',
      '.dshaSv_pillBtn{font:inherit;background:none;cursor:pointer}',
      '.dshaSv_pillBtn:hover{border-color:var(--accent);color:var(--accent)}',
      '.dshaSv_state{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l2))}',
      '.dshaSv_state[data-state=running]{background:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_state[data-state=idle]{background:var(--dsw-alias-state-idle-primary)}',
      '.dshaSv_star{color:var(--dsw-alias-state-warn-primary);flex:none;display:inline-flex}',
      '.dshaSv_link{justify-self:start;padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:12px;cursor:pointer}',
      '.dshaSv_task{display:flex;align-items:center;gap:6px;min-width:0;padding:3px 0}',
      '.dshaSv_task .dshaSv_grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_taskBtn{width:100%;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:6px;padding:3px 4px}',
      '.dshaSv_taskBtn .dshaSv_pill{flex:none;max-width:45%}',
      '.dshaSv_taskBtn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_taskBtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_groupBtn{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:4px 0;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;text-align:left;cursor:pointer;border-radius:6px}',
      '.dshaSv_groupBtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_groupBtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_count{flex:none;font-weight:500;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dshaSv_dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.55}',
      '.dshaSv_dot[data-tone=ok]{background:var(--dsw-alias-state-success-primary);opacity:1}',
      '.dshaSv_dot[data-tone=brand]{background:var(--accent);opacity:1}',
      '.dshaSv_chev{flex:none;color:var(--dsw-alias-label-secondary);opacity:.7}',
      '.dshaSv_chevRot{display:inline-block;transition:transform .15s ease}',
      '.dshaSv_chevRot[data-open]{transform:rotate(90deg)}',
      '.dshaSv_taskActs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.dshaSv_taskActs .dshaSv_btn{display:inline-flex;align-items:center;gap:4px}',
      '.dshaSv_btn[aria-disabled=true]{opacity:.85;cursor:default}',
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
      // 刷新反馈：点下去转一圈（过渡，不是常驻动画），请求期间按钮禁用
      '.dshaSv_icon svg{transition:none}',
      '.dshaSv_icon[data-busy] svg{transform:rotate(360deg);transition:transform .6s ease}',
      '.dshaSv_icon:disabled{cursor:default;opacity:.6}',
      '.dshaSv_main[data-self]{cursor:default}',
      '.dshaSv_main[data-self]:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_form{display:grid;gap:6px;cursor:default}',
      '.dshaSv_input{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;resize:vertical}',
      '.dshaSv_input:focus-visible{outline:2px solid var(--accent);outline-offset:0}',
      '.dshaSv_foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0}',
      '.dshaSv_meta{flex:1 1 90px;min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_acts{display:inline-flex;gap:6px;margin-left:auto}',
      '@media (pointer:coarse){.dshaSv_btn{height:32px}.dshaSv_icon{width:32px;height:32px}.dshaSv_chipF{height:30px}}',
      '@media (prefers-reduced-motion:reduce){.dshaSv_chevRot{transition:none}}'
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
    const isAttention = (entry) => categoryOf(entry) === 'attention';
    const isReady = (entry) => categoryOf(entry) === 'ready';
    const isDone = (entry) => categoryOf(entry) === 'archived';
    const isActive = (entry) => categoryOf(entry) === 'active';
    // 状态胶囊：需要处理的卡片说「为什么找你」（待答复 / 受阻 / 最后一轮出错 / 上下文过大），
    // 不显示可能已经过时的汇报状态；空白 / 久未活动显示分组名
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
        let timer;
        let quiet = 0; // 连续「没变化」的次数
        let flashTimer;
        const schedule = () => { clearTimeout(timer); timer = setTimeout(load, POLL_STEPS[Math.min(quiet, POLL_STEPS.length - 1)]); };
        function load() {
          if (!alive) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { schedule(); return; }
          controller?.abort?.();
          controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          const since = lastBoards.get(sessionId)?.version;
          kit.request('GET', undefined, { view: 'board', session: sessionId, since }, controller?.signal).then(
            (payload) => {
              if (!alive) return;
              if (payload.notModified === true) {
                // 没变：只更新「多久前」，看板对象不换，卡片不重画
                quiet += 1;
                const cached = lastBoards.get(sessionId);
                if (cached) { const next = { ...cached, at: Date.now(), error: undefined }; lastBoards.set(sessionId, next); setState((prev) => ({ ...next, refreshing: prev.refreshing })); }
                return;
              }
              if (!Array.isArray(payload.entries)) return;
              quiet = 0;
              setState((prev) => {
                // 内容没变的条目沿用旧对象，卡片（memo）就不重画
                const old = new Map((prev.board?.entries ?? []).map((entry) => [entry.sessionId, entry]));
                const entries = payload.entries.map((entry) => { const before = old.get(entry.sessionId); return before !== undefined && JSON.stringify(before) === JSON.stringify(entry) ? before : entry; });
                const next = { board: { ...payload, entries }, error: undefined, at: Date.now(), version: typeof payload.version === 'string' ? payload.version : undefined };
                const shown = { ...next, refreshing: prev.refreshing };
                lastBoards.delete(sessionId);
                lastBoards.set(sessionId, next);
                if (lastBoards.size > 8) lastBoards.delete(lastBoards.keys().next().value);
                return shown;
              });
            },
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ ...prev, error: kit.errorText(kit.t, error) })); }
          ).finally(() => {
            if (!alive) return;
            schedule();
            // 手动刷新：结束后短暂显示「刚刚更新」，让人知道确实刷过了
            setState((prev) => (prev.refreshing ? { ...prev, refreshing: false, flash: true } : prev));
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => { if (alive) setState((prev) => (prev.flash ? { ...prev, flash: false } : prev)); }, 2500);
          });
        }
        // 切回页面：立刻查一次并回到最快节奏（只挂一次，卸载时摘掉）
        const wake = () => { if (document.visibilityState !== 'hidden') { quiet = 0; load(); } };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
        load();
        return () => {
          alive = false;
          clearTimeout(timer);
          clearTimeout(flashTimer);
          controller?.abort?.();
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
        };
      }, [kit, sessionId, visible, tick]);
      return [state, () => { setState((prev) => ({ ...prev, refreshing: true })); setTick((value) => value + 1); }];
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

    /** 卡片主操作：待答复 / 受阻 → 回复；可合并 → 排号；久未活动 → 唤醒；其余只打开。 */
    function primaryOf(entry) {
      const category = categoryOf(entry);
      if (category === 'attention') return 'reply';
      if (category === 'ready') return 'assign';
      if (category === 'idle') return 'wake';
      return undefined;
    }
    // 卡片里的表单：点击和按键不冒泡到卡片（否则会进详情）
    const keep = { onClick: (event) => event.stopPropagation(), onKeyDown: (event) => event.stopPropagation() };

    /** 卡片上的写操作，每个都要第二次确认（发送 / 排号 / 确认唤醒）；以你的身份执行，走协作页同一路由。 */
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

    const EntryCard = memo(function EntryCard({ kit, entry, onSelect, copied, onCopied, act }) {
      const [open, setOpen] = React.useState(undefined);
      const primary = act ? primaryOf(entry) : undefined;
      const label = { reply: 'reply', assign: 'assign', wake: 'wake' }[primary];
      const { t } = kit;
      const tone = toneOf(entry);
      const name = entry.label ?? kit.shortId(entry.sessionId);
      return h(Card, { tone, onOpen: () => onSelect(entry.sessionId), label: name },
        h('div', { className: 'dshaSv_row' },
          h('span', { className: 'dshaSv_pill', 'data-tone': tone === 'muted' ? undefined : tone, title: pillTitle(kit, entry) }, pillText(kit, entry)),
          h('span', { className: 'dshaSv_title', title: entry.title ?? name }, name),
          h('span', { className: 'dshaSv_state', 'data-state': entry.state, title: kit.stateText(t, entry.state) })),
        entry.summary ? h('p', { className: 'dshaSv_sum' }, entry.summary) : null,
        // 底行：状态标记 + 一段等宽元信息（短 id · 提交 · 分支，放不下省略，悬停看全）+ 复制；
        // 按钮组靠右，窄栏里整组换到下一行，不再把分支、提交各挤成一行
        h('div', { className: 'dshaSv_foot' },
          entry.answered ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('answered')) : null,
          entry.queue ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, kit.format(t('queueNo'), { n: entry.queue })) : null,
          (entry.conflicts?.length ?? 0) > 0 ? h('span', { className: 'dshaSv_pill', 'data-tone': 'error' }, '⚠ ' + entry.conflicts.length) : null,
          h('span', { className: 'dshaSv_meta', title: [entry.sessionId, entry.commit, entry.branch, entry.checkout?.path].filter(Boolean).join('\n') },
            // 汇报的分支优先；没汇报时用宿主读到的 checkout 分支（官方工作树里新建的会话常常没汇报过）
            [kit.shortId(entry.sessionId), entry.commit ? String(entry.commit).slice(0, 7) : null,
              entry.branch ?? entry.checkout?.branch, entry.checkout?.linked ? '工作树' : null].filter(Boolean).join(' · ')),
          h(CopyId, { kit, sessionId: entry.sessionId, copied, onCopied }),
          h('span', { className: 'dshaSv_acts' },
            primary ? h('button', { type: 'button', className: 'dshaSv_btn', 'aria-expanded': open === primary, onClick: stop(() => setOpen(open === primary ? undefined : primary)) }, t(label)) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': primary ? undefined : true, onClick: stop(() => kit.openSession(entry.sessionId)) }, h(IconOpen), t('openSession')))),
        open ? h(CardAction, { kit, entry, kind: open, act, onDone: () => setOpen(undefined) }) : null);
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
        ['sideBranch', entry.branch ?? entry.checkout?.branch],
        ['sideCommit', entry.commit],
        entry.checkout?.linked ? ['sideWorktree', entry.checkout.path] : undefined,
        entry.checkout?.base ? ['sideBase', String(entry.checkout.base).slice(0, 8) + (entry.checkout.baseRef ? `（${entry.checkout.baseRef}）` : '')] : undefined,
        ['sideQueue', entry.queue ? '#' + entry.queue : undefined],
        ['sideAssigned', entry.assigned]
      ].filter((row) => row !== undefined && row[1]);
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
    function GitHubPill({ kit, github, onClick, expanded }) {
      if (!github || github.state === null || github.state === undefined || github.state === 'unavailable') return null;
      const { t } = kit;
      const bad = github.match === 'mismatch' || (github.match === 'missing' && github.pinned);
      const tone = bad ? 'error' : github.match === 'ok' ? 'ok' : github.state === 'ready' ? undefined : 'warn';
      const text = github.state === 'ready' ? '@' + github.login : t('ghPillOut');
      const title = github.match === 'mismatch' ? kit.format(t('ghPillMismatch'), { login: github.login, pinned: github.pinned?.login ?? '' })
        : github.match === 'ok' ? kit.format(t('ghPillPinned'), { login: github.login })
        : github.state === 'ready' ? kit.format(t('ghPillUnpinned'), { login: github.login }) : t('ghPillOutHint');
      if (typeof onClick !== 'function') return h('span', { className: 'dshaSv_pill', 'data-tone': tone, title, 'aria-label': title, role: bad ? 'alert' : undefined }, bad ? '⚠ ' + text : text);
      return h('button', { type: 'button', className: 'dshaSv_pill dshaSv_pillBtn', 'data-tone': tone, title: title + ' · ' + kit.t('ghCardOpen'), 'aria-label': title, 'aria-expanded': expanded === true, role: bad ? 'alert' : undefined, onClick }, bad ? '⚠ ' + text : text);
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
      const gh = github ?? {};
      const flow = gh.loginFlow;
      const pending = flow !== null && flow !== undefined && flow.state === 'pending';
      const bad = gh.match === 'mismatch' || (gh.match === 'missing' && gh.pinned !== null);
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
        : { text: t('ghStateUnknown') };
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
          pin ? h('span', { className: 'dshaSv_pill', 'data-tone': pin.tone, title: pin.title }, pin.text) : null,
          flowPill ? h('span', { className: 'dshaSv_pill', 'data-tone': flowPill.tone, title: flowPill.title }, flowPill.text) : null,
          gh.state === 'ready' && gh.accountId !== null && gh.accountId !== undefined ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: t('ghTitle') + ' id' }, 'id ' + gh.accountId) : null,
          gh.state === 'ready' && (gh.source === 'shell' || gh.source === 'gh') ? h('span', { className: 'dshaSv_pill', title: t(gh.source === 'shell' ? 'ghSourceShell' : 'ghSourceGh') }, t(gh.source === 'shell' ? 'ghSourceShortShell' : 'ghSourceShortGh')) : null),
        gh.state === 'ready' && Array.isArray(gh.scopes) && gh.scopes.length > 0
          ? h('div', { className: 'dshaSv_scopes', 'aria-label': t('ghScopesLabel') },
            ...gh.scopes.map((scope) => h('span', { key: scope, className: 'dshaSv_scope', title: scope }, scopeLabel(t, scope))))
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
          gh.state === 'ready' && grantedAll
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
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => act({ action: 'github-refresh' }) }, t('ghRefresh'))),
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

    const QUIET = new Set(['blank', 'idle']);

    /**
     * 任务看板（参考 Deck 的「列表 + 详情 + 动作」）：
     * - 列表按「可接 / 进行中 / 已结束」分组；可接默认露 3 条、进行中露 5 条，点「还有 N 条」展开；
     * - 点一行进详情：持有者、工作树、看板状态，动作有打开持有会话、复制任务号 / 认领指令 / 派发指令、拉起认领会话；
     * - 数据随看板快照一起来（taskBoard），不额外请求；只在标签可见时由上层轮询；
     * - 认领会新建会话，所以详情里二次确认（Deck 的按钮能把 prompt 注入输入框，relay 没有输入框入口，就复制命令）。
     */
    function TaskBoard({ kit, tasks, entries, act, busy, copied, onCopied = () => {}, openMore = false, onToggleOpenMore }) {
      const { t } = kit;
      const [selected, setSelected] = React.useState(undefined);
      const [fold, setFold] = React.useState({});
      const [claiming, setClaiming] = React.useState(undefined);
      const [alias, setAlias] = React.useState('');
      if (tasks === undefined || tasks === null) return h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_muted' }, t('sideNoTasks')));
      const open = Array.isArray(tasks.open) ? tasks.open : [];
      const active = Array.isArray(tasks.claimedRows) ? tasks.claimedRows : [];
      const ended = Array.isArray(tasks.endedRows) ? tasks.endedRows : [];
      const claimedN = Number(tasks.claimed) || 0;
      const endedN = Number.isFinite(tasks.ended) ? tasks.ended : ended.length;
      const stateOf = (id) => open.some((row) => row.id === id) ? 'open' : active.some((row) => row.id === id) ? 'active' : ended.some((row) => row.id === id) ? 'ended' : undefined;
      const picked = selected === undefined ? undefined : open.find((row) => row.id === selected) ?? active.find((row) => row.id === selected) ?? ended.find((row) => row.id === selected);
      if (picked !== undefined) {
        const state = stateOf(picked.id)
        const holder = picked.owner === undefined ? undefined : (Array.isArray(entries) ? entries : []).find((entry) => entry.sessionId === picked.owner);
        const copyKey = 'task:' + picked.id;
        const status = copied === copyKey ? 'ok' : copied === 'fail:' + copyKey ? 'fail' : undefined;
        const copy = (text) => { void kit.copyText(text).then((ok) => onCopied(ok ? copyKey : 'fail:' + copyKey), () => onCopied('fail:' + copyKey)); };
        const facts = [
          [t('sideTaskWorktree'), picked.worktree],
          [t('sideTaskDepends'), Array.isArray(picked.dependsOn) && picked.dependsOn.length > 0 ? picked.dependsOn.join('、') : undefined],
          [t('sideTaskStatus'), picked.status],
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
        return h('section', { className: 'dshaSv_sec' },
          h('div', { className: 'dshaSv_bar' },
            h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => { setSelected(undefined); setClaiming(undefined); } }, h(IconBack), t('sideTaskBack')),
            h('span', { className: 'dshaSv_crumb dshaSv_grow' }, t('tasksTitle'))),
          h('div', { className: 'dshaSv_row' },
            h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand' }, picked.id),
            picked.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(picked.priority) ? 'warn' : undefined }, picked.priority) : null,
            h('span', { className: 'dshaSv_pill', 'data-tone': state === 'open' ? 'ok' : state === 'active' ? 'brand' : undefined }, t(state === 'open' ? 'sideTaskOpen' : state === 'active' ? 'sideTaskActive' : 'sideTaskEnded')),
            h('span', { className: 'dshaSv_grow' }),
            status === 'ok' ? h('span', { className: 'dshaSv_muted' }, t('sideTaskCopied')) : status === 'fail' ? h('span', { className: 'dshaSv_alert', 'data-tone': 'error' }, t('copyFailed')) : null),
          h('p', { className: 'dshaSv_big' }, picked.title ?? picked.id),
          picked.owner ? h('p', { className: 'dshaSv_muted' }, t('tasksHolder') + '：' + (picked.ownerLabel ?? kit.shortId(picked.owner))) : null,
          holder && holder.summary ? h('p', { className: 'dshaSv_muted', title: holder.summary }, t('sideTaskLatest') + '：' + holder.summary) : null,
          facts.length > 0 ? h('dl', { className: 'dshaSv_kv' }, ...facts.flatMap(([key, value]) => [h('dt', { key: key + 'k' }, key), h('dd', { key: key + 'v' }, String(value))])) : null,
          h('div', { className: 'dshaSv_taskActs' },
            picked.owner ? h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => kit.openSession(picked.owner) }, h(IconOpen), t('tasksOpenHolder')) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => copy(picked.id) }, h(IconCopy), t('sideTaskCopyId')),
            state === 'open' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => copy('/relay task claim ' + picked.id) }, h(IconCopy), t('sideTaskCopyClaim')) : null,
            state === 'active' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => copy('/relay task dispatch ' + picked.id) }, h(IconCopy), t('sideTaskCopyDispatch')) : null,
            state === 'open' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, 'aria-expanded': claiming === picked.id, onClick: () => { setClaiming(claiming === picked.id ? undefined : picked.id); if (alias === '') setAlias(picked.id.toLowerCase()); } }, t('tasksClaim')) : null),
          claiming === picked.id ? h('div', { className: 'dshaSv_row' },
            h('input', { className: 'dshaSv_input', style: { maxWidth: '9em' }, value: alias, maxLength: 32, 'aria-label': t('tasksAlias'), placeholder: picked.id.toLowerCase(), onChange: (event) => setAlias(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') claim(); } }),
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: claim }, t('tasksClaimConfirm')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setClaiming(undefined) }, t('cancel'))) : null);
      }
      const row = (task, state) => h('button', {
        key: state + ':' + task.id, type: 'button', className: 'dshaSv_task dshaSv_taskBtn', title: task.title,
        onClick: () => { setSelected(task.id); setClaiming(undefined); }
      },
        h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand' }, task.id),
        task.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(task.priority) ? 'warn' : undefined }, task.priority) : null,
        h('span', { className: 'dshaSv_grow' }, task.title),
        state === 'active' && task.owner ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: task.ownerLabel ?? task.owner }, task.ownerLabel ?? kit.shortId(task.owner)) : null,
        state === 'ended' ? h('span', { className: 'dshaSv_pill' }, t(task.claim === 'done' ? 'sideTaskDone' : 'sideTaskAbandoned')) : null,
        h('span', { className: 'dshaSv_chev', 'aria-hidden': true }, '›'));
      const more = (state, total, shown) => {
        if (total <= shown) return null;
        const expanded = state === 'open' ? openMore === true : fold[state] === true;
        const toggle = state === 'open' && typeof onToggleOpenMore === 'function' ? onToggleOpenMore : () => setFold({ ...fold, [state]: fold[state] !== true });
        return h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': expanded, onClick: toggle }, expanded ? t('sideLess') : kit.format(t('sideMoreTasks'), { n: total - shown }));
      };
      // 分组默认：可接 / 进行中展开，已结束收起；点分组头切换（本机状态，跨重开保持到刷新）
      const groupOpen = (state) => fold['g:' + state] === undefined ? state !== 'ended' : fold['g:' + state] === true;
      const group = (state, labelKey, rows, shown, tone, count = rows.length, moreLink) => rows.length === 0 ? null : h('div', { className: 'dshaSv_list', 'data-group': state },
        h('button', { type: 'button', className: 'dshaSv_groupBtn', 'aria-expanded': groupOpen(state) ? 'true' : 'false', onClick: () => setFold({ ...fold, ['g:' + state]: !groupOpen(state) }) },
          h('span', { className: 'dshaSv_chev dshaSv_chevRot', 'data-open': groupOpen(state) ? true : undefined, 'aria-hidden': true }, '▸'),
          h('span', { className: 'dshaSv_dot', 'data-tone': tone, 'aria-hidden': true }),
          h('span', { className: 'dshaSv_grow' }, t(labelKey)),
          h('span', { className: 'dshaSv_count' }, String(count))),
        groupOpen(state) ? h('div', { className: 'dshaSv_list' }, ...shown.map((task) => row(task, state)), moreLink ?? more(state, rows.length, shown.length)) : null);
      const openShown = openMore === true ? open : open.slice(0, 3);
      const activeShown = fold.active === true ? active : active.slice(0, 5);
      return h('section', { className: 'dshaSv_sec' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTaskBoard')),
          h('span', { className: 'dshaSv_muted' }, kit.format(t('sideTaskSummary'), { open: open.length, active: claimedN }))),
        open.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('sideNoOpenTasks')) : null,
        group('open', 'sideTaskOpen', open, openShown, 'ok'),
        group('active', 'sideTaskActive', active, activeShown, 'brand'),
        claimedN > active.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: claimedN - active.length })) : null,
        ended.length > 0
          ? group('ended', 'sideTaskEnded', ended, ended, undefined, endedN,
            endedN > ended.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN - ended.length })) : null)
          : endedN > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN })) : null);
    }

    function RelaySidebar({ kit, sessionId, useTabInfo }) {
      const { t } = kit;
      useStyle();
      const visible = useVisible(useTabInfo);
      const [{ board, error, at, refreshing, flash }, refresh] = useBoard(kit, sessionId, visible);
      const [filter, setFilter] = usePersisted('filter', 'all');
      const [selected, setSelected] = React.useState(undefined);
      const [lineOpen, setLineOpen] = usePersisted('line', false);
      const [copied, setCopied] = React.useState(undefined);
      const [quietOpen, setQuietOpen] = usePersisted('quiet', false);
      // 「可接」列表展开：沿用原来的本机记忆键，切会话 / 重开标签后保持
      const [tasksOpen, setTasksOpen] = usePersisted('tasks', false);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      const [doneOpen, setDoneOpen] = usePersisted('done', false);
      // GitHub 登录卡：点顶栏账号胶囊就地展开，不跳设置页
      const [ghLoginOpen, setGhLoginOpen] = React.useState(false);
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
      const actRef = React.useRef(undefined);
      actRef.current = (body, okText) => {
        setBusy(true);
        return kit.request('POST', { ...body, fromSession: sessionId }).then(
          // 返回完整响应：任务的「拉起认领会话」要用 result.sessionId 直接打开新会话
          (payload) => { setNote(okText ? { text: okText } : undefined); refresh(); return payload; },
          (failure) => { setNote({ text: kit.errorText(t, failure), tone: 'error' }); return undefined; }
        ).finally(() => setBusy(false));
      };
      // 同一个引用传给 memo 的卡片
      const act = React.useCallback((body, okText) => actRef.current(body, okText), []);
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
      const chip = (key, label, n, tone) => h('button', { key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key, 'data-tone': n > 0 ? tone : undefined, onClick: () => setFilter(filter === key ? 'all' : key) }, h('b', null, n), t(label));
      return h('div', { className: 'dshaSv', ref: rootRef },
        h('div', { className: 'dshaSv_bar' },
          h('span', { className: 'dshaSv_ws', title: board.workspace?.path ?? '' }, board.workspace?.title ?? '—'),
          h(GitHubPill, { kit, github: board.github, onClick: () => setGhLoginOpen(!ghLoginOpen), expanded: ghLoginOpen }),
          h('span', { className: 'dshaSv_grow' }),
          error ? h('span', { className: 'dshaSv_ago', role: 'alert', title: error }, '⚠') : null,
          refreshing ? h('span', { className: 'dshaSv_ago', role: 'status' }, t('sideRefreshing'))
            : flash || fresh ? h('span', { className: 'dshaSv_ago', 'data-tone': fresh, role: 'status' }, agoText(t, kit.format, at, Date.now())) : null,
          h('button', { type: 'button', className: 'dshaSv_icon', 'data-busy': refreshing ? true : undefined, disabled: refreshing, title: t('tasksRefresh') + ' · ' + agoText(t, kit.format, at, Date.now()), 'aria-label': t('tasksRefresh'), onClick: refresh }, h(IconRefresh))),
        ghLoginOpen ? h(GitHubCard, { kit, github: board.github, busy, act, onClose: () => setGhLoginOpen(false) }) : null,
        note ? h('p', { className: note.tone === 'error' ? 'dshaSv_alert' : 'dshaSv_muted', 'data-tone': note.tone, role: 'status' }, note.text) : null,
        h(Attention, { kit, board, busy, act }),
        main && main.sessionId === sessionId
          ? h('div', { className: 'dshaSv_main dshaSv_row', 'data-self': true, title: t('sideMainSelf') },
            h('span', { className: 'dshaSv_star' }, h(IconStar)),
            h('span', { className: 'dshaSv_title' }, kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) })),
            h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('thisSession')),
            h('span', { className: 'dshaSv_state', 'data-state': main.state, title: kit.stateText(t, main.state) }),
            h(CopyId, { kit, sessionId: main.sessionId, copied: copiedFor(copied, main.sessionId), onCopied }))
        : main
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
            : shown.length > 0 ? h('div', { className: 'dshaSv_list' }, ...shown.map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied, act }))) : null,
          quiet.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': quietOpen, onClick: () => setQuietOpen(!quietOpen) }, (quietOpen ? t('sideLess') : quietText)) : null,
          done.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': doneOpen, onClick: () => setDoneOpen(!doneOpen) }, doneOpen ? t('sideLess') : kit.format(t('sideDoneN'), { n: done.length })) : null,
          doneOpen && done.length > 0 ? h('div', { className: 'dshaSv_list' }, ...done.slice(0, 50).map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied, act }))) : null,
          doneOpen && done.length > 50 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: done.length - 50 })) : null,
          ),
        h(TaskBoard, { kit, tasks, entries, act, busy, copied, onCopied, openMore: tasksOpen, onToggleOpenMore: () => setTasksOpen(!tasksOpen) }));
    }

    // 与入口 makeSidebarTab 里的 SIDEBAR_KIT 对齐：kit 的字段一变就加 1，入口发现不配套时不渲染本文件
    return { RelaySidebar, TaskBoard, KIT_VERSION: 2 };
  }
});
