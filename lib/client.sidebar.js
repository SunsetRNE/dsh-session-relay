window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.js',
  factory: (require) => {
    'use strict';
    /*
     * 右侧边栏「协作」标签的正文：只在用户打开这个标签时才下载执行。
     * 不能同步 require 别的 client*.js：按钮、文案、请求函数都由入口经 kit 传入。
     * 只在标签可见、页面可见时轮询；关掉标签就停。
     */
    const React = require('react');
    const h = React.createElement;
    const POLL_MS = 20000;

    function useVisible(useTabInfo) {
      let visible = true;
      try { const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined; if (info?.tab && info.tab.visible === false) visible = false; } catch {}
      return visible;
    }

    function useBoard(kit, sessionId, visible) {
      const [state, setState] = React.useState({ board: undefined, error: undefined });
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
            (payload) => { if (alive && Array.isArray(payload.entries)) setState({ board: payload, error: undefined }); },
            (error) => { if (alive && error?.name !== 'AbortError') setState((prev) => ({ board: prev.board, error: kit.errorText(kit.t, error) })); });
        };
        load();
        const timer = setInterval(load, POLL_MS);
        return () => { alive = false; clearInterval(timer); controller?.abort?.(); };
      }, [kit, sessionId, visible, tick]);
      return [state, () => setTick((value) => value + 1)];
    }

    function Row({ kit, dot, name, meta, onClick }) {
      return h('button', { type: 'button', className: 'dshaSr_sideRow', onClick, title: name },
        dot === undefined ? null : h('span', { className: 'dshaSr_dot', 'data-status': dot }),
        h('span', { className: 'dshaSr_sideMain' },
          h('span', { className: 'dshaSr_sideName' }, name),
          meta ? h('span', { className: 'dshaSr_meta dshaSr_clamp' }, meta) : null));
    }

    function RelaySidebar({ kit, sessionId, useTabInfo }) {
      const { t } = kit;
      const visible = useVisible(useTabInfo);
      const [{ board, error }, refresh] = useBoard(kit, sessionId, visible);
      if (typeof sessionId !== 'string' || sessionId === '') return null;
      if (board === undefined) {
        return h('div', { className: 'dshaSr_side' },
          h('p', { className: 'dshaSr_meta', role: error ? 'alert' : 'status' }, error ?? t('loading')),
          error ? h(kit.Button, { onClick: refresh }, t('tasksRefresh')) : null);
      }
      const open = (id) => kit.openSession(id);
      const main = board.coordinator;
      const tasks = board.taskBoard;
      return h('div', { className: 'dshaSr_side' },
        h('section', null,
          h('p', { className: 'dshaSr_sideH' }, board.workspace?.title ?? ''),
          main
            ? h(Row, { kit, dot: 'main', name: kit.format(t('mainIs'), { label: main.label ?? kit.shortId(main.sessionId) }), meta: kit.stateText(t, main.state), onClick: () => open(main.sessionId) })
            : h('p', { className: 'dshaSr_meta' }, t('mainNone'))),
        h('section', null,
          h('p', { className: 'dshaSr_sideH' }, t('lineTitle')),
          h('p', { className: 'dshaSr_meta dshaSr_clamp', title: board.line?.text ?? '' }, board.line?.text || t('lineEmpty'))),
        h('section', null,
          h('p', { className: 'dshaSr_sideH' }, kit.format(t('sideBoard'), { n: board.entries.length })),
          board.entries.length === 0 ? h('p', { className: 'dshaSr_meta' }, t('boardEmpty')) : null,
          ...board.entries.map((entry) => h(Row, {
            key: entry.sessionId, kit, dot: entry.status,
            name: entry.label ?? kit.shortId(entry.sessionId),
            meta: [kit.statusText(t, entry.status), entry.summary].filter(Boolean).join(' · '),
            onClick: () => open(entry.sessionId)
          })),
          board.othersTotal > 0 ? h('p', { className: 'dshaSr_meta' }, kit.format(t('sideOthers'), { n: board.othersTotal })) : null),
        h('section', null,
          h('p', { className: 'dshaSr_sideH' }, tasks ? kit.format(t('sideTasks'), { open: tasks.open.length, claimed: tasks.claimed }) : t('sideNoTasks')),
          ...(tasks ? tasks.open.slice(0, 10).map((row) => h('p', { key: row.id, className: 'dshaSr_meta dshaSr_sideName', title: row.title }, `${row.id}${row.priority ? ' ' + row.priority : ''} · ${row.title}`)) : [])),
        h('div', null, h(kit.Button, { onClick: refresh }, t('tasksRefresh'))));
    }

    return { RelaySidebar };
  }
});
