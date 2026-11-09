window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.more48.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar48.js 按需 require.async 加载；共用件与图标经
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


    function MoreTab({ kit, board, act, busy, onOpen, onSettings, counts }) {
      const { t } = kit;
      const gh = board.github;
      const repo = board.repo;
      const sync = board.sync;
      const quickEntries = [
        ...FOLD_PAGES.map(([key, label, Icon]) => ({ key, label, Icon, open: () => onOpen(key) })),
        { key: 'settings', label: 'sideMoreSettings', Icon: IconGear, open: onSettings }
      ];
      // 窄屏专用：宽屏已经有地图 / PR / 分支 / 问题页签，这里再列一遍就是重复（2026-11-08 复发过一次）。
      // 必须挂 dshaSv_foldOnly，且隐藏规则要用 `.dshaSv .dshaSv_foldOnly` 双类名——单类名会被后面的
      // `.dshaSv_sec{display:grid}` 以同权重覆盖，宽屏又会显示（维护指南 §3「侧栏折叠入口」）。
      const quick = h('section', { className: 'dshaSv_sec dshaSv_span dshaSv_foldOnly' },
        h('p', { className: 'dshaSv_h' }, t('sideMoreQuick')),
        h('div', { className: 'dshaSv_quick' }, ...quickEntries.map(({ key, label, Icon, open }) => {
          const n = Number(counts?.[key]) || 0;
          return h('button', { key, type: 'button', className: 'dshaSv_navBtn', onClick: open },
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
        quick,
        ghHint,
        repoBox,
        syncBox);
    }

    /** 设置 → 仓库：只读探测 + 开关；开关只由用户点，模型没有写入口。 */

      return { MoreTab };
    }

    return { KIT_VERSION: 48, make };
  }
});
