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
    // GitHub 身份探测在飞时快一点取结果，让「正在读取账号…」不至于挂满一个 20 秒轮询
    const READING_POLL_MS = 4000;
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
    const STYLE_ID = 'dsh-session-relay/sidebar.css.v3';

    const css = [
      '.dshaSv{--accent:var(--dsw-alias-button-info-fill,var(--dsw-alias-link,#4176e6));--accent-hover:var(--dsw-alias-button-info-hover,var(--accent));box-sizing:border-box;height:100%;overflow:auto;display:grid;align-content:start;gap:10px;padding:10px 12px 20px;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.55;container-type:inline-size}',
      '.dshaSv p{margin:0}',
      '.dshaSv_bar{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_grow{flex:1;min-width:0}',
      '.dshaSv_ws{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 4px;border:0;border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_ago{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
      // 页签壳：顶栏 + 4 个主页签；设置从齿轮进，不占页签。高度与密度按侧栏容器（container query）适配
      '.dshaSv_head{position:sticky;top:0;z-index:3;display:grid;gap:6px;padding-bottom:2px;background:var(--dsw-alias-bg-base)}',
      '.dshaSv_tabs{display:flex;gap:4px;padding:2px 0 6px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-x:auto;scrollbar-width:none}',
      '.dshaSv_tab{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:3px 10px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:500;line-height:1.5;cursor:pointer;white-space:nowrap;flex:none}',
      '.dshaSv_tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}',
      '.dshaSv_tab[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshaSv_tab:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_navBtn{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dshaSv_listRow{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_box>summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:center;min-width:0}',
      '.dshaSv_box>summary::-webkit-details-marker{display:none}',
      '.dshaSv_box>summary::before{content:"▸";color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none}',
      '.dshaSv_box[open]>summary::before{content:"▾"}',
      '.dshaSv_box>summary .dshaSv_link{margin-left:auto}',
      '.dshaSv_listMain{display:grid;gap:2px;min-width:0;flex:1}',
      '.dshaSv_listActions{display:flex;flex-wrap:wrap;gap:6px;padding-top:4px}',
      '.dshaSv_chips{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_navBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.dshaSv_backBar{padding:0 0 2px}',
      '@container (max-width:619px){.dshaSv .dshaSv_foldTab{display:none}}',
      '@container (min-width:620px){.dshaSv .dshaSv_foldOnly{display:none}}',
      '.dshaSv_tabBadge{display:inline-flex;align-items:center;justify-content:center;min-width:14px;height:14px;padding:0 4px;border-radius:99px;background:rgba(139,139,149,.18);color:var(--dsw-alias-label-secondary);font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.dshaSv_tabBadge[data-tone=warn]{background:rgba(240,136,62,.2);color:#f0883e}',
      '.dshaSv_tabBadge[data-tone=error]{background:rgba(248,113,113,.2);color:#f87171}',
      '.dshaSv_panel{display:grid;gap:10px;align-content:start;min-width:0}',
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
      '.dshaSv_map{display:grid;gap:6px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_map .dshaSv_star{color:#bc8cff}',
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
      '.dshaSv_check{display:flex;align-items:flex-start;gap:6px;min-height:28px;padding:2px 0;font-size:11.5px;line-height:1.55;cursor:pointer}',
      '.dshaSv_check input{flex:none;margin:2px 0 0;accent-color:var(--accent)}',
      '.dshaSv_checkOff{opacity:.55;cursor:default}',
      '.dshaSv_pre{max-height:12em;overflow:auto;margin:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshaSv_hist{display:grid;gap:6px;padding:4px 0;font-size:11.5px}',
      '.dshaSv_box{display:grid;gap:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_field{display:grid;gap:3px}',
      '.dshaSv_fieldLabel{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary)}',
      '.dshaSv_draftCard{display:grid;gap:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_histItem{display:flex;align-items:center;gap:6px;min-width:0;padding:6px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_histItem .dshaSv_pill{max-width:9em}',
      '.dshaSv_arrow{flex:none;color:var(--dsw-alias-label-tertiary,#8b8b95);font-size:11px}',
      '.dshaSv_ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // PR / 同步只在宽侧栏出现；断点按侧栏容器宽度，不按屏幕宽度
      '.dshaSv_wideOnly{display:none}',
      '@container (min-width:460px){.dshaSv_wideOnly{display:block}}',
      // 宽侧栏 / 全屏：内容分两列，不把一行文字拉到满屏；卡片列表也两列
      '.dshaSv_grid{display:grid;gap:10px;grid-template-columns:minmax(0,1fr)}',
      // 任务页宽屏：左列表、右详情；窄栏选中时仍只显示详情
      '.dshaSv_split{display:grid;gap:10px;grid-template-columns:minmax(0,1fr);align-items:start}',
      '@container (min-width:720px){.dshaSv_split{grid-template-columns:minmax(240px,.9fr) minmax(0,1.4fr)}}',
      '@container (max-width:719px){.dshaSv_split[data-picked] .dshaSv_taskList{display:none}}',
      '.dshaSv_span{min-width:0}',
      '@container (min-width:720px){.dshaSv_grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dshaSv_grid>.dshaSv_span{grid-column:1/-1}.dshaSv_cardsWide{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@container (max-width:380px){.dshaSv_detailHead .dshaSv_row{flex-wrap:wrap}.dshaSv_sync .dshaSv_taskActs .dshaSv_btn{padding-left:7px;padding-right:7px}}',
      // 极窄（初次展开）收紧外框和按钮，给内容多留几像素；页签仍横向滚动。
      '@container (max-width:360px){.dshaSv{padding:8px 8px 18px;gap:8px}.dshaSv_tab{padding-left:6px;padding-right:6px}.dshaSv_card{padding:7px 8px}.dshaSv_panel,.dshaSv_grid{gap:8px}.dshaSv_btn{padding-left:8px;padding-right:8px}}',
      '.dshaSv_ghCard{gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_ghStatus{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
      '.dshaSv_pill{display:inline-flex;align-items:center;height:18px;max-width:100%;padding:0 7px;border:0;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_ghTier{display:grid;gap:4px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshaSv_scopes{display:flex;flex-wrap:wrap;gap:4px}',
      '.dshaSv_scope{display:inline-flex;align-items:center;height:18px;padding:0 7px;border:0;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1;white-space:nowrap}',
      '.dshaSv_filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
      '.dshaSv_ghCard .dshaSv_row{flex-wrap:wrap}',
      '.dshaSv_ghFlow{display:grid;gap:4px}',
      '.dshaSv_code{padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;font-weight:600;letter-spacing:.06em;white-space:nowrap}',
      '.dshaSv_btn{display:inline-flex;align-items:center;gap:4px;min-height:24px;padding:2px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1.5;cursor:pointer;white-space:nowrap}',
      '.dshaSv_btn:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
      '.dshaSv_btn[data-primary]{border-color:transparent;background:var(--accent);color:#fff;font-weight:600}',
      '.dshaSv_btn[data-primary]:hover{background:var(--accent-hover)}',
      '.dshaSv_icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshaSv_icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_btn:focus-visible,.dshaSv_icon:focus-visible,.dshaSv_card:focus-visible,.dshaSv_chipF:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
      '.dshaSv_chipF{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid transparent;border-radius:99px;background:rgba(139,139,149,.12);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}',
      '.dshaSv_chipF:hover{background:rgba(139,139,149,.2);color:var(--dsw-alias-label-primary)}',
      '.dshaSv_chipF[aria-pressed=true]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshaSv_sec{display:grid;gap:6px}',
      '.dshaSv_list{display:grid;gap:6px}',
      '.dshaSv_mail{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_mail>summary{display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;font-size:11.5px;line-height:1.5}',
      '.dshaSv_mail>p{margin:6px 0 0}',
      '.dshaSv_card{position:relative;display:grid;gap:5px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;overflow:hidden;transition:border-color .12s ease,background .12s ease}',
      '.dshaSv_card:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dshaSv_card[data-tone=muted]{opacity:.62}',
      '.dshaSv_row{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshaSv_title{flex:1;min-width:0;font-size:12.5px;font-weight:600;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}',
      '.dshaSv_lineCard{display:grid;gap:6px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshaSv_linePreview{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
      '.dshaSv_lineFull{margin:0;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dshaSv_sumBox{padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1))}',
      '.dshaSv_quote{padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}',
      '.dshaSv_sum{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dshaSv_metaChips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
      '.dshaSv_metaChip{display:inline-flex;align-items:center;max-width:12em;height:18px;padding:0 7px;border-radius:99px;background:rgba(139,139,149,.14);color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshaSv_metaChip[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshaSv_pill[data-mono]{font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-weight:700;font-size:10.5px;letter-spacing:.2px}',
      '.dshaSv_pill[data-tone=warn]{background:rgba(240,136,62,.16);color:#f0883e}',
      '.dshaSv_pill[data-tone=error]{background:rgba(248,113,113,.16);color:#f87171}',
      '.dshaSv_pill[data-tone=ok]{background:rgba(63,185,80,.16);color:#3fb950}',
      '.dshaSv_pill[data-tone=brand]{background:rgba(88,166,255,.16);color:#58a6ff}',
      '.dshaSv_pill[data-tone=map]{background:rgba(188,140,255,.16);color:#bc8cff}',
      '.dshaSv_pillBtn{font:inherit;background:none;cursor:pointer}',
      '.dshaSv_pillBtn:hover{filter:brightness(1.25)}',
      '.dshaSv_state{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,var(--dsw-alias-border-l2))}',
      '.dshaSv_state[data-state=running]{background:var(--dsw-alias-state-success-primary)}',
      '.dshaSv_state[data-state=idle]{background:var(--dsw-alias-state-idle-primary)}',
      '.dshaSv_star{color:var(--dsw-alias-state-warn-primary);flex:none;display:inline-flex}',
      '.dshaSv_link{justify-self:start;padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:12px;cursor:pointer}',
      '.dshaSv_task{display:flex;align-items:center;gap:6px;min-width:0;padding:2px 0}',
      '.dshaSv_task .dshaSv_grow{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_taskBtn{width:100%;border:1px solid transparent;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:7px;padding:6px 8px}',
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
      '.dshaSv_muted{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.55}',
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
      '.dshaSv_note{animation:dshaSv_fadeIn .16s ease}',
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
      '.dshaSv_foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0}',
      '.dshaSv_meta{flex:1 1 90px;min-width:0;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-alias-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshaSv_acts{display:inline-flex;gap:6px;margin-left:auto}',
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

    // 首屏/轮询只拉轻量快照；完整快照后台补一次（重字段：任务看板、声明、仓库、同步、GitHub）。
    const FULL_TTL_MS = 5 * 60_000;
    function useBoard(kit, sessionId, visible) {
      const [state, setState] = React.useState(() => lastBoards.get(sessionId) ?? { board: undefined, error: undefined, at: undefined, hydrating: false });
      const [tick, setTick] = React.useState(0);
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
          timer = setTimeout(load, reading ? READING_POLL_MS : POLL_STEPS[Math.min(quiet, POLL_STEPS.length - 1)]);
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
          lastBoards.delete(sessionId);
          lastBoards.set(sessionId, { board, at, version, fullAt });
          if (lastBoards.size > 8) lastBoards.delete(lastBoards.keys().next().value);
          setState((prev) => ({ board, error: undefined, at, hydrating: false, version, refreshing: prev.refreshing }));
        };
        function hydrate() {
          if (hydrating || !alive) return;
          hydrating = true;
          setState((prev) => ({ ...prev, hydrating: true }));
          fullController?.abort?.();
          fullController = typeof AbortController === 'function' ? new AbortController() : undefined;
          kit.request('GET', undefined, { view: 'board', session: sessionId }, fullController?.signal).then(
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
          kit.request('GET', undefined, { view: 'board', session: sessionId, light: 1, since: cached?.version }, controller?.signal).then(
            (payload) => {
              if (!alive) return;
              if (payload.notModified === true) {
                quiet += 1;
                const hit = lastBoards.get(sessionId);
                if (hit) {
                  const next = { ...hit, at: Date.now() };
                  lastBoards.set(sessionId, next);
                  setState((prev) => ({ board: next.board, error: undefined, at: next.at, version: next.version, hydrating: false, refreshing: prev.refreshing }));
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
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ ...prev, error: kit.errorText(kit.t, error) })); }
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
        load();
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
        kit.request('GET', undefined, { view: 'board', session: sessionId, light: 1, tasks: 1 }).then(
          (payload) => {
            if (!payload || payload.notModified === true || payload.taskBoard === undefined) return;
            setState((prev) => {
              if (!prev.board) return prev;
              const at = Date.now();
              const board = { ...prev.board, taskBoard: payload.taskBoard };
              const hit = lastBoards.get(sessionId);
              if (hit) lastBoards.set(sessionId, { ...hit, board, at });
              return { ...prev, board, at };
            });
          },
          () => {});
      };
      return [state, () => {
        setState((prev) => ({ ...prev, refreshing: true }));
        const cached = lastBoards.get(sessionId);
        if (cached) lastBoards.set(sessionId, { ...cached, fullAt: 0 });
        setTick((value) => value + 1);
      }, refreshTasks];
    }

    /* 卡片：整张可点（键盘 Enter / 空格），里面的按钮不冒泡 */
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

    /** 会话页版本线：结构化胶囊 + 两行预览，长文按需展开。 */
    function LineNotice({ kit, text, open, onToggle }) {
      const { t } = kit;
      const clean = String(text ?? '').trim();
      const pick = (re) => re.exec(clean)?.[1];
      const main = pick(/origin\/main=([0-9a-f]{7,40})/i) ?? pick(/\bmain=([0-9a-f]{7,40})/i);
      const head = pick(/\bHEAD\s+([0-9a-f]{7,40})/i);
      const checkpoints = pick(/(\d+)\s*个检查点/);
      const tests = pick(/(?:串行)?测试\s*(\d+)/);
      const unreleased = /未推送|未打 tag|未发 Release|未发布/.test(clean);
      const chips = [
        main ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.format(t('lineMainChip'), { sha: main })) : null,
        head ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.format(t('lineHeadChip'), { sha: head })) : null,
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
        open && long ? h('p', { className: 'dshaSv_lineFull' }, clean) : h('p', { className: 'dshaSv_linePreview' }, preview));
    }

    const EntryCard = memo(function EntryCard({ kit, entry, onSelect, copied, onCopied, act, updated = false }) {
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
        entry.summary ? h('div', { className: 'dshaSv_sumBox' }, h('p', { className: 'dshaSv_sum', title: entry.summary }, entry.summary)) : null,
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
      return h('button', { type: 'button', className: 'dshaSv_pill dshaSv_pillBtn', 'data-tone': tone, title: title + ' · ' + kit.t('sideSettings'), 'aria-label': title, 'aria-expanded': expanded === true, role: bad ? 'alert' : undefined, onClick }, bad ? '⚠ ' + text : text);
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

    const QUIET = new Set(['blank', 'idle']);

    /* ---------------------------------------------------------------- 页签壳 */

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
    function TabBar({ kit, tab, onTab, counts }) {
      const { t } = kit;
      return h('div', { className: 'dshaSv_tabs', role: 'tablist', 'aria-label': t('sideTitle') },
        ...TABS.map(([key, label, Icon, group]) => {
          const badge = counts?.[key];
          return h('button', {
            key, type: 'button', role: 'tab', id: 'dshaSv-tab-' + key,
            className: group === 'fold' ? 'dshaSv_tab dshaSv_foldTab' : 'dshaSv_tab',
            'aria-selected': tab === key ? 'true' : 'false',
            title: t(label), onClick: () => onTab(key)
          }, h(Icon), t(label), badge ? h('span', { className: 'dshaSv_tabBadge', 'data-tone': badge.tone, 'aria-label': badge.label }, String(badge.value)) : null);
        }));
    }

    /** 同步队列一行：默认收起，点开看票链接；任务页、动态页、设置页共用。 */
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
    function MailBox({ kit, sessionId }) {
      const { t } = kit;
      const [data, setData] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [busy, setBusy] = React.useState(false);
      const load = React.useCallback(() => {
        kit.request('GET', undefined, { view: 'mail', ...(sessionId ? { session: sessionId } : {}), limit: 20 }).then(
          (payload) => { setData(payload); setError(undefined); },
          (failure) => setError(kit.errorText(t, failure)));
      }, [kit, sessionId, t]);
      React.useEffect(() => { load(); }, [load]);
      const mark = (ids, state = 'read') => {
        if (typeof sessionId !== 'string' || sessionId === '' || ids.length === 0) return;
        setBusy(true);
        kit.request('POST', {
          action: state === 'archived' ? 'mail-mark' : 'mail-read',
          fromSession: sessionId, ids,
          ...(state === 'archived' ? { state } : {})
        }).then(() => load(), (failure) => setError(kit.errorText(t, failure))).finally(() => setBusy(false));
      };
      const items = Array.isArray(data?.items) ? data.items : [];
      const unread = data?.mailbox?.unread ?? 0;
      const unreadIds = sessionId ? items.filter((item) => item.readBy?.[sessionId] === undefined).map((item) => item.id) : [];
      return h('section', { className: 'dshaSv_sec dshaSv_span' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('pageMail')),
          h('span', { className: 'dshaSv_muted' }, kit.format(t('mailUnreadCount'), { n: unread })),
          unreadIds.length > 0 ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => mark(unreadIds) }, t('mailMarkAll')) : null),
        h('p', { className: 'dshaSv_muted' }, t('mailHint')),
        error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
        data === undefined && error === undefined ? h('p', { className: 'dshaSv_muted', role: 'status' }, t('loading')) : null,
        items.length === 0 && data !== undefined ? h('div', { className: 'dshaSv_quote' }, t('mailEmpty')) : null,
        items.length > 0 ? h('div', { className: 'dshaSv_list' }, ...items.slice(0, 8).map((item) => {
          const read = sessionId ? item.readBy?.[sessionId] !== undefined : true;
          return h('details', { key: item.id, className: 'dshaSv_mail' },
            h('summary', { className: 'dshaSv_row' },
              h('span', { className: 'dshaSv_pill', 'data-tone': read ? undefined : 'warn' }, read ? t('mailRead') : t('mailUnread')),
              h('span', { className: 'dshaSv_grow' }, item.subject),
              h('span', { className: 'dshaSv_muted' }, kit.formatTime(item.at))),
            h('p', { className: 'dshaSv_muted' }, item.body || t('mailNoBody')),
            h('div', { className: 'dshaSv_taskActs' },
              !read ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => mark([item.id]) }, t('mailMarkRead')) : null,
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => mark([item.id], 'archived') }, t('mailArchive'))));
        })) : null);
    }

    /** 仓库守候设置（2.2.0）：总览 / 判定 / 触发 / 设置 四个子页签。 */
    const RW_DEFER = { busy: 'rwDeferBusy', rate: 'rwDeferRate', activeHours: 'rwDeferHours', session: 'rwDeferSession' };
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
        batch.length > 0 ? h('p', { className: 'dshaSv_muted', title: numbers.map((number) => '#' + number).join(' ') }, t('rwLastBatch') + batch.slice(0, 3).map((item) => '#' + item.number + ' ' + item.title).join('；')) : null,
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
          : h('div', { className: 'dshaSv_list' }, ...history.map((row, index) => h('p', { key: index, className: 'dshaSv_muted' },
            [reason(row), Array.isArray(row.numbers) && row.numbers.length > 0 ? row.numbers.map((number) => '#' + number).join(' ') : '', row.error ?? '', row.at ? kit.formatTime(row.at) : ''].filter(Boolean).join(' · ')))),
        filtered.length > 0 ? h('p', { className: 'dshaSv_muted' }, t('rwFiltered') + filtered.map((item) => '#' + item.number + ' ' + item.reason).join('；')) : null);
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

    /** 地图页：任务地图票子 + 本地票子（原「动态」的地图与票子区）。 */
    function MapTab({ kit, board, act, busy }) {
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
      const statePill = (item) => {
        if (item.approvalLabel) return h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, item.approvalLabel);
        if (item.stageLabel) return h('span', { className: 'dshaSv_pill', 'data-tone': item.stage === 'review' ? 'warn' : undefined }, item.stageLabel);
        if (item.kind === 'ended') return h('span', { className: 'dshaSv_pill' }, t('sideTaskEnded'));
        if (item.kind === 'active') return h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('sideTaskActive'));
        if (item.kind === 'open') return h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('sideTaskOpen'));
        return null;
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
          ? h('a', { className: 'dshaSv_ticketNo', href: ticket.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen') }, '#' + ticket.number)
          : h('span', { className: 'dshaSv_ticketNo' }, '#' + ticket.number);
      };
      const ticketState = (item) => {
        const ticket = ticketOf(item);
        const state = typeof ticket?.remoteState === 'string' ? ticket.remoteState.toLowerCase() : '';
        if (state === '') return null;
        return h('span', { className: 'dshaSv_pill', 'data-tone': state === 'open' ? 'ok' : state === 'closed' ? undefined : 'warn' }, state.toUpperCase());
      };
      const ticketCard = (group) => h('div', { key: group.id, className: 'dshaSv_ticket' },
        h('div', { className: 'dshaSv_ticketHead' },
          ticketNo(group),
          h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': group.kind === 'ended' ? undefined : 'brand' }, group.id),
          h('span', { className: 'dshaSv_grow', title: group.title }, group.title),
          ticketState(group),
          statePill(group),
          group.kind === 'ended' ? null : h('button', { type: 'button', className: 'dshaSv_link', disabled: busy, onClick: () => openSplit(group.id) }, t('sideMapSplit'))),
        ...(Array.isArray(group.children) ? group.children.map((child) => h('div', { key: child.id, className: 'dshaSv_ticketChild' },
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
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_map' },
            h('div', { className: 'dshaSv_bar' },
              h('span', { className: 'dshaSv_star' }, h(IconMap)),
              h('span', { className: 'dshaSv_h dshaSv_grow' }, t('sideMapTitle')),
              map.length > 0 ? h('span', { className: 'dshaSv_pill' }, kit.format(t('sideMapGroups'), { n: map.length, children: childTotal })) : null,
              h('button', {
                type: 'button', className: 'dshaSv_btn', disabled: busy || taskBoard === null,
                'aria-expanded': splitOpen ? 'true' : undefined,
                onClick: () => { if (splitOpen) setSplitOpen(false); else openSplit(); }
              }, t('sideMapSplit'))),
            h('p', { className: 'dshaSv_muted' }, t('sideMapHint')),
            splitForm,
            mapBody)),
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('p', { className: 'dshaSv_h' }, t('sideTicketTitle')),
          ticketList.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('sideTicketEmpty'))
            : h('div', { className: 'dshaSv_tickets' }, ...ticketList.map((link) => h('div', { key: link.id, className: 'dshaSv_ticket' },
              h('div', { className: 'dshaSv_ticketHead' },
                link.issue
                  ? (link.url ? h('a', { className: 'dshaSv_ticketNo', href: link.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen') }, '#' + link.issue) : h('span', { className: 'dshaSv_ticketNo' }, '#' + link.issue))
                  : h('span', { className: 'dshaSv_ticketNo', 'data-missing': true }, t('sideMapNoTicket')),
                h('span', { className: 'dshaSv_pill', 'data-mono': true }, link.id),
                h('span', { className: 'dshaSv_grow', title: titleOf.get(String(link.id).toUpperCase()) ?? String(link.id) }, titleOf.get(String(link.id).toUpperCase()) ?? String(link.id)),
                link.remoteState ? h('span', { className: 'dshaSv_pill', 'data-tone': String(link.remoteState).toLowerCase() === 'open' ? 'ok' : undefined }, String(link.remoteState).toUpperCase()) : null,
                h('span', { className: 'dshaSv_pill' }, t(syncState[link.state] ?? 'syncStateUnknown'))))))));
    }

    /** 侧栏远端列表：拉一次 + 手动刷新；错误用文字，不静默。 */
    function useRemoteList(kit, query) {
      // query 是首屏参数；reload(true, override) 可换筛选条件（如 PR 的已关闭列表）
      const [data, setData] = React.useState(undefined);
      const [error, setError] = React.useState(undefined);
      const [busy, setBusy] = React.useState(false);
      const load = React.useCallback((force, override) => {
        setBusy(true);
        const next = override ?? query;
        kit.request('GET', undefined, force === true ? { ...next, force: 1 } : next).then(
          (payload) => { setData(payload); setError(undefined); },
          (failure) => { setError(kit.errorText(kit.t, failure)); }
        ).finally(() => setBusy(false));
      }, []);
      React.useEffect(() => { load(false); }, []);
      return { data, error, busy, reload: load };
    }

    const PR_DECISION_LABEL = { APPROVED: 'prReviewApproved', CHANGES_REQUESTED: 'prReviewChanges', REVIEW_REQUIRED: 'prReviewRequired' };

    /** PR 详情：评论与评审正文，点行内「详情」就地展开。 */
    function PrDetail({ kit, sessionId, number }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'pr-detail', session: sessionId, number });
      const detail = data?.prDetail?.detail;
      const REVIEW_LABEL = { approved: 'prReviewApproved', 'changes-requested': 'prReviewChanges', commented: 'prReviewCommented', dismissed: 'prReviewDismissed', pending: 'prReviewPending' };
      const reviewPill = (state) => {
        const label = REVIEW_LABEL[state];
        if (label === undefined) return null;
        const tone = state === 'approved' ? 'ok' : state === 'changes-requested' ? 'error' : 'warn';
        return h('span', { className: 'dshaSv_pill', 'data-tone': tone }, t(label));
      };
      if (error) return h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error);
      if (detail === undefined) {
        return loading
          ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1].map((index) => h('div', { key: index, className: 'dshaSv_skel' })))
          : h('div', { className: 'dshaSv_quote' }, t('prDetailEmpty'));
      }
      const row = (key, head, time, body) => h('div', { key, className: 'dshaSv_listRow' },
        h('div', { className: 'dshaSv_listMain' },
          h('div', { className: 'dshaSv_bar' }, head, h('span', { className: 'dshaSv_grow' }), time ? h('span', { className: 'dshaSv_muted' }, kit.formatTime(Date.parse(time))) : null),
          body ? h('p', { className: 'dshaSv_pre' }, body) : null));
      return h('div', { className: 'dshaSv_box' },
        detail.body ? h('p', { className: 'dshaSv_pre' }, detail.body) : null,
        h('p', { className: 'dshaSv_h' }, t('prReviewsTitle') + ' · ' + detail.reviews.length),
        detail.reviews.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('prNoReviews'))
          : detail.reviews.map((review, index) => row('r' + index, h('span', { className: 'dshaSv_grow' }, '@' + review.login, reviewPill(review.state)), review.submittedAt, review.body)),
        h('p', { className: 'dshaSv_h' }, t('prCommentsTitle') + ' · ' + detail.comments.length),
        detail.comments.length === 0 ? h('p', { className: 'dshaSv_muted' }, t('prNoComments'))
          : detail.comments.map((comment, index) => row('c' + index, h('span', { className: 'dshaSv_grow' }, '@' + comment.login), comment.createdAt, comment.body)),
        h('button', { type: 'button', className: 'dshaSv_link', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh')));
    }


    /** PR 页：远端 PR 列表、审批 / 评论 / 关闭（只由用户点击）。 */
    function PrTab({ kit, board, act, busy, sessionId }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'pr-list', session: sessionId });
      const [filter, setFilter] = React.useState('all');
      const [openNo, setOpenNo] = React.useState(undefined);
      const [comment, setComment] = React.useState('');
      const [pending, setPending] = React.useState(undefined);
      const [running, setRunning] = React.useState(undefined);
      const [prState, setPrState] = React.useState('open');
      const [detailNo, setDetailNo] = React.useState(undefined);
      const view = data?.prs;
      const prs = Array.isArray(view?.items) ? view.items : [];
      const linked = new Map(collectPrs(board.taskBoard).map((row) => [Number(row.number), row]));
      const baseQuery = { view: 'pr-list', session: sessionId, ...(prState === 'closed' ? { state: 'closed' } : {}) };
      const switchState = (next) => {
        if (next === prState) return;
        setPrState(next); setOpenNo(undefined); setDetailNo(undefined); setPending(undefined); setComment('');
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
          if (payload !== undefined) { setPending(undefined); setComment(''); setOpenNo(undefined); reload(true, baseQuery); }
        }, () => setRunning(undefined));
      };
      const decisionPill = (item) => {
        if (item.merged === true) return h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('prMerged'));
        if (item.draft) return h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, t('prDraft'));
        const label = PR_DECISION_LABEL[item.reviewDecision];
        if (label === undefined) return null;
        const tone = item.reviewDecision === 'APPROVED' ? 'ok' : item.reviewDecision === 'CHANGES_REQUESTED' ? 'error' : 'warn';
        return h('span', { className: 'dshaSv_pill', 'data-tone': tone }, t(label));
      };
      const confirmRow = (item) => {
        if (pending === undefined || pending.number !== item.number) return null;
        const text = pending.kind === 'close' ? kit.format(t('prConfirmClose'), { n: item.number })
          : pending.kind === 'reopen' ? kit.format(t('prConfirmReopen'), { n: item.number })
            : kit.format(t('prConfirmApprove'), { n: item.number });
        const key = pending.kind;
        const body = pending.kind === 'close' ? { action: 'pr-state', number: item.number, state: 'close' }
          : pending.kind === 'reopen' ? { action: 'pr-state', number: item.number, state: 'reopen' }
            : { action: 'pr-review', number: item.number, verdict: 'approve' };
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
        if (prState === 'closed') {
          return h('div', { className: 'dshaSv_listActions' }, area,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':comment', { action: 'pr-comment', number: item.number, body: comment }) }, t('prComment')),
            item.merged === true ? null : h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'reopen' }) }, t('prReopen')));
        }
        return h('div', { className: 'dshaSv_listActions' }, area,
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'approve' }) }, t('prApprove')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':changes', { action: 'pr-review', number: item.number, verdict: 'request-changes', body: comment }) }, t('prRequestChanges')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working || comment.trim() === '', onClick: () => run(key + ':comment', { action: 'pr-comment', number: item.number, body: comment }) }, t('prComment')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || working, onClick: () => setPending({ number: item.number, kind: 'close' }) }, t('prClose')));
      };
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabPr')),
            loading && view !== undefined ? h('span', { className: 'dshaSv_actionPulse', 'aria-hidden': 'true' }) : null,
            view?.repo ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: view.repo }, view.repo) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh'))),
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          view?.error ? h('p', { className: 'dshaSv_muted' }, view.error) : null,
          view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
          view === undefined && !loading && error === undefined ? h('div', { className: 'dshaSv_quote' }, t('prUnavailable')) : null,
          view !== undefined ? h('div', { className: 'dshaSv_chips' },
            h('button', { type: 'button', className: 'dshaSv_chipF', 'aria-pressed': prState === 'open' ? 'true' : undefined, onClick: () => switchState('open') }, t('prStateOpen')),
            h('button', { type: 'button', className: 'dshaSv_chipF', 'aria-pressed': prState === 'closed' ? 'true' : undefined, onClick: () => switchState('closed') }, t('prStateClosed'))) : null,
          view !== undefined && prState === 'open' ? h('div', { className: 'dshaSv_chips' },
            ...['all', 'review', 'changes', 'approved', 'draft'].map((key) => h('button', {
              key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key ? 'true' : undefined, onClick: () => setFilter(key)
            }, t('prFilter' + key[0].toUpperCase() + key.slice(1)), h('span', { className: 'dshaSv_muted' }, String(filterCount(key)))))) : null,
          matched.length > 0 ? h('div', { className: 'dshaSv_list' }, ...matched.map((item) => h('div', { key: item.number, className: 'dshaSv_listRow' },
            h('div', { className: 'dshaSv_listMain' },
              h('div', { className: 'dshaSv_bar' },
                h('a', { className: 'dshaSv_ticketNo', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen') }, '#' + item.number),
                h('span', { className: 'dshaSv_grow', title: item.title }, item.title),
                decisionPill(item),
                linked.has(item.number) ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, linked.get(item.number).id) : null,
                h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': detailNo === item.number ? 'true' : undefined, onClick: () => setDetailNo(detailNo === item.number ? undefined : item.number) }, detailNo === item.number ? t('cancel') : t('prOpenDetail'))),
              h('p', { className: 'dshaSv_muted' }, ['@' + item.author, item.head && item.base ? item.head + ' → ' + item.base : '', item.updatedAt ? kit.formatTime(Date.parse(item.updatedAt)) : '', item.comments > 0 ? kit.format(t('prCommentCount'), { n: item.comments }) : ''].filter(Boolean).join(' · ')),
              confirmRow(item),
              detailNo === item.number ? h(PrDetail, { key: 'detail', kit, sessionId, number: item.number }) : null,
              openNo === item.number || pending?.number === item.number ? actions(item) : null),
            h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': openNo === item.number ? 'true' : undefined, onClick: () => { setOpenNo(openNo === item.number ? undefined : item.number); setPending(undefined); } }, openNo === item.number ? t('cancel') : t('prHandle'))))) : null,
          view !== undefined && matched.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('prEmpty')) : null));
    }

    /** 问题页：远端 issue 列表（只读，与地图分开）。 */
    function IssueTab({ kit, sessionId }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'issue-list', session: sessionId });
      const view = data?.issues;
      const items = Array.isArray(view?.items) ? view.items : [];
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabIssues')),
            loading && view !== undefined ? h('span', { className: 'dshaSv_actionPulse', 'aria-hidden': 'true' }) : null,
            view?.repo ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: view.repo }, view.repo) : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: loading, onClick: () => reload(true) }, t('tasksRefresh'))),
          error ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, error) : null,
          view?.error ? h('p', { className: 'dshaSv_muted' }, view.error) : null,
          view === undefined && loading ? h('div', { className: 'dshaSv_list', 'aria-hidden': true }, ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshaSv_skel' }))) : null,
          items.length > 0 ? h('div', { className: 'dshaSv_list' }, ...items.map((item) => h('div', { key: item.number, className: 'dshaSv_listRow' },
            h('div', { className: 'dshaSv_listMain' },
              h('div', { className: 'dshaSv_bar' },
                h('a', { className: 'dshaSv_ticketNo', href: item.url, target: '_blank', rel: 'noopener noreferrer', title: t('sidePrOpen') }, '#' + item.number),
                h('span', { className: 'dshaSv_grow', title: item.title }, item.title)),
              h('p', { className: 'dshaSv_muted' }, ['@' + item.author, item.assignees.length > 0 ? t('issueAssigned') + item.assignees.map((name) => '@' + name).join(' ') : '', item.updatedAt ? kit.formatTime(Date.parse(item.updatedAt)) : '', item.comments > 0 ? kit.format(t('prCommentCount'), { n: item.comments }) : ''].filter(Boolean).join(' · ')),
              item.labels.length > 0 ? h('div', { className: 'dshaSv_row' }, ...item.labels.map((label) => h('span', { key: label, className: 'dshaSv_pill' }, label))) : null)))) : null,
          view !== undefined && items.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('issueEmpty')) : null));
    }

    /** 分支页：全工作区本地 / 远端分支；删除逐条确认（远端要输入分支名）。 */
    function BranchTab({ kit, act, busy, sessionId }) {
      const { t } = kit;
      const { data, error, busy: loading, reload } = useRemoteList(kit, { view: 'branch-list' });
      const [confirm, setConfirm] = React.useState(undefined);
      const [typed, setTyped] = React.useState('');
      const [force, setForce] = React.useState(false);
      const [running, setRunning] = React.useState(undefined);
      const [query, setQuery] = React.useState('');
      const [showAll, setShowAll] = React.useState(false);
      const view = data?.branches;
      const workspaces = Array.isArray(view?.workspaces) ? view.workspaces : [];
      const skipped = Number(view?.skipped) || 0;
      const q = query.trim().toLowerCase();
      const matched = (branch) => q === '' || String(branch.name).toLowerCase().includes(q);
      const run = (key, body) => {
        setRunning(key);
        act(body).then((payload) => {
          setRunning(undefined);
          if (payload !== undefined) { setConfirm(undefined); setTyped(''); setForce(false); reload(true); }
        }, () => setRunning(undefined));
      };
      const remove = (workspaceId, name, remote) => {
        const key = (remote ? 'r:' : 'l:') + workspaceId + ':' + name;
        run(key, { action: 'branch-delete', workspaceId, name, ...(remote ? { remote: true, confirm: typed } : { force }) });
      };
      const branchRow = (workspaceId, branch, remote, snapshot) => {
        const name = branch.name;
        const isDefault = snapshot.defaultBranch === name;
        const isCurrent = remote !== true && snapshot.current === name;
        const key = (remote ? 'r:' : 'l:') + workspaceId + ':' + name;
        const isConfirm = confirm !== undefined && confirm.workspaceId === workspaceId && confirm.name === name && confirm.remote === remote;
        return h('div', { key: (remote ? 'r:' : 'l:') + name, className: 'dshaSv_listRow' },
          h('div', { className: 'dshaSv_listMain' },
            h('div', { className: 'dshaSv_bar' },
              h('span', { className: 'dshaSv_grow', title: branch.subject ?? '' }, name),
              isCurrent ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand' }, t('brCurrent')) : null,
              isDefault ? h('span', { className: 'dshaSv_pill' }, t('brDefault')) : null,
              remote !== true ? (branch.merged ? h('span', { className: 'dshaSv_pill', 'data-tone': 'ok' }, t('brMerged')) : h('span', { className: 'dshaSv_pill', 'data-tone': 'warn' }, t('brUnmerged'))) : null),
            h('p', { className: 'dshaSv_muted' }, [
              branch.at ? kit.formatTime(Date.parse(branch.at)) : '',
              branch.ahead > 0 ? kit.format(t('brAhead'), { n: branch.ahead }) : '',
              branch.behind > 0 ? kit.format(t('brBehind'), { n: branch.behind }) : '',
              remote !== true && branch.upstream ? '↗ ' + branch.upstream : ''
            ].filter(Boolean).join(' · ')),
            isConfirm ? h('div', { className: 'dshaSv_listActions' },
              remote === true
                ? h('input', { className: 'dshaSv_input', value: typed, maxLength: 200, placeholder: name, 'aria-label': t('brConfirmRemote'), onChange: (event) => setTyped(event.target.value) })
                : (branch.merged !== true ? h('label', { className: 'dshaSv_check' }, h('input', { type: 'checkbox', checked: force, onChange: (event) => setForce(event.target.checked) }), h('span', null, t('brForce'))) : null),
              h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || running !== undefined || (remote === true && typed !== name), onClick: () => remove(workspaceId, name, remote) }, t('brConfirm')),
              h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy || running !== undefined, onClick: () => { setConfirm(undefined); setTyped(''); setForce(false); } }, t('cancel'))) : null),
          isDefault || isCurrent ? null : h('button', {
            type: 'button', className: 'dshaSv_link', disabled: busy || running !== undefined,
            onClick: () => { setConfirm({ workspaceId, name, remote }); setTyped(''); setForce(false); }
          }, remote === true ? t('brDeleteRemote') : t('brDelete')));
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
      return h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span' },
          h('div', { className: 'dshaSv_bar' },
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTabBranches')),
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
    function MailTab({ kit, sessionId }) {
      return h(MailBox, { kit, sessionId });
    }

    /** 更多页：同步、仓库状态；窄屏时折叠页签入口列表。 */
    function MoreTab({ kit, board, act, busy, onOpen, onSettings, counts }) {
      const { t } = kit;
      const gh = board.github;
      const repo = board.repo;
      const sync = board.sync;
      const folded = h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_foldOnly' },
        h('p', { className: 'dshaSv_h' }, t('sideMoreFolded')),
        h('div', { className: 'dshaSv_list' }, ...FOLD_PAGES.map(([key, label, Icon]) => {
          const n = Number(counts?.[key]) || 0;
          return h('button', { key, type: 'button', className: 'dshaSv_navBtn', onClick: () => onOpen(key) },
            h('span', { className: 'dshaSv_star' }, h(Icon)),
            h('span', { className: 'dshaSv_grow' }, t(label)),
            n > 0 ? h('span', { className: 'dshaSv_pill' }, String(n)) : null,
            h('span', { className: 'dshaSv_muted', 'aria-hidden': 'true' }, '›'));
        })));
      const ghHint = gh !== null && gh !== undefined && gh.state !== 'ready'
        ? h('section', { className: 'dshaSv_sec dshaSv_span' },
            h('p', { className: 'dshaSv_h' }, t('ghTitle')),
            h('p', { className: 'dshaSv_muted' }, t('sideMoreGhHint')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: onSettings }, t('sideGoSettings')))
        : null;
      const repoBox = repo
        ? h('section', { className: 'dshaSv_sec dshaSv_span' },
            h('p', { className: 'dshaSv_h' }, t('repoTitle')),
            h('div', { className: 'dshaSv_box' },
              h('div', { className: 'dshaSv_row' },
                h('span', { className: 'dshaSv_pill', 'data-tone': repo.available === true && repo.source === 'ok' ? 'ok' : undefined, title: repo.repo }, repo.available === true
                  ? (repo.source === 'ok' ? t('repoProbeOk') : t('repoProbeFail') + (repo.error ?? ''))
                  : t('repoNoRepo') + (repo.reason ?? '')),
                h('span', { className: 'dshaSv_grow' })),
              h('button', { type: 'button', className: 'dshaSv_link', disabled: busy, onClick: onSettings }, t('sideRepoInSettings'))))
        : null;
      const syncBox = sync && sync.available === true
        ? h('div', { className: 'dshaSv_box dshaSv_span' }, h(SyncStatus, { kit, sync, act, busy }))
        : null;
      return h('div', { className: 'dshaSv_grid' },
        folded,
        ghHint,
        repoBox,
        syncBox);
    }

    /** 设置 → 仓库：只读探测 + 开关；开关只由用户点，模型没有写入口。 */
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
      const recent = watches.filter((item) => item.state === 'active' || item.state === 'failed' || item.state === 'timeout').slice(0, 5);
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
          : h('div', { className: 'dshaSv_list' }, ...recent.map((item) => h('div', { key: item.id, className: 'dshaSv_row' },
              h('span', { className: 'dshaSv_state', 'data-state': item.state === 'active' ? 'running' : 'idle', title: item.state }),
              h('span', { className: 'dshaSv_muted dshaSv_grow', title: item.line }, item.line)))));
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
          h(LineBox, { kit, board, act, busy }),
          h(TemplateBox, { kit, act, busy }),
          h(RoleModelsBox, { kit, board, act, busy, sessionId }),
          h(DelegationBox, { kit, board, act, busy }),
          h(PinBox, { kit, board, act, busy }),
          h(DevBox, { kit, board, act, busy }),
          h(RestartBox, { kit, board, act, busy })));
    }

    /** 交接页：草稿（自己写 / 让主会话起草 / 插件整理）、接手方与二次确认、快照与历史。 */
    function HandoffTab({ kit, board, act, busy, sessionId }) {
      const { t } = kit;
      const data = board.handoff;
      const draft = data?.draft ?? null;
      const [notes, setNotes] = React.useState(draft?.notes ?? '');
      const [dirty, setDirty] = React.useState(false);
      const [target, setTarget] = React.useState('new');
      const [alias, setAlias] = React.useState('');
      const [queue, setQueue] = React.useState(false);
      const [ask, setAsk] = React.useState(false);
      const [snapOpen, setSnapOpen] = React.useState(true);
      const [histOpen, setHistOpen] = React.useState(false);
      const models = useModelsView(kit, sessionId, target === 'new');
      const [model, setModel] = React.useState('follow');
      const [copied, setCopied] = React.useState(undefined);
      const [writing, setWriting] = React.useState(false);
      const stamp = draft?.updatedAt;
      // 草稿被别处改了（主会话起草 / 插件整理）就同步输入框；用户手改过的不覆盖
      React.useEffect(() => { setNotes(draft?.notes ?? ''); setDirty(false); setAsk(false); }, [stamp]);
      if (data === null || data === undefined) return h('section', { className: 'dshaSv_sec dshaSv_box' },
        h('p', { className: 'dshaSv_h' }, t('hoTitle')),
        h('p', { className: 'dshaSv_muted', role: 'status' }, t('loadingDetails')),
        h('p', { className: 'dshaSv_muted' }, t('hoLoadingHint')),
        h('div', { className: 'dshaSv_skel' }));
      const candidates = [...(board.entries ?? []), ...(board.others ?? [])].filter((entry) => entry.sessionId !== data.coordinator && entry.state !== 'gone');
      const coordinatorLabel = board.coordinator?.label ?? (data.coordinator ? kit.shortId(data.coordinator) : null);
      const draftBy = draft === null ? '' : draft.by === 'model' ? t('hoByModel') : draft.by === 'plugin' ? t('hoByPlugin') : t('hoByUser');
      const targetLabel = target === 'new'
        ? (alias.trim() === '' ? t('hoTargetNew') : '@' + alias.trim())
        : (candidates.find((entry) => entry.sessionId === target)?.label ?? kit.shortId(target));
      const history = Array.isArray(data.history) ? data.history : [];
      const editing = draft !== null || writing;
      const canConfirm = draft !== null || notes.trim() !== '';
      const save = () => act({ action: 'handoff-save', notes }, t('saved'));
      const confirm = () => act({
        action: 'handoff-confirm',
        to: target === 'new' ? 'new' : target,
        ...(target === 'new' && alias.trim() !== '' ? { alias: alias.trim() } : {}),
        ...(target === 'new' ? modelField(model) : {}),
        ...(dirty || draft === null ? { notes } : {}),
        mode: queue ? 'queue' : 'followup'
      }, kit.format(t('hoDone'), { label: targetLabel }));
      const draftArea = editing
        ? h(React.Fragment, null,
            h('textarea', {
              className: 'dshaSv_input', rows: 5, maxLength: 2000, value: notes, placeholder: t('hoNotes'), 'aria-label': t('hoNotes'),
              onChange: (event) => { setNotes(event.target.value); setDirty(true); }
            }),
            h('div', { className: 'dshaSv_taskActs' },
              h('span', { className: 'dshaSv_muted' }, kit.format(t('chars'), { n: notes.length, max: 2000 })),
              h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || notes.trim() === '' || (draft !== null && !dirty), onClick: save }, t('hoSave')),
              draft !== null ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => { setWriting(false); act({ action: 'handoff-discard' }, t('removed')); } }, t('hoDiscard')) : null,
              h('span', { className: 'dshaSv_grow' }),
              writing && draft === null ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => { setWriting(false); setNotes(''); setDirty(false); } }, t('cancel')) : null))
        : h('div', { className: 'dshaSv_taskActs' },
            data.coordinator
              ? h('button', {
                  type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy,
                  onClick: () => act({ action: data.coordinatorFailure ? 'handoff-auto' : 'handoff-ask' }, data.coordinatorFailure ? t('hoAutoDone') : t('hoAsked'))
                }, data.coordinatorFailure ? t('hoAuto') : t('hoAsk'))
              : null,
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setWriting(true) }, t('hoWrite')));
      return h(React.Fragment, null,
        h('div', { className: 'dshaSv_grid' },
        h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_star' }, h(IconStar)),
            h('p', { className: 'dshaSv_h dshaSv_grow' }, t('hoTitle')),
            data.coordinator ? h('span', { className: 'dshaSv_pill', 'data-mono': true }, kit.shortId(data.coordinator)) : null),
          h('p', { className: 'dshaSv_muted' }, t('hoHint')),
          data.coordinator
            ? h('div', { className: 'dshaSv_row' },
                h('span', { className: 'dshaSv_grow dshaSv_ellipsis', title: coordinatorLabel }, coordinatorLabel),
                h('button', { type: 'button', className: 'dshaSv_link', disabled: busy, onClick: () => kit.openSession(data.coordinator) }, t('openSession')),
                h(CopyId, { kit, sessionId: data.coordinator, copied, onCopied: (value) => { setCopied(value); setTimeout(() => setCopied(undefined), 1500); } }))
            : h('p', { className: 'dshaSv_muted' }, t('hoNoMain')),
          data.coordinatorFailure ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, kit.format(t('hoFailed'), { text: data.coordinatorFailure.text })) : null,
          h('div', { className: 'dshaSv_draftCard' },
            h('div', { className: 'dshaSv_row' },
              h('span', { className: 'dshaSv_pill', 'data-tone': draft === null ? undefined : 'brand' }, draft === null ? t('hoNoDraft') : draftBy),
              draft === null ? null : h('span', { className: 'dshaSv_muted' }, kit.formatTime(draft.updatedAt)),
              h('span', { className: 'dshaSv_grow' })),
            draftArea)),
        h('section', { className: 'dshaSv_sec dshaSv_box' },
          h('p', { className: 'dshaSv_h' }, t('hoSettings')),
          h('div', { className: 'dshaSv_field' },
            h('span', { className: 'dshaSv_fieldLabel' }, t('hoTarget')),
            h(PopoverPicker, {
              value: target, disabled: busy, ariaLabel: t('hoTarget'),
              rows: [
                { key: 'new', label: t('hoTargetNew') },
                ...candidates.slice(0, 30).map((entry) => ({ key: entry.sessionId, label: entry.label ?? kit.shortId(entry.sessionId) }))
              ],
              onSelect: (next) => { setTarget(next); setAsk(false); }
            })),
          target === 'new' ? h(React.Fragment, null,
            h('input', {
              className: 'dshaSv_input', value: alias, maxLength: 32, placeholder: t('hoAlias'), 'aria-label': t('hoAlias'),
              onChange: (event) => { setAlias(event.target.value); setAsk(false); }
            }),
            h('div', { className: 'dshaSv_field' },
              h('span', { className: 'dshaSv_fieldLabel' }, t('modelLabel')),
              h(ModelSelect, {
                kit, data: models, value: model, followLabel: board.roleModels?.main, disabled: busy,
                onChange: (next) => { setModel(next); setAsk(false); }
              }),
              h(ModelEffort, {
                kit, data: models, value: model, disabled: busy,
                onChange: (next) => { setModel(next); setAsk(false); }
              }))) : null,
          h('label', { className: 'dshaSv_check' }, h('input', { type: 'checkbox', checked: queue, onChange: (event) => setQueue(event.target.checked) }), h('span', null, t('hoQueue'))),
          h('div', { className: 'dshaSv_taskActs' },
            ask
              ? h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !canConfirm, onClick: confirm }, kit.format(t('hoConfirmAgain'), { target: targetLabel }))
              : h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy || !canConfirm, onClick: () => setAsk(true) }, t('hoConfirm')),
            ask ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setAsk(false) }, t('cancel')) : null)),
        h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_h dshaSv_grow' }, t('hoSnapshot')),
            h('span', { className: 'dshaSv_pill' }, t('hoSnapshotAttach')),
            h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': snapOpen, onClick: () => setSnapOpen(!snapOpen) }, snapOpen ? t('hoHideSnapshot') : t('hoShowSnapshot'))),
          snapOpen ? h('pre', { className: 'dshaSv_pre' }, data.snapshot ?? '') : null),
        history.length > 0 ? h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_box' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_h dshaSv_grow' }, t('hoHistory')),
            h('span', { className: 'dshaSv_pill' }, String(history.length)),
            history.length > 1
              ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': histOpen, onClick: () => setHistOpen(!histOpen) }, histOpen ? t('hoHistoryLess') : kit.format(t('hoHistoryMore'), { n: history.length }))
              : null),
          h('div', { className: 'dshaSv_hist' }, ...(histOpen ? history : history.slice(0, 1)).map((item, index) => h('div', { key: item.id ?? index, className: 'dshaSv_histItem' },
            h('span', { className: 'dshaSv_pill' }, kit.formatTime(item.at)),
            h('span', { className: 'dshaSv_pill', 'data-mono': true }, item.fromLabel ?? (item.from ? kit.shortId(item.from) : '—')),
            h('span', { className: 'dshaSv_arrow', 'aria-hidden': 'true' }, '→'),
            h('span', { className: 'dshaSv_pill' }, item.toLabel ?? kit.shortId(item.to)),
            h('span', { className: 'dshaSv_grow' }),
            item.from && item.from !== data.coordinator
              ? h('button', { type: 'button', className: 'dshaSv_link', disabled: busy, onClick: () => act({ action: 'set-main', target: item.from }, t('saved')) }, t('hoRevert'))
              : null)))) : null)
      );
    }


    /** 只读的 GitHub Projects Status；开关打开时按需读，用户点按钮才写回。 */
    function ProjectStatusLine({ kit, task, sessionId, enabled }) {
      const { t } = kit;
      const [state, setState] = React.useState(enabled ? 'loading' : 'off');
      const [info, setInfo] = React.useState(undefined);
      const [writeAsk, setWriteAsk] = React.useState(false);
      const [writing, setWriting] = React.useState(false);
      const [note, setNote] = React.useState(undefined);
      React.useEffect(() => {
        if (!enabled || typeof sessionId !== 'string' || sessionId === '') { setState('off'); return undefined; }
        let alive = true;
        kit.request('GET', undefined, { view: 'project-status', session: sessionId, task: task.id }).then(
          (payload) => { if (alive) { setInfo(payload.projectStatus); setState('done'); } },
          () => { if (alive) setState('error'); }
        );
        return () => { alive = false; };
      }, [enabled, sessionId, task.id]);
      if (!enabled) return null;
      const result = info;
      const write = () => {
        if (!writeAsk) { setWriteAsk(true); return; }
        setWriteAsk(false);
        setWriting(true);
        setNote(undefined);
        kit.request('POST', { action: 'project-status-write', task: task.id, fromSession: sessionId }, undefined).then(
          (payload) => {
            setWriting(false);
            const done = payload.result ?? {};
            setInfo((prev) => ({ ...(prev ?? {}), state: 'ok', status: done.status ?? prev?.status, project: done.project ?? prev?.project }));
            setNote({ pulse: Date.now() });
          },
          (failure) => { setWriting(false); setNote({ text: kit.errorText(t, failure), tone: 'error' }); }
        );
      };
      const text = state === 'loading' || state === 'off' ? t('projectStatusLoading')
        : state === 'error' ? t('projectStatusError')
        : result === undefined ? t('projectStatusLoading')
        : result.state === 'ok' ? kit.format(t('projectStatusValue'), { project: result.project ?? t('projectStatusNoProject'), status: result.status })
        : result.state === 'none' ? t('projectStatusNone')
        : result.state === 'off' ? t('projectStatusOff')
        : t('projectStatusUnknown') + (result.reason ? ' · ' + result.reason : '');
      return h('section', { className: 'dshaSv_sec' },
        h('div', { className: 'dshaSv_row' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('projectStatusTitle')),
          result?.state === 'ok' ? h('button', {
            type: 'button', className: 'dshaSv_btn', disabled: writing || typeof sessionId !== 'string' || sessionId === '',
            onClick: write
          }, writing ? t('projectStatusWriting') : writeAsk ? t('projectStatusWriteAsk') : t('projectStatusWrite')) : null),
        h('p', { className: 'dshaSv_muted', title: result?.reason ?? '' }, text),
        note?.pulse ? h('span', { className: 'dshaSv_actionPulse', key: note.pulse, 'aria-hidden': 'true' }) : null,
        note?.text ? h('p', { className: 'dshaSv_alert', 'data-tone': 'error', role: 'alert' }, note.text) : null);
    }

    /** 任务详情里的审核入口：通过 / 打回 + 可选说明；只有用户能点，模型没有工具入口。 */
    function ApprovalBox({ kit, task, act, busy }) {
      const { t } = kit;
      const [note, setNote] = React.useState('');
      const run = (approved) => {
        if (typeof act !== 'function') return;
        void act({ action: 'task-approval', id: task.id, approved, ...(note.trim() === '' ? {} : { note: note.trim() }) },
          approved ? t('taskApprovedDone') : t('taskRejectedDone'));
      };
      return h('section', { className: 'dshaSv_sec' },
        h('p', { className: 'dshaSv_h' }, t('sideTaskApproval')),
        h('div', { className: 'dshaSv_taskActs' },
          h('input', {
            className: 'dshaSv_input', style: { flex: '1 1 8em' }, value: note, maxLength: 200,
            placeholder: t('taskApprovalNote'), 'aria-label': t('taskApprovalNote'),
            onChange: (event) => setNote(event.target.value)
          }),
          h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: () => run(true) }, t('taskApprove')),
          h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => run(false) }, t('taskReject'))),
        h('p', { className: 'dshaSv_muted' }, t('taskApprovalHint')));
    }

    /**
     * 任务看板（参考 Deck 的「列表 + 详情 + 动作」）：
     * - 列表按「可接 / 进行中 / 已结束」分组；可接默认露 3 条、进行中露 5 条，点「还有 N 条」展开；
     * - 点一行进详情：持有者、工作树、看板状态，动作有打开持有会话、复制任务号 / 认领指令 / 派发指令、拉起认领会话；
     * - 数据随看板快照一起来（taskBoard），不额外请求；只在标签可见时由上层轮询；
     * - 认领会新建会话，所以详情里二次确认（Deck 的按钮能把 prompt 注入输入框，relay 没有输入框入口，就复制命令）。
     */
    function TaskBoard({ kit, tasks, sync, entries, act, busy, copied, onCopied = () => {}, openMore = false, onToggleOpenMore, hydrating = false, sessionId, onRefresh = () => {} }) {
      const { t } = kit;
      const [selected, setSelected] = React.useState(undefined);
      const [fold, setFold] = React.useState({});
      const foldState = fold ?? {};
      const [claiming, setClaiming] = React.useState(undefined);
      const [alias, setAlias] = React.useState('');
      const [updatedIds, setUpdatedIds] = React.useState(undefined);
      const prevTasks = React.useRef(new Map());
      const updatedTimer = React.useRef();
      React.useEffect(() => {
        if (tasks === undefined || tasks === null) return;
        const rows = [...(tasks.open ?? []), ...(tasks.claimedRows ?? []), ...(tasks.endedRows ?? [])];
        const next = new Map();
        const changed = [];
        for (const item of rows) {
          const sig = JSON.stringify(item);
          next.set(item.id, sig);
          const before = prevTasks.current.get(item.id);
          if (before !== undefined && before !== sig) changed.push(item.id);
        }
        prevTasks.current = next;
        if (changed.length === 0) return;
        setUpdatedIds(new Set(changed));
        clearTimeout(updatedTimer.current);
        updatedTimer.current = setTimeout(() => setUpdatedIds(undefined), 1600);
      }, [tasks]);
      React.useEffect(() => () => clearTimeout(updatedTimer.current), []);
      if (tasks === undefined || tasks === null) return h('section', { className: 'dshaSv_sec' }, h('p', { className: 'dshaSv_muted', role: 'status' }, hydrating ? t('loadingDetails') : t('sideNoTasks')));
      const open = Array.isArray(tasks.open) ? tasks.open : [];
      const active = Array.isArray(tasks.claimedRows) ? tasks.claimedRows : [];
      const ended = Array.isArray(tasks.endedRows) ? tasks.endedRows : [];
      const claimedN = Number(tasks.claimed) || 0;
      const endedN = Number.isFinite(tasks.ended) ? tasks.ended : ended.length;
      const stateOf = (id) => open.some((row) => row.id === id) ? 'open' : active.some((row) => row.id === id) ? 'active' : ended.some((row) => row.id === id) ? 'ended' : undefined;
      const picked = selected === undefined ? undefined : open.find((row) => row.id === selected) ?? active.find((row) => row.id === selected) ?? ended.find((row) => row.id === selected);
      let detail;
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
        detail = h('section', { className: 'dshaSv_sec dshaSv_taskDetail' },
          h('div', { className: 'dshaSv_bar' },
            h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => { setSelected(undefined); setClaiming(undefined); } }, h(IconBack), t('sideTaskBack')),
            h('span', { className: 'dshaSv_crumb dshaSv_grow' }, t('tasksTitle'))),
          h('div', { className: 'dshaSv_row' },
            h('button', { type: 'button', className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand', title: t('copyId'), 'aria-label': t('copyId') + ' ' + picked.id, style: { cursor: 'pointer' }, onClick: () => copy(picked.id) }, picked.id),
            picked.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(picked.priority) ? 'warn' : undefined }, picked.priority) : null,
            h('span', { className: 'dshaSv_pill', 'data-tone': state === 'open' ? 'ok' : state === 'active' ? 'brand' : undefined }, t(state === 'open' ? 'sideTaskOpen' : state === 'active' ? 'sideTaskActive' : 'sideTaskEnded')),
            h('span', { className: 'dshaSv_grow' }),
            status === 'ok' ? h('span', { className: 'dshaSv_done', 'aria-label': t('sideTaskCopied') }, '✓') : status === 'fail' ? h('span', { className: 'dshaSv_alert', 'data-tone': 'error' }, t('copyFailed')) : null),
          h('p', { className: 'dshaSv_big' }, picked.title ?? picked.id),
          picked.owner ? h('button', { type: 'button', className: 'dshaSv_link', onClick: () => kit.openSession(picked.owner) }, t('tasksHolder') + '：' + (picked.ownerLabel ?? kit.shortId(picked.owner))) : null,
          holder && holder.summary ? h('p', { className: 'dshaSv_muted', title: holder.summary }, t('sideTaskLatest') + '：' + holder.summary) : null,
          picked.pr && picked.pr.label ? h('p', { className: 'dshaSv_muted', title: picked.pr.url ?? undefined }, picked.pr.label) : null,
          facts.length > 0 ? h('dl', { className: 'dshaSv_kv' }, ...facts.flatMap(([key, value]) => [h('dt', { key: key + 'k' }, key), h('dd', { key: key + 'v' }, String(value))])) : null,
          picked.stage === 'review' || picked.approval === 'pending'
            ? h(ApprovalBox, { kit, task: picked, act, busy })
            : null,
          h(ProjectStatusLine, { kit, task: picked, sessionId, enabled: sync?.switches?.projectStatus === true }),
          h('div', { className: 'dshaSv_taskActs' },
            state === 'active' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => copy('/relay task dispatch ' + picked.id) }, h(IconCopy), t('sideTaskCopyDispatch')) : null,
            state === 'open' ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, 'aria-expanded': claiming === picked.id, onClick: () => { setClaiming(claiming === picked.id ? undefined : picked.id); if (alias === '') setAlias(picked.id.toLowerCase()); } }, t('tasksClaim')) : null),
          claiming === picked.id ? h('div', { className: 'dshaSv_row' },
            h('input', { className: 'dshaSv_input', style: { maxWidth: '9em' }, value: alias, maxLength: 32, 'aria-label': t('tasksAlias'), placeholder: picked.id.toLowerCase(), onChange: (event) => setAlias(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') claim(); } }),
            h('button', { type: 'button', className: 'dshaSv_btn', 'data-primary': true, disabled: busy, onClick: claim }, t('tasksClaimConfirm')),
            h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => setClaiming(undefined) }, t('cancel'))) : null);
      }
      const row = (task, state) => h('button', {
        key: state + ':' + task.id, type: 'button', className: 'dshaSv_task dshaSv_taskBtn', title: task.title, 'data-updated': updatedIds instanceof Set && updatedIds.has(task.id) ? 'true' : undefined,
        onClick: () => { setSelected(task.id); setClaiming(undefined); onRefresh(); }
      },
        h('span', { className: 'dshaSv_pill', 'data-mono': true, 'data-tone': state === 'ended' ? undefined : 'brand' }, task.id),
        task.priority ? h('span', { className: 'dshaSv_pill', 'data-tone': /^P[01]$/i.test(task.priority) ? 'warn' : undefined }, task.priority) : null,
        h('span', { className: 'dshaSv_grow' }, task.title),
        state === 'active' && task.owner ? h('span', { className: 'dshaSv_pill', 'data-mono': true, title: task.ownerLabel ?? task.owner }, task.ownerLabel ?? kit.shortId(task.owner)) : null,
        state === 'ended' ? h('span', { className: 'dshaSv_pill' }, t(task.claim === 'done' ? 'sideTaskDone' : 'sideTaskAbandoned')) : null,
        h('span', { className: 'dshaSv_chev', 'aria-hidden': true }, '›'));
      const more = (state, total, shown) => {
        if (total <= shown) return null;
        const expanded = state === 'open' ? openMore === true : foldState[state] === true;
        const toggle = state === 'open' && typeof onToggleOpenMore === 'function' ? onToggleOpenMore : () => setFold({ ...foldState, [state]: foldState[state] !== true });
        return h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': expanded, onClick: toggle }, expanded ? t('sideLess') : kit.format(t('sideMoreTasks'), { n: total - shown }));
      };
      // 分组默认：可接 / 进行中展开，已结束收起；点分组头切换（本机状态，跨重开保持到刷新）
      const groupOpen = (state) => foldState['g:' + state] === undefined ? state !== 'ended' : foldState['g:' + state] === true;
      const group = (state, labelKey, rows, shown, tone, count = rows.length, moreLink) => rows.length === 0 ? null : h('div', { className: 'dshaSv_list', 'data-group': state },
        h('button', { type: 'button', className: 'dshaSv_groupBtn', 'aria-expanded': groupOpen(state) ? 'true' : 'false', onClick: () => setFold({ ...foldState, ['g:' + state]: !groupOpen(state) }) },
          h('span', { className: 'dshaSv_chev dshaSv_chevRot', 'data-open': groupOpen(state) ? true : undefined, 'aria-hidden': true }, '▸'),
          h('span', { className: 'dshaSv_dot', 'data-tone': tone, 'aria-hidden': true }),
          h('span', { className: 'dshaSv_grow' }, t(labelKey)),
          h('span', { className: 'dshaSv_count' }, String(count))),
        groupOpen(state) ? h('div', { className: 'dshaSv_list' }, ...shown.map((task) => row(task, state)), moreLink ?? more(state, rows.length, shown.length)) : null);
      const openShown = openMore === true ? open : open.slice(0, 3);
      const activeShown = foldState.active === true ? active : active.slice(0, 5);
      const list = h('section', { className: 'dshaSv_sec dshaSv_taskList' },
        h('div', { className: 'dshaSv_bar' },
          h('p', { className: 'dshaSv_h dshaSv_grow' }, t('sideTaskBoard')),
          h('span', { className: 'dshaSv_pill' }, kit.format(t('sideTaskSummary'), { open: open.length, active: claimedN }))),
        sync && sync.available === true ? h(SyncStatus, { key: 'sync', kit, sync, act, busy }) : null,
        open.length === 0 ? h('div', { className: 'dshaSv_quote' }, t('sideNoOpenTasks')) : null,
        group('open', 'sideTaskOpen', open, openShown, 'ok'),
        group('active', 'sideTaskActive', active, activeShown, 'brand'),
        claimedN > active.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: claimedN - active.length })) : null,
        ended.length > 0
          ? group('ended', 'sideTaskEnded', ended, ended, undefined, endedN,
            endedN > ended.length ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN - ended.length })) : null)
          : endedN > 0 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: endedN })) : null);
      return detail === undefined
        ? list
        : h('div', { className: 'dshaSv_split', 'data-picked': true }, list, detail);
    }

    function RelaySidebar({ kit, sessionId, useTabInfo }) {
      const { t } = kit;
      useStyle();
      const visible = useVisible(useTabInfo);
      const [{ board, error, at, refreshing, flash, hydrating }, refresh, refreshTasks] = useBoard(kit, sessionId, visible);
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
      // 主页签存本机（旧版 'activity' 读成 'more'）；设置从顶栏齿轮打开，不占页签
      const [tab, setTab] = usePersisted('tab', 'sessions');
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [updatedIds, setUpdatedIds] = React.useState(undefined);
      // 页签计数（PR / 问题 / 邮箱未读）：单独轻量拉取，不跟看板轮询绑在一起
      const [railCounts, setRailCounts] = React.useState({});
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
            (payload) => { if (alive) setRailCounts(payload?.counts ?? {}); },
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
      const legacyTab = tab === 'activity' ? 'more' : tab;
      const activeTab = TABS.some(([key]) => key === legacyTab) ? legacyTab : 'sessions';
      const foldedActive = FOLD_PAGES.some(([key]) => key === activeTab);
      if (seenRef.current === undefined) seenRef.current = {};
      seenRef.current[activeTab] = true;
      const seen = seenRef.current;
      const taskOpen = Array.isArray(tasks?.open) ? tasks.open.length : 0;
      const mapCount = Array.isArray(tasks?.map) ? tasks.map.length : 0;
      const prCount = Number(railCounts.prs) >= 0 && railCounts.prs !== null && railCounts.prs !== undefined ? Number(railCounts.prs) : collectPrs(tasks).length;
      const tabCounts = {
        sessions: counts.attention > 0 ? { value: counts.attention, tone: 'warn', label: kit.format(t('sideTabAttention'), { n: counts.attention }) } : null,
        tasks: taskOpen > 0 ? { value: taskOpen, tone: undefined, label: kit.format(t('sideTaskSummary'), { open: taskOpen, active: Number(tasks?.claimed) || 0 }) } : null,
        handoff: board.handoff?.draft ? { value: '!', tone: 'warn', label: t('sideTabDraft') } : null,
        map: mapCount > 0 ? { value: mapCount, tone: undefined, label: kit.format(t('sideTabMapCount'), { n: mapCount }) } : null,
        prs: prCount > 0 ? { value: prCount, tone: undefined, label: kit.format(t('sideTabPrCount'), { n: prCount }) } : null,
        issues: Number(railCounts.issues) > 0 ? { value: Number(railCounts.issues), tone: undefined, label: kit.format(t('sideTabIssueCount'), { n: Number(railCounts.issues) }) } : null,
        mail: Number(railCounts.mail) > 0 ? { value: Number(railCounts.mail), tone: 'warn', label: kit.format(t('sideTabMailCount'), { n: Number(railCounts.mail) }) } : null,
        more: Number(board.sync?.queue) > 0 ? { value: Number(board.sync.queue), tone: undefined, label: kit.format(t('sideTabSync'), { n: Number(board.sync.queue) }) } : null
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
      const age = Number.isFinite(at) ? Date.now() - at : 0;
      const fresh = age > STALE_ERROR_MS ? 'error' : age > STALE_WARN_MS ? 'warn' : undefined;
      const quietText = ['blank', 'idle'].map((key) => [key, quiet.filter((entry) => categoryOf(entry) === key).length]).filter(([, n]) => n > 0).map(([key, n]) => t(CATEGORY_LABEL[key]) + ' ' + n).join(' · ');
      // 版本线正文本身常以「Version line：」开头，标签已经写了「版本线公告」，显示时去掉前缀避免重复
      const line = String(board.line?.text ?? '').replace(/^Version line\s*[:：]\s*/i, '');
      const longLine = line.length > 40 || line.includes('\n');
      const watching = (board.watches ?? []).filter((item) => item.state === 'active');
      const FILTER_ICON = { attention: IconTarget, active: IconPlay, ready: IconCheck, done: IconArchive };
      const chip = (key, label, n, tone) => {
        const FilterIcon = FILTER_ICON[key];
        return h('button', { key, type: 'button', className: 'dshaSv_chipF', 'aria-pressed': filter === key, 'data-tone': n > 0 ? tone : undefined, onClick: () => setFilter(filter === key ? 'all' : key) },
          FilterIcon ? h(FilterIcon) : null, h('b', null, n), t(label));
      };
      const sessionsBody = seen.sessions ? h(React.Fragment, null,
        h(SessionSearch, { kit, board, sessionId, openSession: kit.openSession }),
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
            : shown.length > 0 ? h('div', { className: 'dshaSv_list dshaSv_cardsWide' }, ...shown.map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied, act, updated: updatedIds instanceof Set && updatedIds.has(entry.sessionId) }))) : null,
          quiet.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': quietOpen, onClick: () => setQuietOpen(!quietOpen) }, (quietOpen ? t('sideLess') : quietText)) : null,
          done.length > 0 ? h('button', { type: 'button', className: 'dshaSv_link', 'aria-expanded': doneOpen, onClick: () => setDoneOpen(!doneOpen) }, doneOpen ? t('sideLess') : kit.format(t('sideDoneN'), { n: done.length })) : null,
          doneOpen && done.length > 0 ? h('div', { className: 'dshaSv_list dshaSv_cardsWide' }, ...done.slice(0, 50).map((entry) => h(EntryCard, { key: entry.sessionId, kit, entry, onSelect: select, copied: copiedFor(copied, entry.sessionId), onCopied, act, updated: updatedIds instanceof Set && updatedIds.has(entry.sessionId) }))) : null,
                      doneOpen && done.length > 50 ? h('p', { className: 'dshaSv_muted' }, kit.format(t('sideDoneMore'), { n: done.length - 50 })) : null)) : null;

      const panel = (key, body) => h('div', {
        key, id: 'dshaSv-panel-' + key, className: 'dshaSv_panel', role: 'tabpanel', 'aria-labelledby': 'dshaSv-tab-' + key,
        hidden: settingsOpen || activeTab !== key
      }, body);
      return h('div', { className: 'dshaSv', ref: rootRef },
        h('div', { className: 'dshaSv_head' },
          h('div', { className: 'dshaSv_bar' },
            h('span', { className: 'dshaSv_ws', title: board.workspace?.path ?? '' }, h(IconFolder), board.workspace?.title ?? '—'),
            board.github?.state === 'ready' ? h(GitHubPill, { kit, github: board.github, onClick: () => setSettingsOpen(true) }) : null,
            hydrating ? h('span', { className: 'dshaSv_pill', 'data-tone': 'brand', role: 'status', title: t('sideHydratingHint') }, t('sideHydrating')) : null,
            h('span', { className: 'dshaSv_grow' }),
            error ? h('span', { className: 'dshaSv_ago', role: 'alert', title: error }, '⚠') : null,
            note?.pulse ? h('span', { className: 'dshaSv_actionPulse', key: note.pulse, 'aria-hidden': 'true' }) : null,
            at ? h('span', { className: 'dshaSv_freshDot', 'data-tone': fresh, role: 'status', title: agoText(t, kit.format, at, Date.now()), 'aria-label': agoText(t, kit.format, at, Date.now()) }) : null,
            h('button', { type: 'button', className: 'dshaSv_icon', 'data-busy': refreshing ? true : undefined, disabled: refreshing, title: t('tasksRefresh') + ' · ' + agoText(t, kit.format, at, Date.now()), 'aria-label': t('tasksRefresh'), onClick: refresh }, h(IconRefresh)),
            h('button', { type: 'button', className: 'dshaSv_icon', title: t('sideSettings'), 'aria-label': t('sideSettings'), 'aria-pressed': settingsOpen ? true : undefined, onClick: () => setSettingsOpen(!settingsOpen) }, h(IconGear))),
          settingsOpen ? null : h(TabBar, { kit, tab: activeTab, onTab: (key) => { if (key === 'tasks') refreshTasks(); setTab(key); }, counts: tabCounts })),
        note && note.text ? h('p', { className: 'dshaSv_alert dshaSv_note', 'data-tone': 'error', role: 'alert' }, note.text) : null,
        settingsOpen ? h(SettingsTab, { kit, board, act, busy, onBack: () => setSettingsOpen(false), sessionId }) : null,
        seen.sessions ? panel('sessions', sessionsBody) : null,
        seen.tasks ? panel('tasks', h(TaskBoard, { kit, tasks, sync: board.sync, entries, act, busy, copied, onCopied, openMore: tasksOpen, onToggleOpenMore: () => setTasksOpen(!tasksOpen), hydrating, sessionId, onRefresh: refreshTasks })) : null,
        seen.handoff ? panel('handoff', h(HandoffTab, { kit, board, act, busy, sessionId })) : null,
        !settingsOpen && foldedActive ? h('div', { className: 'dshaSv_bar dshaSv_backBar dshaSv_foldOnly' },
          h('button', { type: 'button', className: 'dshaSv_btn', onClick: () => setTab('more') }, h(IconBack), t('sideBackMore'))) : null,
        seen.map ? panel('map', h(MapTab, { kit, board, act, busy })) : null,
        seen.prs ? panel('prs', h(PrTab, { kit, board, act, busy, sessionId })) : null,
        seen.branches ? panel('branches', h(BranchTab, { kit, act, busy, sessionId })) : null,
        seen.issues ? panel('issues', h(IssueTab, { kit, sessionId })) : null,
        seen.mail ? panel('mail', h(MailTab, { kit, sessionId })) : null,
        seen.more ? panel('more', h(MoreTab, {
          kit, board, act, busy,
          onOpen: (key) => setTab(key),
          onSettings: () => setSettingsOpen(true),
          counts: { map: mapCount, prs: prCount }
        })) : null);
    }

    // 与入口 makeSidebarTab 里的 SIDEBAR_KIT 对齐：kit 的字段一变就加 1，入口发现不配套时不渲染本文件
    return { RelaySidebar, TaskBoard, GitHubCard, HandoffTab, MapTab, PrTab, PrDetail, IssueTab, BranchTab, MailTab, MoreTab, SettingsTab, RepoWatchSettings, WatchStart, WatchEdit, LineBox, TemplateBox, RoleModelsBox, DelegationBox, PinBox, DevBox, RestartBox, ModelSelect, ModelEffort, SessionSearch, MailBox, KIT_VERSION: 8 };
  }
});
