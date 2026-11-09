window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.handoff44.js',
  factory: (require) => {
    'use strict';
    // 页签正文 chunk（T13）：由外壳 client.sidebar44.js 按需 require.async 加载；共用件与图标经
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


    function SnapshotView({ text }) {
      const rows = [];
      let current;
      const flush = () => { if (current !== undefined) { rows.push(current); current = undefined; } };
      for (const raw of String(text ?? '').split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (line.trim() === '') continue;
        if (line.startsWith('  ')) { if (current !== undefined) current.sub.push(line.trim()); continue; }
        if (line.startsWith('- ')) { flush(); current = { kind: 'item', parts: line.slice(2).split(' · '), sub: [] }; continue; }
        flush();
        rows.push({ kind: 'note', line });
      }
      flush();
      const item = (row, index) => {
        const [name, ...rest] = row.parts;
        const pills = [];
        const chips = [];
        const notes = [];
        for (const part of rest) {
          if (part.startsWith('分支 ')) chips.push(h('span', { key: 'br' + chips.length, className: 'dshaSv_metaChip', title: part.slice(3) }, part.slice(3)));
          else if (part.startsWith('提交 ')) chips.push(h('span', { key: 'co' + chips.length, className: 'dshaSv_metaChip', 'data-mono': true, title: part.slice(3) }, part.slice(3, 10)));
          else if (part.startsWith('已分配 ')) pills.push(h('span', { key: 'as' + pills.length, className: 'dshaSv_pill' }, part.slice(4)));
          else if (part.startsWith('插件判定：')) notes.push(part);
          else pills.push(h('span', { key: 'pi' + pills.length, className: 'dshaSv_pill' }, part));
        }
        return h(React.Fragment, { key: 'i' + index },
          h('div', { className: 'dshaSv_snapItem' },
            h('span', { className: 'dshaSv_snapName', title: row.parts.join(' · ') }, name),
            ...pills, ...chips,
            notes.length > 0 ? h('span', { className: 'dshaSv_muted' }, notes.join('；')) : null),
          ...row.sub.map((sub, subIndex) => h('p', { key: 's' + subIndex, className: 'dshaSv_snapSub' }, sub)));
      };
      return h('div', { className: 'dshaSv_snap' }, ...rows.map((row, index) => row.kind === 'item'
        ? item(row, index)
        : h('p', { key: 'n' + index, className: 'dshaSv_snapLine dshaSv_muted' }, row.line)));
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
          snapOpen ? h(SnapshotView, { text: data.snapshot ?? '' }) : null),
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

      return { HandoffTab, SnapshotView };
    }

    return { KIT_VERSION: 44, make };
  }
});
