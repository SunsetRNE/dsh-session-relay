window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar45.js',
  factory: (require) => {
    'use strict';
    // 侧栏外壳（T13）：入口第一次打开标签时先加载本文件，只保留 TABS / TabBar / RelaySidebar / useBoard
    // 与按需加载器；共享件与各页签正文在 client.sidebar.<name>45.js，按 require.async 拉取。
    const React = require('react');
    const h = React.createElement;
    const SIDEBAR_KIT = 45;
    const POLL_MS = 20000;
    // 连续没变化时逐步放慢：20 → 40 → 60 秒；有变化、切回页面或手动刷新时回到 20 秒
    const POLL_STEPS = [POLL_MS, POLL_MS, 2 * POLL_MS, 3 * POLL_MS];
    // GitHub 身份探测在飞时快一点取结果，让「正在读取账号…」不至于挂满一个 20 秒轮询
    const READING_POLL_MS = 4000;
    // 数据新鲜度：超过 5 分钟变黄、30 分钟变红（轮询停了或接口一直失败时看得出来）
    const STALE_WARN_MS = 5 * 60000;
    const STALE_ERROR_MS = 30 * 60000;
    // 上次拿到的看板（按会话）：重开标签先画它，再后台刷新
    const lastBoards = new Map();
    // 页面刷新 / 重新打开后先显示上次快照，再后台刷新，减少骨架闪烁。
    // 只用 sessionStorage（当前标签页有效，关掉页面即清），不落 localStorage；容量 / 解析失败一律当没缓存。
    const SNAPSHOT_PREFIX = 'dsh-session-relay:snapshot:v1:';
    const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
    const SNAPSHOT_MAX_ENTRIES = 24;
    function snapshotStore() {
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage !== null) return sessionStorage;
      } catch {}
      try {
        if (typeof window !== 'undefined' && window !== null && window.sessionStorage) return window.sessionStorage;
      } catch {}
      return undefined;
    }
    function readSnapshot(key, ttlMs = SNAPSHOT_TTL_MS) {
      const store = snapshotStore();
      if (store === undefined) return undefined;
      try {
        const raw = store.getItem(SNAPSHOT_PREFIX + key);
        if (raw === null || raw === undefined) return undefined;
        const saved = JSON.parse(raw);
        if (saved === null || typeof saved !== 'object' || typeof saved.savedAt !== 'number' || saved.value === undefined) return undefined;
        if (Date.now() - saved.savedAt >= ttlMs) { store.removeItem(SNAPSHOT_PREFIX + key); return undefined; }
        return saved.value;
      } catch { return undefined; }
    }
    function writeSnapshot(key, value, maxEntries = SNAPSHOT_MAX_ENTRIES) {
      const store = snapshotStore();
      if (store === undefined) return;
      try {
        store.setItem(SNAPSHOT_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
        // 逐出最旧的快照，避免 sessionStorage 越攒越大
        const rows = [];
        for (let index = 0; index < store.length; index += 1) {
          const name = store.key(index);
          if (typeof name !== 'string' || !name.startsWith(SNAPSHOT_PREFIX)) continue;
          let at = 0;
          try { at = Number(JSON.parse(store.getItem(name))?.savedAt) || 0; } catch {}
          rows.push({ name, at });
        }
        if (rows.length > maxEntries) {
          rows.sort((a, b) => a.at - b.at).slice(0, rows.length - maxEntries).forEach((row) => {
            try { store.removeItem(row.name); } catch {}
          });
        }
      } catch {}
    }
    function readBoardSnapshot(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return undefined;
      const saved = readSnapshot('board:' + sessionId);
      if (saved === null || saved === undefined || typeof saved !== 'object' || saved.board === null || typeof saved.board !== 'object') return undefined;
      // 旧版本快照可能缺 entries 等字段；形状不对就当没缓存，回退到正常加载
      if (!Array.isArray(saved.board.entries)) return undefined;
      return { board: saved.board, at: saved.at, version: saved.version, fullAt: saved.fullAt, fromStore: true };
    }
    function writeBoardSnapshot(sessionId, entry) {
      if (typeof sessionId !== 'string' || sessionId === '' || entry === undefined || entry.board === undefined) return;
      try { writeSnapshot('board:' + sessionId, { board: entry.board, at: entry.at, version: entry.version, fullAt: entry.fullAt }); } catch {}
    }
    function readRemoteSnapshot(key) {
      const saved = readSnapshot('remote:' + key);
      if (saved === null || saved === undefined || typeof saved !== 'object' || saved.data === undefined) return undefined;
      // 只认当前形状的 PR / 问题列表；旧结构或坏数据直接放弃
      let view;
      try { view = JSON.parse(key)?.view; } catch {}
      if (view === 'pr-list' && !Array.isArray(saved.data?.prs?.items)) return undefined;
      if (view === 'issue-list' && !Array.isArray(saved.data?.issues?.items)) return undefined;
      if (view !== 'pr-list' && view !== 'issue-list') return undefined;
      return { at: Number(saved.at) || 0, data: saved.data };
    }
    function writeRemoteSnapshot(key, entry) {
      // 只持久化 PR / 问题列表；分支等本地数据不落，避免体积和无谓的旧数据
      let view;
      try { view = JSON.parse(key)?.view; } catch {}
      if (view !== 'pr-list' && view !== 'issue-list') return;
      try { writeSnapshot('remote:' + key, { at: entry.at, data: entry.data }); } catch {}
    }
    function readCountsSnapshot(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return undefined;
      const saved = readSnapshot('counts:' + sessionId);
      return saved !== null && saved !== undefined && typeof saved === 'object' ? saved : undefined;
    }
    function writeCountsSnapshot(sessionId, counts) {
      if (typeof sessionId !== 'string' || sessionId === '') return;
      try { writeSnapshot('counts:' + sessionId, counts); } catch {}
    }
    // 相同参数的 board 请求在左栏 / 右栏 / 对话标签之间共享，避免同一时刻各拉一份
    const inflightBoard = new Map();
    function requestBoardOnce(kit, params) {
      const key = [params.session, params.light ? 'light' : 'full', params.since ?? '', params.tasks ? 'tasks' : ''].join('|');
      const hit = inflightBoard.get(key);
      if (hit !== undefined) return hit;
      const promise = kit.request('GET', undefined, params);
      inflightBoard.set(key, promise);
      promise.then(() => {}, () => {}).finally(() => { if (inflightBoard.get(key) === promise) inflightBoard.delete(key); });
      return promise;
    }
    // 筛选与各折叠的开合：记在本机，切换会话、重开标签后保持（每个会话的侧栏是各自的组件实例）
    const UI_KEY = 'dshaSv.ui.v1';
    let uiCache;
    function readUi() {
      if (uiCache !== undefined) return uiCache;
      try { const value = JSON.parse(window.localStorage.getItem(UI_KEY) || '{}'); uiCache = value && typeof value === 'object' ? value : {}; } catch { uiCache = {}; }
      return uiCache;
    }
    // 同一份 UI 记录被右侧边栏与嵌入面板共用；嵌入实例带 persistPrefix 键前缀，页签 / 筛选互不覆盖
    const PersistScope = typeof React.createContext === 'function' ? React.createContext('') : null;
    function usePersisted(name, initial, prefix) {
      // 组件自己的持久键可显式传 prefix；子树（如 GitHub 卡）走 PersistScope，二者取其一，不叠加
      const scope = PersistScope !== null && typeof React.useContext === 'function' ? React.useContext(PersistScope) : '';
      const key = (prefix === undefined ? scope : prefix) + name;
      const [value, setValue] = React.useState(() => { const saved = readUi()[key]; return saved === undefined ? initial : saved; });
      const set = React.useCallback((next) => {
        setValue(next);
        const ui = readUi();
        ui[key] = next;
        try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
      }, [key]);
      return [value, set];
    }
    const memo = (component) => (typeof React.memo === 'function' ? React.memo(component) : component);
    const STYLE_ID = 'dsh-session-relay/sidebar.css.v3';


    const css = [
      '.dshaSv{--accent:var(--dsw-alias-button-info-fill,var(--dsw-alias-link,#4176e6));--accent-hover:var(--dsw-alias-button-info-hover,var(--accent));box-sizing:border-box;height:100%;overflow:auto;display:grid;align-content:start;gap:0;padding:0 10px 14px;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.55;container-type:inline-size}',
      '.dshaSv p{margin:0}',
      '.dshaSv_bar{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_grow{flex:1;min-width:0}',
      '.dshaSv_ws{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 3px;border:0;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_ago{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
      // 页签壳：顶栏 + 4 个主页签；设置从齿轮进，不占页签。高度与密度按侧栏容器（container query）适配
      '.dshaSv_head{position:sticky;top:0;z-index:3;display:grid;gap:1px;padding-bottom:0;background:var(--dsw-alias-bg-base)}',
      '.dshaSv_tabs{display:flex;gap:3px;padding:0 0 2px;overflow-x:auto;scrollbar-width:none}',
      '.dshaSv_tab{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:1px 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;font-weight:500;line-height:1.5;cursor:pointer;white-space:nowrap;flex:none}',
      // 嵌入面板 11 页签：不挤压、横向滚动并给滚动条提示
      '.dshaSv_manyTabs .dshaSv_tabs{gap:2px;overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;-webkit-overflow-scrolling:touch}',
      '.dshaSv_manyTabs .dshaSv_tabs::-webkit-scrollbar{height:3px}',
      '.dshaSv_manyTabs .dshaSv_tabs::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:2px}',
      '.dshaSv_manyTabs .dshaSv_tab{padding:1px 5px;gap:3px;font-size:11px}',
      '.dshaSv_manyTabs .dshaSv_tabBadge{min-width:13px;height:13px;line-height:13px;font-size:9px}',
      '.dshaSv_tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}',
      '.dshaSv_tab[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshaSv_tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_navBtn{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshaSv_quick{display:grid;gap:6px;grid-template-columns:repeat(2,minmax(0,1fr))}',
      '@container (max-width:379px){.dshaSv_quick{grid-template-columns:minmax(0,1fr)}}',
      '.dshaSv_listRow{display:flex;align-items:flex-start;gap:6px;padding:4px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_box>summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:center;min-width:0}',
      '.dshaSv_box>summary::-webkit-details-marker{display:none}',
      '.dshaSv_box>summary::before{content:"▸";color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}',
      '.dshaSv_box[open]>summary::before{content:"▾"}',
      '.dshaSv_box>summary .dshaSv_link{margin-left:auto}',
      '.dshaSv_listMain{display:grid;gap:0;min-width:0;flex:1}',
      '.dshaSv_listActions{display:flex;flex-wrap:wrap;gap:6px;padding-top:4px}',
      '.dshaSv_chips{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_navBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      // 页签折叠由 JS 量宽度后加 dshaSv_wide / dshaSv_narrow 控制：部分 WebView 旋转后
      // 容器查询不重算，会出现「宽屏还显示快捷入口 / 窄屏还显示折叠页签」的回归。
      '.dshaSv_narrow .dshaSv_foldTab{display:none}',
      '.dshaSv_wide .dshaSv_foldOnly{display:none}',
      '.dshaSv_tabBadge{display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;padding:0 4px;border-radius:99px;background:rgba(139,139,149,.18);color:var(--dsw-alias-label-secondary);font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.dshaSv_tabBadge[data-tone=warn]{background:rgba(240,136,62,.2);color:#f0883e}',
      '.dshaSv_tabBadge[data-tone=error]{background:rgba(248,113,113,.2);color:#f87171}',
      '.dshaSv_panel{display:grid;gap:6px;align-content:start;min-width:0}',
      '.dshaSv_panel[hidden]{display:none}',
      '.dshaSv_settingsHead .dshaSv_h{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshaSv_sync{display:grid;gap:4px}',
      '.dshaSv_syncLine{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dshaSv_syncK{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshaSv_syncCaret{font-size:10px;opacity:.55}',
      '.dshaSv_chipF svg{opacity:.85}',
      '.dshaSv_detailHead{display:grid;gap:3px;padding:2px 1px 4px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_settingsHead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_h{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:1.5}',
      '.dshaSv_mapIcon{color:#bc8cff}',
      '.dshaSv_tickets{display:grid;gap:6px}',
      '.dshaSv_ticket{display:grid;gap:2px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_ticketHead{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_ticketHead .dshaSv_grow,.dshaSv_ticketChild .dshaSv_grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_ticketNo{flex:none;font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}',
      '.dshaSv_ticketNo[data-missing]{color:var(--dsw-alias-label-tertiary,#8b8b95);font-weight:400}',
      '.dshaSv_ticketChild{display:flex;align-items:center;gap:6px;min-width:0;padding:3px 0 3px 14px;border-top:1px dashed var(--dsw-alias-border-l1)}',
      '.dshaSv_splitForm{display:grid;gap:6px;padding:6px 0 2px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_splitForm .dshaSv_row{flex-wrap:wrap}',
      '.dshaSv_tree{width:10px;flex:none;color:var(--dsw-alias-label-tertiary,#8b8b95);font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshaSv_pr{display:flex;align-items:center;gap:6px;min-height:28px;padding:4px 6px;border:1px solid transparent;border-radius:6px;color:inherit;text-decoration:none}',
      '.dshaSv_pr:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));border-color:var(--dsw-alias-border-l1)}',
      '.dshaSv_check{display:flex;align-items:flex-start;gap:6px;min-height:24px;padding:1px 0;font-size:11.5px;line-height:1.55;cursor:pointer}',
      '.dshaSv_check input{flex:none;margin:2px 0 0;accent-color:var(--accent)}',
      '.dshaSv_checkOff{opacity:.55;cursor:default}',
      '.dshaSv_pre{max-height:12em;overflow:auto;margin:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}',
      // 正文 / 评论：轻量富文本按散文渲染（不再用等宽 pre 块铺评论），长文四行折叠
      '.dshaSv_prose{margin:0;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshaSv_prose strong{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshaSv_prose code{padding:0 3px;border-radius:4px;background:rgba(139,139,149,.14);font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px}',
      '.dshaSv_hist{display:grid;gap:6px;padding:4px 0;font-size:11.5px}',
      '.dshaSv_box{display:grid;gap:5px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      // 第一块内容卡片去掉顶部圆角与顶边，和页签栏真正连成一块（用户 2026-11-08 要求）
      '.dshaSv_panel>.dshaSv_grid>.dshaSv_sec:first-child{border-top-left-radius:0;border-top-right-radius:0;border-top-width:0}',
      '.dshaSv_field{display:grid;gap:3px}',
      '.dshaSv_fieldLabel{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.dshaSv_draftCard{display:grid;gap:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_histItem{display:flex;align-items:center;gap:6px;min-width:0;padding:6px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_histItem .dshaSv_pill{max-width:9em}',
      '.dshaSv_arrow{flex:none;color:var(--dsw-alias-label-tertiary,#8b8b95);font-size:11px}',
      '.dshaSv_ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_titleLink{flex:1;min-width:0;color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_titleLink:hover{text-decoration:underline}',
      '.dshaSv_clamp{display:grid;gap:2px;min-width:0}',
      '.dshaSv_clampFold .dshaSv_prose{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;max-height:none}',
      '.dshaSv_clamp .dshaSv_link{justify-self:start}',
      '.dshaSv_diffAdd{color:#3fb950;font-variant-numeric:tabular-nums}',
      '.dshaSv_diffDel{color:#f85149;font-variant-numeric:tabular-nums}',
      '.dshaSv_filePath{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // PR / 同步只在宽侧栏出现；断点按侧栏容器宽度，不按屏幕宽度
      '.dshaSv_wideOnly{display:none}',
      '@container (min-width:460px){.dshaSv_wideOnly{display:block}}',
      // 宽侧栏 / 全屏：内容分两列，不把一行文字拉到满屏；卡片列表也两列
      '.dshaSv_grid{display:grid;gap:6px;grid-template-columns:minmax(0,1fr)}',
      // 任务页宽屏：左列表、右详情；窄栏选中时仍只显示详情
      '.dshaSv_split{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);align-items:start}',
      '@container (min-width:720px){.dshaSv_split{grid-template-columns:minmax(240px,.9fr) minmax(0,1.4fr)}}',
      '@container (max-width:719px){.dshaSv_split[data-picked] .dshaSv_taskList{display:none}}',
      '.dshaSv_span{min-width:0}',
      '@container (min-width:720px){.dshaSv_grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dshaSv_grid>.dshaSv_span{grid-column:1/-1}.dshaSv_cardsWide{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@container (max-width:380px){.dshaSv_detailHead .dshaSv_row{flex-wrap:wrap}.dshaSv_sync .dshaSv_taskActs .dshaSv_btn{padding-left:7px;padding-right:7px}}',
      // 极窄（初次展开）收紧外框和按钮，给内容多留几像素；页签仍横向滚动。
      '@container (max-width:360px){.dshaSv{padding:0 8px 18px;gap:0}.dshaSv_tab{padding-left:6px;padding-right:6px}.dshaSv_card{padding:5px 7px}.dshaSv_panel,.dshaSv_grid{gap:6px}.dshaSv_btn{padding-left:8px;padding-right:8px}}',
      // 窄侧栏：压缩筛选 / 按钮 / 分层，筛选行横向滚动，避免占两行
      '.dshaSv_repoPill{max-width:14em}',
      '@container (max-width:619px){.dshaSv .dshaSv_chipF{height:22px;padding:0 6px;font-size:10px;gap:3px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_chipDivider{height:12px;margin:0 1px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:4px;padding-bottom:1px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_btn{height:28px;min-height:28px;padding:1px 8px;font-size:11px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_icon{width:26px;height:26px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_head{gap:2px;padding-bottom:0}}',
      '@container (max-width:619px){.dshaSv .dshaSv_tabs{padding:0 0 4px;gap:3px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_tab{min-height:26px;padding:2px 8px;font-size:11.5px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_ws{font-size:12px;padding:1px 3px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_grid{gap:6px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_sec{gap:4px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_listRow{padding:6px 8px}}',
      '@container (max-width:619px){.dshaSv .dshaSv_repoPill{max-width:9em}}',
      '.dshaSv_ghCard{gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_ghStatus{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.dshaSv_pill{display:inline-flex;align-items:center;height:16px;max-width:100%;padding:0 6px;border:0;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // 全屏 / 宽栏同样收： specificity 高于后面的 pointer:coarse 规则
      '.dshaSv .dshaSv_icon{width:24px;height:24px}',
      '.dshaSv .dshaSv_btn{height:28px;min-height:28px;padding:1px 8px;font-size:11px}',
      '.dshaSv .dshaSv_chipF{height:22px;padding:0 6px;font-size:10.5px;gap:3px}',
      '.dshaSv .dshaSv_tab{min-height:24px;padding:1px 7px;font-size:11px}',
      '.dshaSv_ghTier{display:grid;gap:4px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_scopes{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_scope{display:inline-flex;align-items:center;height:18px;padding:0 7px;border:0;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1;white-space:nowrap}',
      '.dshaSv_filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.dshaSv_ghCard .dshaSv_row{flex-wrap:wrap}',
      '.dshaSv_ghFlow{display:grid;gap:4px}',
      '.dshaSv_code{padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;font-weight:600;letter-spacing:.06em;white-space:nowrap}',
      '.dshaSv_btn{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:1.5;cursor:pointer;white-space:nowrap}',
      '.dshaSv_btn:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_btn[data-primary]{border-color:transparent;background:var(--accent);color:#fff;font-weight:600}',
      '.dshaSv_btn[data-primary]:hover{background:var(--accent-hover)}',
      '.dshaSv_icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshaSv_icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_btn:focus-visible,.dshaSv_icon:focus-visible,.dshaSv_card:focus-visible,.dshaSv_chipF:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_chipF{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid transparent;border-radius:99px;background:rgba(139,139,149,.12);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}',
      '.dshaSv_chipDivider{flex:none;width:1px;height:14px;margin:0 2px;background:var(--dsw-alias-border-l1)}',
      '.dshaSv_chipF:hover{background:rgba(139,139,149,.2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_chipF[aria-pressed=true]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshaSv_sec{display:grid;gap:4px}',
      '.dshaSv_stageBar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 3px}',
      '.dshaSv_stage{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:99px;background:rgba(139,139,149,.12);color:var(--dsw-alias-label-secondary);font-size:10.5px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_stage[data-state=done]{color:var(--dsw-alias-state-success-primary);background:rgba(46,160,67,.13)}',
      '.dshaSv_stage[data-state=pending]{color:var(--dsw-alias-state-warn-primary);background:rgba(210,153,34,.13)}',
      '.dshaSv_stageDot{flex:none;width:5px;height:5px;border-radius:99px;background:currentColor;opacity:.85}',
      '.dshaSv_stageArrow{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;opacity:.7}',
      '.dshaSv_relCard{display:grid;gap:5px}',
      '.dshaSv_relFacts{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_stack{display:grid;gap:4px}',
      '.dshaSv_list{display:grid;gap:4px}',
      '.dshaSv_mail{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_mail>summary{display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;font-size:11.5px;line-height:1.5}',
      '.dshaSv_mailTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dshaSv_mail>p{margin:6px 0 0}',
      '.dshaSv_card{position:relative;display:grid;gap:3px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;overflow:hidden;transition:border-color .12s ease,background .12s ease}',
      '.dshaSv_card:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dshaSv_card[data-tone=muted]{opacity:.62}',
      '.dshaSv_row{display:flex;align-items:center;gap:5px;min-width:0}',
      '.dshaSv_title{flex:1;min-width:0;font-size:12.5px;font-weight:600;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}',
      '.dshaSv_lineCard{display:grid;gap:4px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_linePreview{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshaSv_lineFull{margin:0;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshaSv_sumBox{padding:4px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1))}',
      '.dshaSv_quote{padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}',
      '.dshaSv_sum{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      // 任务详情 note / 核验原始行：标签 + 两行截断，完整内容进 title
      '.dshaSv_noteText{min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshaSv_watchLine{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;min-width:0}',
      '.dshaSv_snap{display:grid;gap:4px}',
      '.dshaSv_snapItem{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}',
      '.dshaSv_snapName{flex:1 1 12em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_snapSub{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshaSv_snapLine{margin:0;overflow-wrap:anywhere}',
      '.dshaSv_sumFull{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;overflow-wrap:anywhere}',
      '.dshaSv_fields{display:grid;gap:2px}',
      '.dshaSv_fieldRow{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_fieldLabel{flex:none;min-width:3.2em;color:var(--dsw-alias-label-secondary);font-size:10.5px}',
      // 工作项共用详情（P1a）：底部抽屉外壳；右栏与嵌入面板共用，fixed 相对视口定位
      '.dshaSv_workOverlay{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.32)}',
      '.dshaSv_workSheet{width:min(640px,100%);max-height:min(78vh,38em);overflow:auto;overscroll-behavior:contain;display:grid;gap:6px;align-content:start;padding:8px 10px 10px;border:1px solid var(--dsw-alias-border-l2);border-bottom:0;border-radius:12px 12px 0 0;background:var(--dsw-alias-bg-base);box-shadow:0 -10px 32px rgba(0,0,0,.24)}',
      '.dshaSv_workHead{display:flex;align-items:center;gap:6px;min-width:0;position:sticky;top:0;z-index:1;padding:1px 0 4px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.dshaSv_workChips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
      '.dshaSv_workTitle{margin:0;font-size:12.5px;font-weight:600;line-height:1.45;overflow-wrap:anywhere}',
      '.dshaSv_workFields{display:grid;gap:4px}',
      // 票子驾驶舱（T15）：判定胶囊 + 阶段 / 审批 / 拉起动作；沿用其它块的间距与描边
      '.dshaSv_cockpit{display:grid;gap:6px;padding:7px 0 2px;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.dshaSv_cockpitHead{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0}',
      '.dshaSv_checks{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
      '.dshaSv_cockpitGrid{display:grid;gap:3px;min-width:0}',
      '.dshaSv_cockpitHint{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5}',
      '.dshaSv_stageRow{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_launchBox{display:grid;gap:5px;padding:6px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.dshaSv_workField{display:flex;align-items:flex-start;gap:6px;min-width:0}',
      '.dshaSv_workFieldK{flex:none;width:4.8em;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}',
      '.dshaSv_workFieldV{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11.5px;line-height:1.55;overflow-wrap:anywhere}',
      '.dshaSv_workBody{display:grid;gap:6px;min-width:0}',
      '.dshaSv_workActs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:sticky;bottom:0;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.dshaSv_workActs .dshaSv_listActions{flex:1 1 100%;padding-top:0}',
      '.dshaSv_workRow{cursor:pointer}',
      '.dshaSv_workRow:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_workRow:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_metaChips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
      '.dshaSv_metaChip{display:inline-flex;align-items:center;max-width:12em;height:16px;padding:0 6px;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_metaChip[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshaSv_pill[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-weight:700;font-size:10.5px;letter-spacing:.2px}',
      '.dshaSv_pill[data-tone=warn]{background:rgba(240,136,62,.16);color:#f0883e}',
      '.dshaSv_pill[data-tone=error]{background:rgba(248,113,113,.16);color:#f87171}',
      '.dshaSv_pill[data-tone=ok]{background:rgba(63,185,80,.16);color:#3fb950}',
      '.dshaSv_pill[data-tone=brand]{background:rgba(88,166,255,.16);color:#58a6ff}',
      '.dshaSv_pill[data-tone=map]{background:rgba(188,140,255,.16);color:#bc8cff}',
      // T16：PR 审核 11 态里需要和已有色调区分的四种（已合并 / 已关闭 / 已忽略 / 已审核）
      '.dshaSv_pill[data-tone=merged]{background:rgba(188,140,255,.18);color:#bc8cff}',
      '.dshaSv_pill[data-tone=closed]{background:rgba(139,148,158,.18);color:#9aa4ae}',
      '.dshaSv_pill[data-tone=ignored]{background:rgba(110,118,129,.14);color:#7d8590}',
      '.dshaSv_pill[data-tone=reviewed]{background:rgba(86,212,221,.16);color:#56d4dd}',
      '.dshaSv_legend{display:grid;gap:3px;padding:6px 7px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.dshaSv_legendGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:4px 8px;min-width:0}',
      '.dshaSv_legendItem{display:grid;gap:1px;min-width:0;font-size:10.5px;line-height:1.4}',
      '.dshaSv_legendItem .dshaSv_pill{justify-self:start}',
      '.dshaSv_pillBtn{font:inherit;background:none;cursor:pointer}',
      '.dshaSv_pillBtn:hover{filter:brightness(1.25)}',
      '.dshaSv_state{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l2))}',
      '.dshaSv_state[data-state=running]{background:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_state[data-state=idle]{background:var(--dsw-alias-state-idle-primary)}',
      '.dshaSv_star{color:var(--dsw-alias-state-warn-primary);flex:none;display:inline-flex}',
      '.dshaSv_link{justify-self:start;padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:12px;cursor:pointer}',
      '.dshaSv_task{display:flex;align-items:center;gap:6px;min-width:0;padding:1px 0}',
      '.dshaSv_task .dshaSv_grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_taskBtn{width:100%;border:1px solid transparent;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:7px;padding:4px 7px}',
      '.dshaSv_taskBtn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}',
      '.dshaSv_taskBtn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_groupBtn{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:3px 4px;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;font-weight:600;text-align:left;cursor:pointer;border-radius:6px}',
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
      '.dshaSv_btn[aria-disabled=true]{opacity:.85;cursor:default}',
      '.dshaSv_muted{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}',
      '.dshaSv_alert{padding:5px 9px;border:1px solid rgba(240,136,62,.45);border-radius:7px;background:rgba(240,136,62,.12);color:#f0883e;font-size:11.5px;line-height:1.55}',
      '.dshaSv_alert[data-tone=error]{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.12);color:#f87171}',
      '.dshaSv_hr{height:1px;background:var(--dsw-alias-border-l1)}',
      '.dshaSv_kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:11.5px;line-height:1.55}',
      '.dshaSv_kv dt{color:var(--dsw-alias-label-secondary)}',
      '.dshaSv_kv dd{margin:0;min-width:0;overflow-wrap:anywhere}',
      '.dshaSv_crumb{color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_big{font-size:15.5px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}',
      '.dshaSv_chipF b{font-weight:700;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dshaSv_chipF[data-tone=warn] b{color:#f0883e}',
      '.dshaSv_chipF[data-tone=ok] b{color:#3fb950}',
      '.dshaSv_chipF[aria-pressed=true] b{color:inherit}',
      '.dshaSv_main{padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--accent);border-radius:9px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
      '.dshaSv_main:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_main:focus-visible,.dshaSv_line:focus-visible,.dshaSv_link:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_line{display:flex;gap:8px;align-items:baseline;min-width:0;padding:0;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.dshaSv_lineK{flex:none;font-weight:600}',
      '.dshaSv_lineV{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_line[data-open] .dshaSv_lineV{white-space:pre-wrap;word-break:break-word}',
      '.dshaSv_ask{display:grid;gap:6px;padding:8px 10px;border:1px solid rgba(240,136,62,.45);border-radius:9px;background:rgba(240,136,62,.08)}',
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
      '.dshaSv_input{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.55;resize:vertical}',
      '.dshaSv_input:focus-visible{outline:2px solid var(--accent);outline-offset:0}',
      '.dshaSv_picker{position:relative;min-width:0;flex:1 1 12em}',
      '.dshaSv_pickerBtn{display:inline-flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.55;text-align:left;cursor:pointer}',
      '.dshaSv_pickerBtn:disabled{opacity:.6;cursor:default}',
      '.dshaSv_pickerNow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_caret{flex:none;opacity:.6}',
      '.dshaSv_pickerPop{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);max-height:min(46vh,17em);overflow-y:auto;overscroll-behavior:contain;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px rgba(0,0,0,.16)}',
      '.dshaSv_pickerGroup{margin:6px 4px 2px;color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600}',
      '.dshaSv_pickerItem{display:flex;align-items:center;gap:6px;width:100%;padding:5px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;text-align:left;cursor:pointer}',
      '.dshaSv_pickerItem:hover,.dshaSv_pickerItem[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dshaSv_pickerItem[aria-selected=true]{font-weight:600}',
      '.dshaSv_pickerTick{width:1em;flex:none;color:var(--accent)}',
      '.dshaSv_check input[type=checkbox]{accent-color:var(--accent)}',
      '@keyframes dshaSv_fadeIn{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}',
      '.dshaSv_note{animation:dshaSv_fadeIn .16s ease;margin:0 0 6px}',
      '@keyframes dshaSv_action{0%{transform:scale(.6);opacity:.15}35%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:0}}',
      '.dshaSv_actionPulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);animation:dshaSv_action .6s ease-out}',
      '@keyframes dshaSv_spin{to{transform:rotate(360deg)}}',
      '.dshaSv_icon[data-busy] svg{animation:dshaSv_spin .8s linear infinite}',
      '.dshaSv_freshDot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.7;flex:none}',
      '.dshaSv_freshDot[data-tone=warn]{background:var(--dsw-alias-state-warn-primary,#d29922);opacity:1}',
      '.dshaSv_freshDot[data-tone=error]{background:var(--dsw-alias-state-error-primary,#f85149);opacity:1}',
      '.dshaSv_done{color:var(--accent);font-weight:700;animation:dshaSv_action .5s ease-out}',
      '@keyframes dshaSv_rowFlash{0%{background-color:var(--dsw-alias-interactive-bg-active,rgba(65,118,230,.18))}100%{background-color:transparent}}',
      '.dshaSv_card[data-updated=true]{animation:dshaSv_rowFlash 1.5s ease-out}',
      '.dshaSv_task[data-updated=true]{animation:dshaSv_rowFlash 1.5s ease-out}',
      '.dshaSv_pickerPop{animation:dshaSv_fadeIn .12s ease}',
      '.dshaSv_foot{display:flex;flex-wrap:wrap;align-items:center;gap:3px 5px;min-width:0}',
      '.dshaSv_meta{flex:1 1 90px;min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_acts{display:inline-flex;gap:4px;margin-left:auto}',
      '@media (pointer:coarse){.dshaSv_btn{height:32px}.dshaSv_icon{width:32px;height:32px}.dshaSv_chipF{height:30px}.dshaSv_tab{min-height:34px}.dshaSv_pr{min-height:34px}.dshaSv_check{min-height:34px}}',
      '@media (prefers-reduced-motion:reduce){.dshaSv_chevRot{transition:none}.dshaSv_note,.dshaSv_pickerPop,.dshaSv_actionPulse,.dshaSv_done,.dshaSv_card[data-updated=true],.dshaSv_task[data-updated=true]{animation:none}.dshaSv_icon[data-busy] svg{animation:none}}'
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
    const IconGear = () => svg('M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM13.3 9.6l1.2.9-1.3 2.2-1.4-.5c-.5.4-1 .7-1.6.9l-.2 1.5H6.8l-.2-1.5c-.6-.2-1.1-.5-1.6-.9l-1.4.5-1.3-2.2 1.2-.9c-.1-.3-.1-.6-.1-.9s0-.6.1-.9l-1.2-.9 1.3-2.2 1.4.5c.5-.4 1-.7 1.6-.9l.2-1.5h2.6l.2 1.5c.6.2 1.1.5 1.6.9l1.4-.5 1.3 2.2-1.2.9c.1.3.1.6.1.9s0 .6-.1.9z');
    const IconMap = () => svg('M2.5 3.5 6 2l4 1.5L13.5 2v10.5L10 14l-4-1.5L2.5 14zM6 2v10.5M10 3.5V14');
    const IconList = () => svg('M6 3.5h7.5M6 8h7.5M6 12.5h7.5M2.7 3.5h.01M2.7 8h.01M2.7 12.5h.01');
    const IconSearch = () => svg('M7.2 2.5a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zM10.6 10.6 13.5 13.5');
    const IconChecklist = () => svg('M2.5 4.2h1.4l1.1 1.1 2-2.1M2.5 11.4h1.4l1.1 1.1 2-2.1M9.5 4.5H14M9.5 11.8H14');
    const IconHandoff = () => svg('M3 5.5h7.8l-2-2M13 10.5H5.2l2 2');
    const IconActivity = () => svg('M2.5 8h2.8l1.6-4.2 2.4 8.4 1.6-4.2h2.6');
    const IconFolder = () => svg('M2.5 4.8a1 1 0 0 1 1-1h3l1.4 1.4h4.6a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z');
    const IconTarget = () => svg('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z');
    const IconPlay = () => svg('M5.5 3.5l7 4.5-7 4.5z');
    const IconCheck = () => svg('M3 8.5l3.4 3L13 4.5');
    const IconArchive = () => svg('M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2 3.5h12v2H2zM6.5 8.5h3');
    const IconPr = () => svg('M4.5 3.5v9M4.5 3.5h2.2a2.8 2.8 0 0 1 2.8 2.8v5.7M3.2 12.2a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 0 0-2.6 0zM9.7 12.2a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 0 0-2.6 0z');
    const IconBranch = () => svg('M5 4.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM5 7v5.5M11 3.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM11 6v2.2a2.3 2.3 0 0 1-2.3 2.3H7');
    const IconIssue = () => svg('M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z');
    const IconMore = () => svg('M3.2 8h.01M8 8h.01M12.8 8h.01');
    const IconMail = () => svg('M2.5 4.2a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7.6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.8 4.6 8 8.6l5.2-4');
    /** 窄屏折叠进「更多」的页签。 */
    const FOLD_PAGES = [['map', 'sideTabMap', IconMap], ['prs', 'sideTabPr', IconPr], ['branches', 'sideTabBranches', IconBranch], ['issues', 'sideTabIssues', IconIssue]];

    /* 分组：以服务端按事实给的 category 为准，没有时按汇报状态推 */

    function categoryOf(entry) {
      if (typeof entry.category === 'string') return entry.category;
      if ((entry.status === 'question' || entry.status === 'blocked') && !entry.answered) return 'attention';
      if (entry.status === 'ready') return 'ready';
      if (entry.status === 'done' || entry.status === 'abandoned') return 'archived';
      return 'active';
    }

    const isAttention = (entry) => categoryOf(entry) === 'attention';
    const isReady = (entry) => categoryOf(entry) === 'ready';
    const isDone = (entry) => categoryOf(entry) === 'archived';
    const isActive = (entry) => categoryOf(entry) === 'active';
    // 状态胶囊：需要处理的卡片说「为什么找你」（待答复 / 受阻 / 最后一轮出错 / 上下文过大），
    // 不显示可能已经过时的汇报状态；空白 / 久未活动显示分组名

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

    // 首屏/轮询只拉轻量快照；完整快照后台补一次（重字段：任务看板、声明、仓库、同步、GitHub）。

    const FULL_TTL_MS = 5 * 60_000;
    function useBoard(kit, sessionId, visible, pollSteps = POLL_STEPS) {
      const [state, setState] = React.useState(() => {
        const hit = lastBoards.get(sessionId);
        if (hit !== undefined) return hit;
        const saved = readBoardSnapshot(sessionId);
        if (saved !== undefined) {
          lastBoards.set(sessionId, saved);
          if (lastBoards.size > 8) lastBoards.delete(lastBoards.keys().next().value);
          return saved;
        }
        return { board: undefined, error: undefined, at: undefined, hydrating: false };
      });
      const [tick, setTick] = React.useState(0);
      const refreshRequested = React.useRef(false);
      React.useEffect(() => {
        if (!visible || typeof sessionId !== 'string' || sessionId === '') return undefined;
        let alive = true;
        let controller;
        let fullController;
        let hydrating = false;
        let timer;
        let quiet = 0; // 连续「没变化」的次数
        let flashTimer;
        const HEAVY = ['taskBoard', 'declarations', 'repo', 'sync', 'setup'];
        const schedule = () => {
          clearTimeout(timer);
          const reading = lastBoards.get(sessionId)?.board?.github?.reading === true;
          timer = setTimeout(load, reading ? READING_POLL_MS : pollSteps[Math.min(quiet, pollSteps.length - 1)]);
        };
        const mergeEntries = (previous, next) => {
          if (!Array.isArray(previous)) return next;
          const old = new Map(previous.map((entry) => [entry.sessionId, entry]));
          return next.map((entry) => {
            const before = old.get(entry.sessionId);
            return before !== undefined && JSON.stringify(before) === JSON.stringify(entry) ? before : { ...before, ...entry };
          });
        };
        const mergeLight = (payload, previous) => {
          if (!payload.partial || previous === undefined) return { ...payload, partial: false };
          const keep = {};
          for (const key of HEAVY) if (previous[key] !== undefined) keep[key] = previous[key];
          return { ...previous, ...payload, entries: mergeEntries(previous.entries, payload.entries), ...keep, partial: false };
        };
        const commit = (board, { version, fullAt }) => {
          const at = Date.now();
          const entry = { board, at, version, fullAt, fromStore: false };
          lastBoards.delete(sessionId);
          lastBoards.set(sessionId, entry);
          if (lastBoards.size > 8) lastBoards.delete(lastBoards.keys().next().value);
          writeBoardSnapshot(sessionId, entry);
          setState((prev) => ({ board, error: undefined, at, hydrating: false, version, fromStore: false, refreshing: prev.refreshing }));
        };
        function hydrate() {
          if (hydrating || !alive) return;
          hydrating = true;
          setState((prev) => ({ ...prev, hydrating: true }));
          fullController?.abort?.();
          fullController = typeof AbortController === 'function' ? new AbortController() : undefined;
          requestBoardOnce(kit, { view: 'board', session: sessionId }).then(
            (payload) => {
              if (!alive || !Array.isArray(payload.entries)) return;
              const cached = lastBoards.get(sessionId);
              const board = { ...payload, entries: mergeEntries(cached?.board?.entries, payload.entries) };
              commit(board, { version: cached?.version, fullAt: Date.now() });
            },
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ ...prev, hydrating: false })); }
          ).finally(() => {
            hydrating = false;
            if (alive) setState((prev) => (prev.hydrating ? { ...prev, hydrating: false } : prev));
          });
        }
        function load() {
          if (!alive) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { schedule(); return; }
          controller?.abort?.();
          controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          const cached = lastBoards.get(sessionId);
          const needsFull = cached?.fullAt === undefined || Date.now() - cached.fullAt > FULL_TTL_MS;
          requestBoardOnce(kit, { view: 'board', session: sessionId, light: 1, since: cached?.version }).then(
            (payload) => {
              if (!alive) return;
              if (payload.notModified === true) {
                quiet += 1;
                const hit = lastBoards.get(sessionId);
                if (hit) {
                  const next = { ...hit, at: Date.now(), fromStore: false };
                  lastBoards.set(sessionId, next);
                  setState((prev) => ({ board: next.board, error: undefined, at: next.at, version: next.version, hydrating: false, fromStore: false, refreshing: prev.refreshing }));
                }
                if (needsFull) hydrate();
                return;
              }
              if (!Array.isArray(payload.entries)) return;
              quiet = 0;
              const full = payload.partial !== true;
              commit(mergeLight(payload, cached?.board), { version: payload.version, fullAt: full ? Date.now() : (cached?.fullAt ?? 0) });
              if (!full && needsFull) hydrate();
            },
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ ...prev, error: kit.errorText(kit.t, error), fromStore: false })); }
          ).finally(() => {
            if (!alive) return;
            schedule();
            setState((prev) => (prev.refreshing ? { ...prev, refreshing: false, flash: true } : prev));
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => { if (alive) setState((prev) => (prev.flash ? { ...prev, flash: false } : prev)); }, 2500);
          });
        }
        const wake = () => { if (document.visibilityState !== 'hidden') { quiet = 0; load(); } };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
        // 缓存很新（<5s）时先排下一次轮询，不在挂载瞬间再拉一遍；手动刷新走后门立即拉
        const cachedEntry = lastBoards.get(sessionId);
        const cachedAt = cachedEntry?.at;
        if (refreshRequested.current) { refreshRequested.current = false; load(); }
        else if (cachedEntry?.fromStore !== true && typeof cachedAt === 'number' && Date.now() - cachedAt < 5000) schedule();
        else load();
        return () => {
          alive = false;
          clearTimeout(timer);
          clearTimeout(flashTimer);
          controller?.abort?.();
          fullController?.abort?.();
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake);
        };
      }, [kit, sessionId, visible, tick]);
      // 只补任务板：不发完整快照（完整快照会顺带做 repo / 声明 / GitHub 的远端校验，任务页会因此闪）
      const refreshTasks = () => {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        requestBoardOnce(kit, { view: 'board', session: sessionId, light: 1, tasks: 1 }).then(
          (payload) => {
            if (!payload || payload.notModified === true || payload.taskBoard === undefined) return;
            setState((prev) => {
              if (!prev.board) return prev;
              const at = Date.now();
              const board = { ...prev.board, taskBoard: payload.taskBoard };
              const hit = lastBoards.get(sessionId);
              if (hit) {
                const next = { ...hit, board, at, fromStore: false };
                lastBoards.set(sessionId, next);
                writeBoardSnapshot(sessionId, next);
              }
              return { ...prev, board, at, fromStore: false };
            });
          },
          () => {});
      };
      return [state, () => {
        refreshRequested.current = true;
        setState((prev) => ({ ...prev, refreshing: true, fromStore: false }));
        const cached = lastBoards.get(sessionId);
        if (cached) lastBoards.set(sessionId, { ...cached, fullAt: 0 });
        setTick((value) => value + 1);
      }, refreshTasks];
    }

    /* 卡片：整张可点（键盘 Enter / 空格），里面的按钮不冒泡 */

    function Skeleton() {
      return h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' })));
    }


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
      return h('button', { type: 'button', className: 'dshaSv_pill dshaSv_pillBtn', 'data-tone': tone, title: title + ' · ' + kit.t('sideSettings'), 'aria-label': title, 'aria-expanded': expanded === true, role: bad ? 'alert' : undefined, onClick }, bad ? '⚠ ' + text : text);
    }

    /** 窄栏折叠页的返回：并进页头，宽栏由 dshaSv_foldOnly 隐藏。 */

    const TABS = [
      ['sessions', 'sideTabSessions', IconList, 'main'],
      ['tasks', 'sideTabTasks', IconChecklist, 'main'],
      ['handoff', 'sideTabHandoff', IconHandoff, 'main'],
      ['map', 'sideTabMap', IconMap, 'fold'],
      ['prs', 'sideTabPr', IconPr, 'fold'],
      ['branches', 'sideTabBranches', IconBranch, 'fold'],
      ['issues', 'sideTabIssues', IconIssue, 'fold'],
      ['mail', 'sideTabMail', IconMail, 'main'],
      ['more', 'sideTabMore', IconMore, 'main']
    ];

    /** 主页签：宽屏 8 个；窄屏（容器 <620px）地图/PR/分支/问题 折进「更多」，用容器查询控制。 */

    function collectPrs(tasks) {
      if (tasks === null || tasks === undefined) return [];
      const seen = new Set();
      const out = [];
      for (const row of [...(tasks.open ?? []), ...(tasks.claimedRows ?? []), ...(tasks.endedRows ?? [])]) {
        const pr = row.pr;
        if (!pr || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push({ id: row.id, number: pr.number ?? null, url: pr.url ?? null, label: pr.label ?? ('PR #' + pr.number) });
      }
      return out;
    }

    /** 会话页顶部的找会话：按 id 前缀 / @别名 / 标题问服务端（只读），结果可直接打开。 */

    /* ---------------------------------------------------------------- 页签壳（T13 按需 chunk） */

    // 跨页工作项 kind → 页签；外壳只做跳转，详情组件在对应 chunk（T12 P1a 原逻辑）。
    const WORK_ITEM_TAB = { task: 'tasks', 'map-ticket': 'map', issue: 'issues', pr: 'prs' };
    function workItemTabKey(kind) { return WORK_ITEM_TAB[kind]; }

    // 外壳只保留 TABS / TabBar / RelaySidebar / useBoard 与加载器；共享件与各页签正文在
    // client.sidebar.<name><KIT>.js 里按需 require.async。文件名按 KIT 命名：KIT 一升全部换 URL，
    // WebView 不会命中 immutable 旧缓存；每个 chunk 自带 KIT_VERSION，加载后校验。
    const CHUNK_FILES = {
      shared: 'client.sidebar.shared' + SIDEBAR_KIT + '.js',
      sessions: 'client.sidebar.sessions' + SIDEBAR_KIT + '.js',
      tasks: 'client.sidebar.tasks' + SIDEBAR_KIT + '.js',
      handoff: 'client.sidebar.handoff' + SIDEBAR_KIT + '.js',
      map: 'client.sidebar.map' + SIDEBAR_KIT + '.js',
      prs: 'client.sidebar.prs' + SIDEBAR_KIT + '.js',
      branches: 'client.sidebar.branches' + SIDEBAR_KIT + '.js',
      issues: 'client.sidebar.issues' + SIDEBAR_KIT + '.js',
      mail: 'client.sidebar.mail' + SIDEBAR_KIT + '.js',
      more: 'client.sidebar.more' + SIDEBAR_KIT + '.js',
      settings: 'client.sidebar.settings' + SIDEBAR_KIT + '.js'
    };
    // 右栏与嵌入面板共用同一份加载器缓存（模块级 Map）：同一 chunk 只下载 / 执行一次。
    const chunkModules = new Map();
    const chunkPromises = new Map();
    const chunkParts = new Map();
    const chunkFailures = new Map();
    // 最近一次加载顺序（测试与排查用）
    const chunkEdges = [];
    const prefetchTimers = new Map();

    function chunkError(name, kind, actual) {
      const error = new Error('sidebar chunk ' + name + ' ' + kind);
      error.chunk = name;
      error.kind = kind;
      if (actual !== undefined) error.actual = actual;
      return error;
    }
    /** 省流量模式下不预取；普通打开页签仍照常按需加载。 */
    function prefetchAllowed() {
      try {
        const connection = typeof navigator === 'undefined' ? undefined : navigator.connection;
        return !(connection && connection.saveData === true);
      } catch { return true; }
    }
    /** 传给 chunk 的依赖：图标、外壳工具、共享件。chunk 之间不能同步 require，共用件只能这样传。 */
    function chunkDeps() {
      return { React, h, icons: ICONS, ui: UI };
    }
    function chunkPartsOf(name) {
      const cached = chunkParts.get(name);
      if (cached !== undefined) return cached;
      const mod = chunkModules.get(name);
      if (mod === undefined || mod === null) return undefined;
      try {
        const parts = name === 'shared'
          ? mod.make(chunkDeps())
          : mod.make({ ...chunkDeps(), shared: chunkPartsOf('shared') });
        chunkParts.set(name, parts);
        return parts;
      } catch (error) {
        chunkFailures.set(name, chunkError(name, 'make'));
        return undefined;
      }
    }
    /** 加载一个 chunk；页签 chunk 会先确保共享件在（共享件只拉一次）。 */
    function loadChunk(name) {
      if (chunkModules.has(name)) return Promise.resolve(chunkModules.get(name));
      const pending = chunkPromises.get(name);
      if (pending !== undefined) return pending;
      const file = CHUNK_FILES[name];
      if (file === undefined || typeof require?.async !== 'function') {
        chunkFailures.set(name, chunkError(name, 'load'));
        return Promise.resolve(undefined);
      }
      let task;
      const ready = name === 'shared' ? Promise.resolve() : loadChunk('shared');
      task = ready.then(() => {
        if (chunkModules.has(name)) return chunkModules.get(name);
        if (name !== 'shared' && chunkPartsOf('shared') === undefined) throw chunkError(name, 'shared');
        chunkEdges.push(file);
        return Promise.resolve(require.async('./' + file)).then((mod) => {
          if (mod === null || mod === undefined) throw chunkError(name, 'load');
          if (mod.KIT_VERSION !== SIDEBAR_KIT) throw chunkError(name, 'stale', mod.KIT_VERSION);
          if (typeof mod.make !== 'function') throw chunkError(name, 'shape');
          chunkModules.set(name, mod);
          chunkFailures.delete(name);
          return mod;
        });
      }).catch((error) => {
        chunkFailures.set(name, error !== null && typeof error === 'object' && error.chunk !== undefined ? error : chunkError(name, 'load'));
        return undefined;
      }).finally(() => { if (chunkPromises.get(name) === task) chunkPromises.delete(name); });
      chunkPromises.set(name, task);
      return task;
    }
    function ensureChunk(name, retry = false) {
      if (CHUNK_FILES[name] === undefined) return Promise.resolve(undefined);
      if (retry) { chunkFailures.delete(name); chunkParts.delete(name); }
      const parts = chunkPartsOf(name);
      if (parts !== undefined) return Promise.resolve(parts);
      return loadChunk(name).then((mod) => (mod === undefined ? undefined : chunkPartsOf(name)));
    }
    /** 悬停页签 200ms 后预取，受 saveData 抑制；右栏与嵌入面板共用同一份缓存。 */
    function prefetchChunk(name, delayMs = 200) {
      if (CHUNK_FILES[name] === undefined || !prefetchAllowed()) return;
      if (chunkModules.has(name) || chunkPromises.has(name)) return;
      const previous = prefetchTimers.get(name);
      if (previous !== undefined) clearTimeout(previous);
      const timer = setTimeout(() => {
        prefetchTimers.delete(name);
        void loadChunk(name);
      }, delayMs);
      if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref();
      prefetchTimers.set(name, timer);
    }
    function cancelPrefetch(name) {
      const timer = prefetchTimers.get(name);
      if (timer === undefined) return;
      clearTimeout(timer);
      prefetchTimers.delete(name);
    }
    /** 失败回退：加载中给同高骨架；失败给最小一行（stale 附实际 / 期望版本），可重试。 */
    function chunkPanel(kit, name, retry) {
      const parts = chunkPartsOf(name);
      if (parts !== undefined) return { parts };
      const failure = chunkFailures.get(name);
      if (failure === undefined) {
        return {
          node: h('div', { className: 'dshaSv_list', 'aria-hidden': 'true' },
            ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' })))
        };
      }
      const stale = failure.kind === 'stale';
      const text = stale
        ? kit.t('sideStale') + ' (v' + (failure.actual === undefined ? '?' : failure.actual) + ' → v' + SIDEBAR_KIT + ')'
        : kit.t('sideLoadFailed');
      return {
        node: h('p', { className: 'dshaSv_alert dshaSv_muted', 'data-tone': 'error', role: 'alert' },
          text + ' ',
          h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => retry(name) }, kit.t('tasksRefresh')))
      };
    }
    /** 测试 / 同步场景：把已加载的 chunk 模块登记进同一份缓存（生产只走 require.async）。 */
    function registerChunks(modules) {
      for (const [name, mod] of Object.entries(modules === null || modules === undefined ? {} : modules)) {
        if (mod === null || mod === undefined) continue;
        if (mod.KIT_VERSION !== SIDEBAR_KIT || typeof mod.make !== 'function') throw new Error('sidebar chunk ' + name + ' 版本不配套 / 形状不对');
        chunkModules.set(name, mod);
      }
      chunkParts.clear();
      chunkFailures.clear();
      return chunkPartsOf('shared');
    }

    /* ---------------------------------------------------------------- 页签 */

    /** 主页签：宽屏 8 个；窄屏（容器 <620px）地图/PR/分支/问题 折进「更多」，用容器查询控制。 */
    function TabBar({ kit, tab, onTab, counts, tabs = TABS, onPrefetch }) {
      const { t } = kit;
      return h('div', { className: 'dshaSv_tabs', role: 'tablist', 'aria-label': t('sideTitle') },
        ...tabs.map(([key, label, Icon, group]) => {
          const badge = counts?.[key];
          return h('button', {
            key, type: 'button', role: 'tab', id: 'dshaSv-tab-' + key,
            className: group === 'fold' ? 'dshaSv_tab dshaSv_foldTab' : 'dshaSv_tab',
            'aria-selected': tab === key ? 'true' : 'false',
            title: t(label),
            onPointerEnter: typeof onPrefetch === 'function' ? () => onPrefetch(key) : undefined,
            onPointerLeave: typeof onPrefetch === 'function' ? () => onPrefetch(key, true) : undefined,
            onFocus: typeof onPrefetch === 'function' ? () => onPrefetch(key) : undefined,
            onBlur: typeof onPrefetch === 'function' ? () => onPrefetch(key, true) : undefined,
            onClick: () => { if (typeof onPrefetch === 'function') onPrefetch(key, true); onTab(key); }
          }, h(Icon), t(label), badge ? h('span', { className: 'dshaSv_tabBadge', 'data-tone': badge.tone, 'aria-label': badge.label }, String(badge.value)) : null);
        }));
    }

    /** 外壳依赖：chunk 需要从外壳拿的图标 / 工具 / 共享件（chunk 之间不能同步 require）。 */
    const ICONS = { IconRefresh, IconCopy, IconBack, IconOpen, IconStar, IconGear, IconMap, IconList, IconSearch, IconChecklist, IconHandoff, IconActivity, IconFolder, IconTarget, IconPlay, IconCheck, IconArchive, IconPr, IconBranch, IconIssue, IconMore, IconMail };
    const UI = { agoText, categoryOf, isAttention, isReady, isDone, isActive, collectPrs, FOLD_PAGES, memo, usePersisted, readRemoteSnapshot, writeRemoteSnapshot };

    function RelaySidebar({ kit, sessionId, useTabInfo, persistPrefix = '', extraTabs, embedded = false, pollMs }) {
      const { t } = kit;
      useStyle();
      const visible = useVisible(useTabInfo);
      // 嵌入面板可在两端插入额外页签（概览 / 全文搜索）；右侧边栏不传，仍是原 9 页签
      const extraList = Array.isArray(extraTabs) ? extraTabs.filter((item) => item !== null && item !== undefined && typeof item.key === 'string' && typeof item.render === 'function') : [];
      const hasExtra = (key) => extraList.some((item) => item.key === key);
      const renderExtra = (key) => { const item = extraList.find((entry) => entry.key === key); return item === undefined ? null : item.render(); };
      const tabs = extraList.length === 0 ? TABS : [
        ...(hasExtra('overview') ? [['overview', 'sideUtilityOverview', IconList, 'main']] : []),
        ...TABS.filter(([key]) => key !== 'more'),
        ...(hasExtra('search') ? [['search', 'sideUtilitySearch', IconSearch, 'main']] : []),
        ...TABS.filter(([key]) => key === 'more')
      ];
      // 嵌入面板与右侧边栏可能同时开着：嵌入侧默认降频（60s），右侧边栏保持原节奏
      const pollSteps = pollMs === undefined ? POLL_STEPS : [pollMs, pollMs, pollMs * 2, pollMs * 3];
      const [{ board, error, at, refreshing, flash, hydrating, fromStore }, refresh, refreshTasks] = useBoard(kit, sessionId, visible, pollSteps);
      const [filter, setFilter] = usePersisted('filter', 'all', persistPrefix);
      const [selected, setSelected] = React.useState(undefined);
      const [lineOpen, setLineOpen] = usePersisted('line', false, persistPrefix);
      const [copied, setCopied] = React.useState(undefined);
      const [quietOpen, setQuietOpen] = usePersisted('quiet', false, persistPrefix);
      // 「可接」列表展开：沿用原来的本机记忆键，切会话 / 重开标签后保持
      const [tasksOpen, setTasksOpen] = usePersisted('tasks', false, persistPrefix);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      const [doneOpen, setDoneOpen] = usePersisted('done', false, persistPrefix);
      // 主页签存本机（旧版 'activity' 读成 'more'）；设置从顶栏齿轮打开，不占页签
      const [tab, setTab] = usePersisted('tab', 'sessions', persistPrefix);
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [updatedIds, setUpdatedIds] = React.useState(undefined);
      // T12 跨页工作项跳转：openWorkItem({ kind, id }) 切页签并把焦点交给目标页，目标页打开详情后清空
      const [workItem, setWorkItem] = React.useState(undefined);
      const openWorkItem = React.useCallback((target) => {
        if (target === null || typeof target !== 'object') return;
        const tabKey = workItemTabKey(target.kind);
        if (tabKey === undefined) return;
        setTab(tabKey);
        if (target.kind === 'task' || target.id === undefined || target.id === null || target.id === '') { setWorkItem(undefined); return; }
        setWorkItem({ kind: target.kind, id: target.id, seq: Date.now() });
      }, [setTab]);
      const consumeWorkItem = React.useCallback(() => setWorkItem(undefined), []);
      // 页签计数（PR / 问题 / 邮箱未读）：单独轻量拉取，不跟看板轮询绑在一起；刷新页面先用上次计数
      const [railCounts, setRailCounts] = React.useState(() => readCountsSnapshot(sessionId) ?? {});
      // 用户看过的页签保持挂载（hidden），保住任务详情 / 交接草稿输入 / 折叠状态；没看过的不挂载
      const seenRef = React.useRef(undefined);
      // 进详情前记下列表滚动位置，返回时还原
      const rootRef = React.useRef(null);
      // 卫星环「打开完整面板」：已打开的侧栏直接从设置页进入
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
        const openWatch = () => setSettingsOpen(true);
        window.addEventListener('dsh-session-relay:open-watch', openWatch);
        return () => window.removeEventListener('dsh-session-relay:open-watch', openWatch);
      }, []);
      // 容器宽度决定页签折叠：ResizeObserver 监听 root，旋转后立即重算（容器查询在部分 WebView 不重算）
      const [wide, setWide] = React.useState(false);
      // chunk 加载完成 / 重试后重画（值本身不用，只用于触发一次渲染）
      const [chunkTick, setChunkTick] = React.useState(0);
      const retryChunk = React.useCallback((name) => {
        void ensureChunk(name, true).then((parts) => { if (parts !== undefined) setChunkTick((value) => value + 1); });
      }, []);
      // 外壳先到、共享件与当前页签随后到；未访问页签不拉。右栏 / 嵌入面板共用同一加载器缓存。
      React.useEffect(() => {
        let alive = true;
        void ensureChunk('shared').then((parts) => { if (alive && parts !== undefined) setChunkTick((value) => value + 1); });
        return () => { alive = false; };
      }, []);
      // 页签集合 / 当前页签先算好：按需加载 effect 依赖它（旧版 'activity' 读成 'more'）
      const legacyTab = tab === 'activity' ? 'more' : tab;
      // 跨页跳转期间强制目标页签；目标页取到焦点后清空 workItem，回落到用户选中的页签
      const forcedTab = workItem === undefined ? undefined : workItemTabKey(workItem.kind);
      const activeTab = forcedTab !== undefined && tabs.some(([key]) => key === forcedTab)
        ? forcedTab
        : (tabs.some(([key]) => key === legacyTab) ? legacyTab : 'sessions');
      React.useEffect(() => {
        let alive = true;
        void ensureChunk(activeTab).then((parts) => { if (alive && parts !== undefined) setChunkTick((value) => value + 1); });
        return () => { alive = false; };
      }, [activeTab]);
      React.useEffect(() => {
        if (!settingsOpen) return undefined;
        let alive = true;
        void ensureChunk('settings').then((parts) => { if (alive && parts !== undefined) setChunkTick((value) => value + 1); });
        return () => { alive = false; };
      }, [settingsOpen]);
      React.useEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        const apply = () => setWide(el.clientWidth >= 620);
        apply();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(apply);
          observer.observe(el);
          return () => observer.disconnect();
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', apply);
          return () => window.removeEventListener('resize', apply);
        }
        return undefined;
      }, [board === undefined]);
      const scrollKeep = React.useRef(0);
      React.useEffect(() => { if (selected === undefined && rootRef.current) rootRef.current.scrollTop = scrollKeep.current; }, [selected]);
      const select = React.useCallback((id) => { scrollKeep.current = rootRef.current?.scrollTop ?? 0; setSelected(id); }, []);
      const copyTimer = React.useRef(undefined);
      React.useEffect(() => () => clearTimeout(copyTimer.current), []);
      // 回调保持同一引用，memo 的卡片才不会每轮都重画
      const onCopied = React.useCallback((id) => { setCopied(id); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(undefined), 1500); }, []);
      const prevEntries = React.useRef(new Map());
      const updatedTimer = React.useRef();
      React.useEffect(() => {
        if (!board) return;
        const next = new Map();
        const changed = [];
        for (const entry of board.entries ?? []) {
          const sig = JSON.stringify(entry);
          next.set(entry.sessionId, sig);
          const before = prevEntries.current.get(entry.sessionId);
          if (before !== undefined && before !== sig) changed.push(entry.sessionId);
        }
        prevEntries.current = next;
        if (changed.length === 0) return;
        setUpdatedIds(new Set(changed));
        clearTimeout(updatedTimer.current);
        updatedTimer.current = setTimeout(() => setUpdatedIds(undefined), 1600);
      }, [board]);
      React.useEffect(() => () => clearTimeout(updatedTimer.current), []);
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        let alive = true;
        const loadCounts = () => {
          kit.request('GET', undefined, { view: 'rail-counts', session: sessionId }).then(
            (payload) => {
              if (!alive) return;
              const counts = payload?.counts ?? {};
              setRailCounts(counts);
              writeCountsSnapshot(sessionId, counts);
            },
            () => {}
          );
        };
        loadCounts();
        const timer = setInterval(loadCounts, 60_000);
        return () => { alive = false; clearInterval(timer); };
      }, [sessionId]);
      // 写操作（回答提问、继续自动唤醒）：与协作页同一条路由，以用户身份执行；做完立即刷新
      const actRef = React.useRef(undefined);
      actRef.current = (body, okText) => {
        setBusy(true);
        return kit.request('POST', { ...body, fromSession: sessionId }).then(
          // 返回完整响应：任务的「拉起认领会话」要用 result.sessionId 直接打开新会话
          (payload) => { setNote({ pulse: Date.now() }); refresh(); return payload; },
          (failure) => { setNote({ text: kit.errorText(t, failure), tone: 'error' }); return undefined; }
        ).finally(() => setBusy(false));
      };
      // 同一个引用传给 memo 的卡片
      const act = React.useCallback((body, okText) => actRef.current(body, okText), []);
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      if (seenRef.current === undefined) seenRef.current = {};
      seenRef.current[activeTab] = true;
      const seen = seenRef.current;
      // 看板还没到时也先把页签框架画出来：结构、页签、刷新/设置位先就位，列表用骨架占位，不再整块空白
      if (board === undefined) {
        return h('div', {
          className: 'dshaSv ' + (wide ? 'dshaSv_wide' : 'dshaSv_narrow') + (extraList.length > 0 ? ' dshaSv_manyTabs' : ''),
          ref: rootRef
        },
        h('div', { className: 'dshaSv_head' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_ws' }, h(IconFolder), t('sideTitle')),
            h('span', { className: 'dshaSv_grow' }),
            h('button', { type: 'button', className: 'dshaSv_icon', disabled: true, title: t('tasksRefresh'), 'aria-label': t('tasksRefresh') }, h(IconRefresh)),
            h('button', { type: 'button', className: 'dshaSv_icon', disabled: true, title: t('sideSettings'), 'aria-label': t('sideSettings') }, h(IconGear))),
          h(TabBar, {
            kit, tab: activeTab, tabs, counts: {},
            onPrefetch: (key, cancel) => (cancel ? cancelPrefetch(key) : prefetchChunk(key)),
            onTab: (key) => { if (key === 'tasks' || key === 'map') refreshTasks(); setWorkItem(undefined); setTab(key); }
          })),
        error ? h('p', { className: 'dshaSv_alert dshaSv_note', 'data-tone': 'error', role: 'alert' }, error) : null,
        h('div', { className: 'dshaSv_panel', role: 'tabpanel', 'aria-labelledby': 'dshaSv-tab-' + activeTab },
          error
            ? h('button', { type: 'button', className: 'dshaSv_btn', onClick: refresh }, h(IconRefresh), t('tasksRefresh'))
            : h(React.Fragment, null,
              h('p', { className: 'dshaSv_muted', role: 'status' }, t('loading')),
              h(Skeleton))));
      }
      const entries = board.entries;
      const picked = selected === undefined ? undefined : entries.find((entry) => entry.sessionId === selected);
      // 会话详情仍整页打开（保持原来的返回 / 路径 / 焦点行为）：正文由会话 chunk 提供。
      if (picked !== undefined) {
        const sessionsParts = chunkPartsOf('sessions');
        if (sessionsParts !== undefined && typeof sessionsParts.SessionDetail === 'function') {
          return h(sessionsParts.SessionDetail, { kit, entry: picked, board, onBack: () => setSelected(undefined), copied, onCopied });
        }
      }
      const main = board.coordinator;
      const isMain = main !== undefined && main !== null && main.sessionId === sessionId;
      const tasks = board.taskBoard;
      const counts = { attention: entries.filter(isAttention).length, active: entries.filter(isActive).length, ready: entries.filter(isReady).length, done: entries.filter(isDone).length };
      const taskOpen = Array.isArray(tasks?.open) ? tasks.open.length : 0;
      const mapCount = Array.isArray(tasks?.map) ? tasks.map.length : 0;
      const prCount = Number(railCounts.prs) >= 0 && railCounts.prs !== null && railCounts.prs !== undefined ? Number(railCounts.prs) : collectPrs(tasks).length;
      const tabCounts = {
        sessions: counts.attention > 0 ? { value: counts.attention, tone: 'warn', label: kit.format(t('sideTabAttention'), { n: counts.attention }) } : null,
        ...(hasExtra('overview') && counts.attention > 0 ? { overview: { value: counts.attention, tone: 'warn', label: kit.format(t('sideTabAttention'), { n: counts.attention }) } } : {}),
        tasks: taskOpen > 0 ? { value: taskOpen, tone: undefined, label: kit.format(t('sideTaskSummary'), { open: taskOpen, active: Number(tasks?.claimed) || 0 }) } : null,
        handoff: board.handoff?.draft ? { value: '!', tone: 'warn', label: t('sideTabDraft') } : null,
        map: mapCount > 0 ? { value: mapCount, tone: undefined, label: kit.format(t('sideTabMapCount'), { n: mapCount }) } : null,
        prs: prCount > 0 ? { value: prCount, tone: undefined, label: kit.format(t('sideTabPrCount'), { n: prCount }) } : null,
        issues: Number(railCounts.issues) > 0 ? { value: Number(railCounts.issues), tone: undefined, label: kit.format(t('sideTabIssueCount'), { n: Number(railCounts.issues) }) } : null,
        mail: Number(railCounts.mail) > 0 ? { value: Number(railCounts.mail), tone: 'warn', label: kit.format(t('sideTabMailCount'), { n: Number(railCounts.mail) }) } : null,
        more: Number(board.sync?.queue) > 0 ? { value: Number(board.sync.queue), tone: undefined, label: kit.format(t('sideTabSync'), { n: Number(board.sync.queue) }) } : null
      };
      const age = Number.isFinite(at) ? Date.now() - at : 0;
      const fresh = age > STALE_ERROR_MS ? 'error' : age > STALE_WARN_MS ? 'warn' : undefined;
      // 页签正文按 chunk 渲染：加载中给同高骨架，失败给最小失败行；已访问页签保持挂载（hidden）
      const tabBody = (name, render) => {
        const result = chunkPanel(kit, name, retryChunk);
        return result.parts === undefined ? result.node : render(result.parts);
      };
      const panel = (key, body) => h('div', {
        key, id: 'dshaSv-panel-' + key, className: 'dshaSv_panel', role: 'tabpanel', 'aria-labelledby': 'dshaSv-tab-' + key,
        hidden: settingsOpen || activeTab !== key
      }, body);
      return h(PersistScope === null ? 'fragment' : PersistScope.Provider, PersistScope === null ? null : { value: persistPrefix }, h('div', { className: 'dshaSv ' + (wide ? 'dshaSv_wide' : 'dshaSv_narrow') + (extraList.length > 0 ? ' dshaSv_manyTabs' : ''), ref: rootRef },
        h('div', { className: 'dshaSv_head' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_ws', title: board.workspace?.path ?? '' }, h(IconFolder), board.workspace?.title ?? '—'),
            board.github?.state === 'ready' ? h(GitHubPill, { kit, github: board.github, onClick: () => setSettingsOpen(true) }) : null,
            fromStore ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand', role: 'status', title: t('reloading') }, t('reloading')) : null,
            hydrating ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand', role: 'status', title: t('sideHydratingHint') }, t('sideHydrating')) : null,
            h('span', { className: 'dshaSv_grow' }),
            error ? h('span', { className: 'dshaSv_ago', role: 'alert', title: error }, '⚠') : null,
            note?.pulse ? h('span', { className: 'dshaSv_actionPulse', key: note.pulse, 'aria-hidden': 'true' }) : null,
            at ? h('span', { className: 'dshaSv_freshDot', 'data-tone': fresh, role: 'status', title: agoText(t, kit.format, at, Date.now()), 'aria-label': agoText(t, kit.format, at, Date.now()) }) : null,
            h('button', { type: 'button', className: 'dshaSv_icon', 'data-busy': refreshing ? true : undefined, disabled: refreshing, title: t('tasksRefresh') + ' · ' + agoText(t, kit.format, at, Date.now()), 'aria-label': t('tasksRefresh'), onClick: refresh }, h(IconRefresh)),
            h('button', { type: 'button', className: 'dshaSv_icon', title: t('sideSettings'), 'aria-label': t('sideSettings'), 'aria-pressed': settingsOpen ? true : undefined, onClick: () => setSettingsOpen(!settingsOpen) }, h(IconGear))),
          settingsOpen ? null : h(TabBar, {
            kit, tab: activeTab, tabs, counts: tabCounts,
            onPrefetch: (key, cancel) => (cancel ? cancelPrefetch(key) : prefetchChunk(key)),
            onTab: (key) => { if (key === 'tasks' || key === 'map') refreshTasks(); setWorkItem(undefined); setTab(key); }
          })),
        note && note.text ? h('p', { className: 'dshaSv_alert dshaSv_note', 'data-tone': 'error', role: 'alert' }, note.text) : null,
        settingsOpen ? tabBody('settings', (parts) => h(parts.SettingsTab, { kit, board, act, busy, onBack: () => setSettingsOpen(false), sessionId })) : null,
        seen.sessions ? panel('sessions', tabBody('sessions', (parts) => h(parts.SessionsTab, {
          kit, board, entries, sessionId, busy, act, filter, setFilter, lineOpen, setLineOpen, copied, onCopied,
          quietOpen, setQuietOpen, doneOpen, setDoneOpen, updatedIds, onSelect: select
        }))) : null,
        seen.tasks ? panel('tasks', tabBody('tasks', (parts) => h(parts.TaskBoard, { kit, tasks, sync: board.sync, entries, act, busy, copied, onCopied, openMore: tasksOpen, onToggleOpenMore: () => setTasksOpen(!tasksOpen), hydrating, sessionId, onRefresh: refreshTasks }))) : null,
        seen.handoff ? panel('handoff', tabBody('handoff', (parts) => h(parts.HandoffTab, { kit, board, act, busy, sessionId }))) : null,
        seen.map ? panel('map', tabBody('map', (parts) => h(parts.MapTab, { kit, board, act, busy, onBack: wide ? undefined : () => setTab('more'), focus: workItem?.kind === 'map-ticket' ? workItem : undefined, onFocusConsumed: consumeWorkItem, onOpenWorkItem: openWorkItem }))) : null,
        seen.prs ? panel('prs', tabBody('prs', (parts) => h(parts.PrTab, { kit, board, act, busy, sessionId, onBack: () => setTab('more'), focus: workItem?.kind === 'pr' ? workItem : undefined, onFocusConsumed: consumeWorkItem, onOpenWorkItem: openWorkItem }))) : null,
        seen.branches ? panel('branches', tabBody('branches', (parts) => h(parts.BranchTab, { kit, act, busy, sessionId, onBack: () => setTab('more') }))) : null,
        seen.issues ? panel('issues', tabBody('issues', (parts) => h(parts.IssueTab, { kit, board, sessionId, onBack: () => setTab('more'), focus: workItem?.kind === 'issue' ? workItem : undefined, onFocusConsumed: consumeWorkItem, onOpenWorkItem: openWorkItem }))) : null,
        // 额外页签只在激活时渲染：切走即卸载旧 BoardPage，停止它自己的 10s 轮询
        activeTab === 'overview' && hasExtra('overview') ? panel('overview', renderExtra('overview')) : null,
        activeTab === 'search' && hasExtra('search') ? panel('search', renderExtra('search')) : null,
        seen.mail ? panel('mail', tabBody('mail', (parts) => h(parts.MailTab, { kit, sessionId, isMain }))) : null,
        seen.more ? panel('more', tabBody('more', (parts) => h(parts.MoreTab, {
          kit, board, act, busy,
          onOpen: (key) => setTab(key),
          onSettings: () => setSettingsOpen(true),
          counts: { map: mapCount, prs: prCount, issues: Number(railCounts.issues) || 0 }
        }))) : null));
    }

    // 与入口 makeSidebarTab 里的 SIDEBAR_KIT 对齐：kit 的字段一变就加 1，入口发现不配套时不渲染本文件。
    // 外壳只导出 RelaySidebar；共享件与页签正文在各自 chunk 里，测试可经 __registerChunks 合并。
    return {
      RelaySidebar,
      __registerChunks: registerChunks,
      __chunkParts: chunkPartsOf,
      __chunkFiles: CHUNK_FILES,
      __chunkEdges: chunkEdges,
      __loadChunk: loadChunk,
      __ensureChunk: ensureChunk,
      __chunkFailures: chunkFailures,
      KIT_VERSION: SIDEBAR_KIT
    };
  }
});

