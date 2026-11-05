window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.panel.js',
  factory: (require) => {
    'use strict';
    /*
     * 协作面板（对话里的「协作」标签、侧栏「会话监督」主面板）与设置 → 会话协作的正文。
     * 第一次打开这些页面才下载执行；入口 client.js 只登记插槽和空壳。
     * 不能同步 require 别的 client*.js：文案、样式、请求和共用部件由入口经 kit 传入（make(kit)）。
     * 改了 kit 用到的字段：两边 PANEL_KIT / KIT_VERSION 一起加 1；只改本文件也要 touch 一下 client.js。
     */
    const React = require('react');
    const h = React.createElement;
    function make(kit) {
      const { format, formatTime, shortId, request, copyText, errorText, Button, Status, useFlash, StarIcon, statusText, stateText } = kit;
      /* ---------------------------------------------------------------- 设置页 */

      /** 每个工作区一条版本线（侧栏登记的工作区为准）；旧服务端没有 groups 时退回单条。 */
      function LineSection({ t, data, run, busy }) {
        const id = React.useId();
        const groups = Array.isArray(data.groups) && data.groups.length > 0 ? data.groups : null;
        if (groups === null) return h(LineEditor, { t, data, run, busy, line: data.line, workspaceId: undefined, head: null });
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('lineTitle')),
          h('p', { className: 'dshaSr_hint' }, t('lineHint')),
          ...groups.map((group) => h(Fold, {
            key: group.id, name: 'set-ws-' + group.id, defaultOpen: group.primary === true || groups.length === 1,
            title: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' } }, group.coordinator ? h(StarIcon, { size: 12 }) : null, group.title),
            summary: [group.coordinator ? format(t('lineWsMain'), { label: group.coordinator.label }) : t('lineWsNoMain'), group.line?.text ? group.line.text.replace(/\s+/g, ' ').slice(0, 60) : t('setWsNoLine')].join(' · ')
          }, h(LineEditor, {
            t, data, run, busy, line: group.line, workspaceId: group.id, bare: true,
            head: h('div', { className: 'dshaSr_entryHead' },
              h('span', { className: 'dshaSr_meta' }, group.registered ? format(t('lineWsCount'), { n: group.count }) : t('lineWsGone')),
              h('span', { className: 'dshaSr_spacer' }),
              h('span', { className: 'dshaSr_meta' }, group.coordinator ? format(t('lineWsMain'), { label: group.coordinator.label }) : t('lineWsNoMain'))),
            sub: group.path ? h('span', { className: 'dshaSr_meta' }, group.path) : null
          })))
        );
      }

      function LineEditor({ t, data, run, busy, line, workspaceId, head, sub, bare }) {
        const id = React.useId();
        const current = line?.text ?? '';
        const [draft, setDraft] = React.useState(current);
        React.useEffect(() => { setDraft(current); }, [current]);
        const max = data.limits?.line ?? 1500;
        const dirty = draft.trim() !== current;
        const who = line?.setBy === 'user' ? t('whoUser') : t('whoModel');
        const target = workspaceId === undefined ? {} : { workspaceId };
        const card = h('div', { className: 'dshaSr_card' },
            head, sub,
            h('textarea', {
              id: id + '-text', className: 'dshaSr_area', value: draft, maxLength: max, rows: 4,
              placeholder: t('linePlaceholder'), 'aria-label': t('lineTitle'),
              onChange: (event) => setDraft(event.target.value)
            }),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_meta' }, line ? format(t('lineSetBy'), { time: formatTime(line.setAt), who }) : t('lineEmpty')),
              h('span', { className: 'dshaSr_spacer' }),
              h('span', { className: 'dshaSr_meta' }, format(t('chars'), { n: draft.length, max })),
              line ? h(Button, { variant: 'danger', disabled: busy, onClick: () => run({ action: 'line-clear', ...target }, t('lineCleared')) }, t('clear')) : null,
              h(Button, { variant: 'primary', disabled: busy || !dirty || draft.trim() === '', onClick: () => run({ action: 'line', text: draft, ...target }, t('saved')) }, t('save'))
            )
          );
        if (bare) return card;
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('lineTitle')),
          h('p', { className: 'dshaSr_hint' }, t('lineHint')),
          card);
      }

      function TemplateEditor({ t, initial, onSave, onCancel, busy, max }) {
        const id = React.useId();
        const [name, setName] = React.useState(initial?.name ?? '');
        const [text, setText] = React.useState(initial?.text ?? '');
        const validName = /^[a-z0-9][a-z0-9._-]{0,31}$/.test(name.trim().toLowerCase());
        return h('div', { className: 'dshaSr_card' },
          h('label', { className: 'dshaSr_label', htmlFor: id + '-name' }, t('tplName')),
          h('input', { id: id + '-name', className: 'dshaSr_input', value: name, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'claim', 'aria-describedby': id + '-nh', onChange: (event) => setName(event.target.value) }),
          h('p', { id: id + '-nh', className: 'dshaSr_hint' }, t('tplNameHint')),
          h('label', { className: 'dshaSr_label', htmlFor: id + '-text' }, t('tplText')),
          h('textarea', { id: id + '-text', className: 'dshaSr_area', value: text, maxLength: max, rows: 6, 'aria-describedby': id + '-th', onChange: (event) => setText(event.target.value) }),
          h('p', { id: id + '-th', className: 'dshaSr_hint' }, t('tplTextHint')),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { disabled: busy, onClick: onCancel }, t('cancel')),
            h(Button, { variant: 'primary', disabled: busy || !validName || text.trim() === '', onClick: () => onSave(name.trim().toLowerCase(), text) }, t('save'))
          )
        );
      }

      function TemplateSection({ t, data, run, busy, copy, folded }) {
        const id = React.useId();
        const [editing, setEditing] = React.useState(undefined);
        const [confirm, setConfirm] = React.useState(undefined);
        const max = data.limits?.text ?? 16000;
        const save = (name, text) => run(
          { action: 'save', name, text, previousName: editing === 'new' ? null : editing, overwrite: editing !== 'new' && editing === name },
          t('saved')
        ).then((ok) => { if (ok) setEditing(undefined); });
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('div', { className: 'dshaSr_row' },
            folded ? null : h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('tplTitle')),
            h('span', { className: 'dshaSr_spacer' }),
            editing === undefined ? h(Button, { variant: 'primary', disabled: busy, onClick: () => setEditing('new') }, t('tplNew')) : null
          ),
          h('p', { className: 'dshaSr_hint' }, t('tplHint')),
          editing === 'new' ? h(TemplateEditor, { t, busy, max, onSave: save, onCancel: () => setEditing(undefined) }) : null,
          data.templates.length === 0 && editing !== 'new' ? h('p', { className: 'dshaSr_hint' }, t('tplEmpty')) : null,
          ...data.templates.map((template) => editing === template.name
            ? h(TemplateEditor, { key: template.name, t, busy, max, initial: template, onSave: save, onCancel: () => setEditing(undefined) })
            : h('div', { key: template.name, className: 'dshaSr_card' },
              h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_tname' }, template.name),
                h('span', { className: 'dshaSr_meta' }, format(t('updated'), { time: formatTime(template.updatedAt) })),
                h('span', { className: 'dshaSr_spacer' }),
                h(Button, { disabled: busy, onClick: () => copy(`/relay new --as ${template.name}1 --tpl ${template.name}`) }, t('copyUse')),
                h(Button, { disabled: busy || editing !== undefined, onClick: () => { setConfirm(undefined); setEditing(template.name); } }, t('edit')),
                confirm === template.name
                  ? h(React.Fragment, null,
                    h(Button, { variant: 'danger', disabled: busy, onClick: () => run({ action: 'remove', name: template.name }, t('removed')).then(() => setConfirm(undefined)) }, t('confirmRemove')),
                    h(Button, { disabled: busy, onClick: () => setConfirm(undefined) }, t('cancel')))
                  : h(Button, { variant: 'danger', disabled: busy, onClick: () => setConfirm(template.name) }, t('remove'))
              ),
              h('pre', { className: 'dshaSr_pre' }, template.text),
              h('span', { className: 'dshaSr_meta' }, t('usage') + '：', h('code', { className: 'dshaSr_code' }, `/relay new --as <别名> --tpl ${template.name} [补充]`))
            ))
        );
      }

      function ReferenceSection({ t, data, copy }) {
        const id = React.useId();
        const groups = Array.isArray(data.reference) ? data.reference : [];
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('refTitle')),
          h('p', { className: 'dshaSr_hint' }, t('refHint')),
          Array.isArray(data.notes) && data.notes.length > 0
            ? h(Fold, { name: 'set-ref-notes', title: t('refNotesTitle'), summary: String(data.notes.length) },
              h('ul', { className: 'dshaSr_notes' }, ...data.notes.map((note, index) => h('li', { key: index }, note))))
            : null,
          ...groups.map((group) => h(Fold, { key: group.id, name: 'set-ref-' + group.id, title: group.title, summary: String(group.items.length) },
            ...group.items.map((item, index) => h('div', { key: index, className: 'dshaSr_item' },
              h('code', { className: 'dshaSr_code', style: { fontWeight: 600 } }, item.syntax),
              h('span', { className: 'dshaSr_hint' }, item.desc),
              h('div', { className: 'dshaSr_ex' },
                h('pre', { className: 'dshaSr_pre dshaSr_code', 'aria-label': t('example') }, item.example),
                h(Button, { label: `${t('copy')} ${item.example}`, onClick: () => copy(item.example) }, t('copy'))
              )
            ))
          ))
        );
      }

      function PluginSection({ t, data, run, busy }) {
        const id = React.useId();
        const v = data.version ?? {};
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('pluginTitle')),
          h('div', { className: 'dshaSr_card' },
            h('span', { className: 'dshaSr_meta' }, format(t('loaded'), { v: v.loaded ?? '?', g: v.generation ?? '?', time: formatTime(v.loadedAt) })),
            h('span', { className: 'dshaSr_meta' }, format(t('disk'), { v: v.disk ?? '?' })),
            h('p', { className: 'dshaSr_hint' }, v.needsRestart ? t('needsRestart') : t('reloadHint')),
            v.lastError ? h('p', { className: 'dshaSr_status', 'data-tone': 'error' }, v.lastError) : null,
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { disabled: busy, onClick: () => run({ action: 'reload' }, undefined) }, t('reload')))
          )
        );
      }

      /** 设置页的 GitHub 区块：动作走看板路由（返回看板），做完重读设置快照；登录进行中每 3 秒刷新。 */
      function GitHubSettings({ t, gh, busy, setBusy, flash, reload, copy }) {
        const pending = gh.loginFlow?.state === 'pending';
        React.useEffect(() => {
          if (!pending) return undefined;
          const timer = setInterval(() => { if (document.visibilityState !== 'hidden') reload(); }, 3000);
          return () => clearInterval(timer);
        }, [pending, reload]);
        const act = React.useCallback(async (body, okText) => {
          setBusy(true);
          try {
            const payload = await request('POST', body);
            if (okText) flash(okText, 'ok');
            return payload;
          } catch (error) {
            flash(errorText(t, error), 'error');
            return undefined;
          } finally {
            setBusy(false);
            reload();
          }
        }, [t, flash, reload, setBusy]);
        return h(GitHubSection, { t, gh, busy, act, copy });
      }

      function SessionRelaySettings({ t }) {
        const [data, setData] = React.useState(undefined);
        const [loadError, setLoadError] = React.useState(undefined);
        const [status, flash] = useFlash();
        const [busy, setBusy] = React.useState(false);
        const serial = React.useRef(0);
        const load = React.useCallback(() => {
          const mine = ++serial.current;
          setLoadError(undefined);
          request('GET').then(
            (payload) => { if (mine === serial.current) setData(payload); },
            (error) => { if (mine === serial.current) setLoadError(errorText(t, error)); }
          );
        }, [t]);
        React.useEffect(() => { load(); return () => { serial.current++; }; }, [load]);
        const run = React.useCallback(async (body, okText) => {
          const mine = ++serial.current;
          setBusy(true);
          flash(body.action === 'reload' ? t('reloading') : t('saving'), undefined, true);
          try {
            const payload = await request('POST', body);
            if (mine === serial.current) { setData(payload); flash(payload.message ?? okText ?? t('saved'), /失败/.test(payload.message ?? '') ? 'error' : 'ok'); }
            return true;
          } catch (error) {
            if (mine === serial.current) flash(errorText(t, error), 'error');
            return false;
          } finally {
            if (mine === serial.current) setBusy(false);
          }
        }, [t, flash]);
        const copy = React.useCallback(async (text) => {
          const ok = await copyText(text);
          flash(ok ? format(t('copied'), { text: text.length > 60 ? text.slice(0, 59) + '…' : text }) : t('copyFailed'), ok ? 'ok' : 'error');
        }, [t, flash]);
        return h('div', { className: 'dshaSr' },
          h('p', { className: 'dshaSr_intro' }, t('intro')),
          loadError ? h(Status, { text: loadError, tone: 'error', onRetry: load, retryText: t('retry') }) : null,
          !data && !loadError ? h(Status, { text: t('loading') }) : null,
          status.text ? h('div', { className: 'dshaSr_toast' }, h(Status, { text: status.text, tone: status.tone })) : null,
          data?.github ? h(GitHubFold, { t, gh: data.github, name: 'set-gh' }, h(GitHubSettings, { t, gh: data.github, busy, setBusy, flash, reload: load, copy })) : null,
          data ? h(Fold, { name: 'set-line', title: t('lineTitle'), defaultOpen: true, summary: Array.isArray(data.groups) ? format(t('setLineSum'), { n: data.groups.length }) : '' }, h(LineSection, { t, data, run, busy })) : null,
          data ? h(Fold, { name: 'set-tpl', title: t('tplTitle'), summary: format(t('setTplSum'), { n: data.templates.length }) }, h(TemplateSection, { t, data, run, busy, copy, folded: true })) : null,
          data ? h(Fold, { name: 'set-ref', title: t('refTitle'), summary: format(t('setRefSum'), { groups: (data.reference ?? []).length, items: (data.reference ?? []).reduce((n, g) => n + g.items.length, 0) }) }, h(ReferenceSection, { t, data, copy })) : null,
          data ? h(Fold, { name: 'set-plugin', title: t('pluginTitle'), defaultOpen: true, tone: data.version?.lastError ? 'error' : undefined, summary: format(t('setPluginSum'), { v: data.version?.loaded ?? '?', g: data.version?.generation ?? '?' }) }, h(PluginSection, { t, data, run, busy })) : null
        );
      }

      /* ---------------------------------------------------------------- 监督面板 */


      function EntryCard({ t, entry, busy, act, openSession, copy, selfId, candidates = [], flash, scope }) {
        const isSelf = entry.sessionId === selfId;
        const [mode, setMode] = React.useState(undefined); // undefined | 'reply' | 'leave' | 'assign' | 'takeover' | 'wake'
        const [toTarget, setToTarget] = React.useState('new');
        const [toPick, setToPick] = React.useState('');
        const [toAlias, setToAlias] = React.useState('');
        const [toNote, setToNote] = React.useState('');
        const [toQueue, setToQueue] = React.useState(false);
        // 新建会话接手 / 唤醒新建用的模型：默认跟随原会话（读不到再用工作会话模型）
        const [newModel, setNewModel] = React.useState('follow');
        const followModel = entry.model ? format(t('modelFollowSource'), { v: entry.model }) : undefined;
        const others = candidates.filter((item) => item.sessionId !== entry.sessionId && item.state !== 'gone');
        // 交接表单打开时每 3 秒查一次原会话 / 接手方是否还在运作（轮次、后台任务、子代理）
        const [activity, setActivity] = React.useState({});
        const watchIds = mode === 'takeover' ? [entry.sessionId, ...(toTarget === 'existing' && toPick ? [toPick] : [])] : [];
        const watchKey = watchIds.join(',');
        React.useEffect(() => {
          if (watchKey === '') { setActivity({}); return undefined; }
          let alive = true;
          const poll = () => request('GET', undefined, { view: 'activity', ids: watchKey }).then((payload) => { if (alive) setActivity(payload.activity ?? {}); }, () => {});
          poll();
          const timer = setInterval(() => { if (document.visibilityState !== 'hidden') poll(); }, 3000);
          return () => { alive = false; clearInterval(timer); };
        }, [watchKey]);
        const sourceState = activity[entry.sessionId];
        const targetState = toTarget === 'existing' && toPick ? activity[toPick] : undefined;
        const statusLine = (state, who) => state === undefined
          ? h('span', { className: 'dshaSr_meta' }, format(t('toChecking'), { who }))
          : state.busy
            ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('toBusy'), { who, why: state.reasons.join('、') }))
            : h('span', { className: 'dshaSr_status', 'data-tone': 'ok' }, format(t('toIdle'), { who }));
        const ready = sourceState !== undefined && !sourceState.busy && (toTarget === 'new' || (toPick !== '' && targetState !== undefined && !targetState.busy));
        const doTakeover = () => act({ action: 'takeover', source: entry.sessionId, to: toTarget === 'new' ? 'new' : toPick, alias: toAlias || undefined, note: toNote || undefined, mode: toQueue ? 'queue' : 'followup', ...(toTarget === 'new' ? modelField(newModel) : {}) }, undefined).then((payload) => {
          const to = payload?.result?.to;
          if (!to) return;
          setMode(undefined); setToAlias(''); setToNote(''); setNewModel('follow');
          flash?.(format(t('toDone'), { label: payload.result.aliases?.[0] ? '@' + payload.result.aliases[0] : shortId(to) }) + modelFlash(t, payload.result), payload.result.modelError ? 'error' : 'ok');
          openSession(to);
        });
        // 唤醒表单：打开时只读预判一次（自动 / 原地 / 新建各会怎么走），确认后才发
        const [wakeForce, setWakeForce] = React.useState('auto');
        const [wakeAlias, setWakeAlias] = React.useState('');
        const [wakeNote, setWakeNote] = React.useState('');
        const [wakeInfo, setWakeInfo] = React.useState(undefined);
        React.useEffect(() => {
          if (mode !== 'wake') { setWakeInfo(undefined); return undefined; }
          const controller = new AbortController();
          request('GET', undefined, { view: 'wake-plan', target: entry.sessionId, fromSession: selfId }, controller.signal)
            .then((payload) => setWakeInfo(payload.wake ?? null), (error) => { if (error?.name !== 'AbortError') setWakeInfo({ error: errorText(t, error) }); });
          return () => controller.abort();
        }, [mode, entry.sessionId, selfId]);
        const wakePlanNow = wakeInfo?.plans?.[wakeForce];
        const wakeBlockedMain = wakeInfo?.coordinator === true && wakePlanNow?.action === 'new';
        const wakeReady = wakePlanNow !== undefined && (wakePlanNow.action === 'resume' || wakePlanNow.action === 'new') && !wakeBlockedMain;
        const wakeLine = () => {
          if (wakeInfo === undefined) return h('span', { className: 'dshaSr_meta' }, t('wakeChecking'));
          if (wakeInfo === null || wakeInfo.error) return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, wakeInfo?.error ?? t('wakeChecking'));
          if (wakePlanNow === undefined) return null;
          if (wakePlanNow.action === 'running') return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('toBusy'), { who: t('toSource'), why: wakeInfo.reasons.join('、') || wakePlanNow.reason }));
          if (wakePlanNow.action === 'gone') return h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, wakePlanNow.reason);
          const v = format(t(wakePlanNow.action === 'new' ? 'wakeWillNew' : 'wakeWillResume'), { why: wakePlanNow.reason });
          return h('span', { className: 'dshaSr_status', 'data-tone': 'ok' }, format(t('wakeWill'), { v }));
        };
        const doWake = () => act({
          action: 'wake', target: entry.sessionId, force: wakeForce === 'auto' ? undefined : wakeForce,
          alias: wakePlanNow?.action === 'new' ? (wakeAlias || undefined) : undefined, note: wakeNote || undefined,
          ...(wakePlanNow?.action === 'new' ? modelField(newModel) : {})
        }, undefined).then((payload) => {
          const to = payload?.result?.to;
          if (!to) return;
          const isNew = payload.result.action === 'new';
          setMode(undefined); setWakeAlias(''); setWakeNote(''); setWakeForce('auto'); setNewModel('follow');
          const label = isNew && payload.result.aliases?.[0] ? '@' + payload.result.aliases[0] : shortId(to);
          flash?.(format(t(isNew ? 'wakeDoneNew' : 'wakeDoneResume'), { label }) + (isNew ? modelFlash(t, payload.result) : ''), payload.result.modelError ? 'error' : 'ok');
          openSession(to);
        });
        const [assignValue, setAssignValue] = React.useState('');
        const [text, setText] = React.useState('');
        // 卡片折叠：默认只看头部与一行摘要；需要处理的、打开了表单的自动展开
        const [unfolded, setUnfolded] = React.useState(false);
        const expanded = unfolded || mode !== undefined || entry.category === 'attention';
        const id = React.useId();
        const send = () => act({ action: 'reply', target: entry.sessionId, text }, t('sent')).then((ok) => { if (ok) { setText(''); setMode(undefined); } });
        return h('div', { className: 'dshaSr_card', 'data-status': entry.status, 'data-self': isSelf ? 'true' : undefined },
          h('div', { className: 'dshaSr_entryHead' },
            h('span', { className: 'dshaSr_dot', 'data-status': entry.status, 'aria-hidden': true }),
            h('span', { className: 'dshaSr_entryName' }, entry.label),
            isSelf ? h('span', { className: 'dshaSr_badge' }, t('thisSession')) : null,
            h('span', { className: 'dshaSr_badge', 'data-status': entry.answered ? 'working' : entry.status }, statusText(t, entry.status) || '—'),
            entry.answered ? h('span', { className: 'dshaSr_badge' }, t('answered')) : null,
            entry.categoryReason && entry.categoryReason !== entry.status ? h('span', { className: 'dshaSr_badge', 'data-status': entry.category === 'archived' ? 'done' : 'blocked', title: entry.categoryDetail || undefined }, t('why_' + entry.categoryReason)) : null,
            entry.queue ? h('span', { className: 'dshaSr_badge', 'data-status': 'ready' }, format(t('queueNo'), { n: entry.queue })) : null,
            entry.assigned ? h('span', { className: 'dshaSr_badge', 'data-status': 'main' }, format(t('assignedTo'), { v: entry.assigned })) : null,
            h('span', { className: 'dshaSr_meta' }, stateText(t, entry.state)),
            entry.workspace ? h('span', { className: 'dshaSr_meta' }, format(t('inWorkspace'), { v: entry.workspace })) : null,
            h('span', { className: 'dshaSr_spacer' }),
            h('button', { type: 'button', className: 'dshaSr_chip', title: entry.sessionId, onClick: () => copy(entry.sessionId, t('idCopied')), 'aria-label': `${t('copyId')} ${entry.sessionId}` }, shortId(entry.sessionId))
          ),
          entry.summary ? h('span', { className: expanded ? undefined : 'dshaSr_clamp' }, entry.summary) : null,
          ...Object.entries(entry.subagents ?? {}).map(([subId, sub]) => h('span', { key: 'sub-' + subId, className: 'dshaSr_meta', 'data-tone': sub.status === 'question' || sub.status === 'blocked' ? 'error' : undefined },
            format(t('subagentReport'), { id: shortId(subId), status: statusText(t, sub.status), time: formatTime(sub.reportedAt) }) + sub.summary + (sub.question && (sub.status === 'question' || sub.status === 'blocked') ? ' · ' + format(t('question'), { v: sub.question }) : ''))),
          entry.question && (entry.status === 'question' || entry.status === 'blocked') ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('question'), { v: entry.question })) : null,
          h('span', { className: 'dshaSr_meta' }, [
            entry.branch ? format(t('branch'), { v: entry.branch }) : '',
            entry.commit ? format(t('commit'), { v: entry.commit }) : '',
            entry.model ? format(t('modelIs'), { v: entry.model }) : '',
            formatTime(entry.updatedAt)
          ].filter(Boolean).join(' · ')),
          !expanded && (entry.conflicts?.length ?? 0) + (entry.declarationIssues?.length ?? 0) > 0
            ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('conflictCount'), { n: (entry.conflicts?.length ?? 0) + (entry.declarationIssues?.length ?? 0) })) : null,
          ...(expanded ? [
          entry.files ? h('span', { className: 'dshaSr_meta' }, format(t('files'), { v: entry.files })) : null,
          ...(entry.conflicts ?? []).map((item, index) => h('span', { key: 'c' + index, className: 'dshaSr_status', 'data-tone': 'error' }, format(t('conflict'), { label: item.label, paths: item.paths.join('、') }))),
          entry.lastTurn && entry.lastTurnAt > (entry.reportedAt ?? 0) ? h('span', { className: 'dshaSr_meta' }, format(t('lastTurn'), { v: entry.lastTurn })) : null,
          entry.declaration ? h('span', { className: 'dshaSr_meta' }, format(t('declOf'), { rel: entry.declaration.rel, kind: entry.declaration.kind === 'active' ? t('declActive') : t('declDone'), merge: entry.declaration.mergeLabel + (entry.declaration.build ? ' ' + entry.declaration.build : '') }) + (entry.declaration.count > 1 ? format(t('declMore'), { n: entry.declaration.count - 1 }) : '')) : null,
          ...(entry.declarationIssues ?? []).map((text, index) => h('span', { key: 'd' + index, className: 'dshaSr_status', 'data-tone': 'error' }, '⚠ ' + text))
          ] : []),
          mode === 'assign' ? h('div', { className: 'dshaSr_row' },
            h('input', { className: 'dshaSr_input', style: { flex: '1 1 8em' }, value: assignValue, maxLength: 80, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('assignPlaceholder'), 'aria-label': t('assign'), onChange: (event) => setAssignValue(event.target.value) }),
            h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
            h(Button, { variant: 'primary', disabled: busy || assignValue.trim() === '', onClick: () => act({ action: 'assign', target: entry.sessionId, value: assignValue }, t('assigned')).then((ok) => { if (ok) { setAssignValue(''); setMode(undefined); } }) }, t('assignSend'))
          ) : null,
          mode === 'takeover' ? h('div', { className: 'dshaSr_sec' },
            h('span', { className: 'dshaSr_label' }, format(t('toTitle'), { label: entry.label })),
            h('div', { className: 'dshaSr_radio', role: 'radiogroup' },
              h('label', null, h('input', { type: 'radio', checked: toTarget === 'new', onChange: () => setToTarget('new') }), t('toNew')),
              h('label', null, h('input', { type: 'radio', checked: toTarget === 'existing', disabled: others.length === 0, onChange: () => setToTarget('existing') }), t('toExisting'))),
            toTarget === 'existing' ? h('select', { className: 'dshaSr_input', value: toPick, 'aria-label': t('toExisting'), onChange: (event) => setToPick(event.target.value) },
              h('option', { value: '' }, '—'),
              ...others.map((item) => h('option', { key: item.sessionId, value: item.sessionId, disabled: item.state === 'running' }, `${shortId(item.sessionId)} · ${item.title ?? item.label}${item.state === 'running' ? t('optRunning') : ''}`))) : null,
            statusLine(sourceState, t('toSource')),
            targetState !== undefined || (toTarget === 'existing' && toPick) ? statusLine(targetState, t('toTarget')) : null,
            ...[...(sourceState?.notes ?? []), ...(targetState?.notes ?? [])].map((note, index) => h('span', { key: 'n' + index, className: 'dshaSr_meta' }, format(t('toNotes'), { v: note }))),
            h('input', { className: 'dshaSr_input', value: toAlias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('toAlias'), 'aria-label': t('toAlias'), onChange: (event) => setToAlias(event.target.value) }),
            toTarget === 'new' ? h(ModelPicker, { t, scope, value: newModel, onChange: setNewModel, followLabel: followModel, disabled: busy }) : null,
            h('textarea', { className: 'dshaSr_area', rows: 2, value: toNote, placeholder: t('toNote'), 'aria-label': t('toNote'), onChange: (event) => setToNote(event.target.value) }),
            h('label', { className: 'dshaSr_check' }, h('input', { type: 'checkbox', checked: toQueue, onChange: (event) => setToQueue(event.target.checked) }), h('span', null, t('toQueue'))),
            h('span', { className: 'dshaSr_hint' }, t('toHint')),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
              h(Button, { variant: 'primary', disabled: busy || !ready, onClick: doTakeover }, t('toConfirm')))
          ) : null,
          mode === 'wake' ? h('div', { className: 'dshaSr_sec' },
            h('span', { className: 'dshaSr_label' }, format(t('wakeTitle'), { label: entry.label })),
            h('div', { className: 'dshaSr_radio', role: 'radiogroup', 'aria-label': format(t('wakeTitle'), { label: entry.label }) },
              ...['auto', 'resume', 'new'].map((force) => h('label', { key: force },
                h('input', { type: 'radio', name: id + '-wake', checked: wakeForce === force, onChange: () => setWakeForce(force) }),
                t(force === 'auto' ? 'wakeAuto' : force === 'resume' ? 'wakeResume' : 'wakeNew')))),
            wakeLine(),
            wakeBlockedMain ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, t('wakeMain')) : null,
            ...(wakeInfo?.notes ?? []).map((note, index) => h('span', { key: 'wn' + index, className: 'dshaSr_meta' }, format(t('toNotes'), { v: note }))),
            wakePlanNow?.action === 'new' ? h('input', { className: 'dshaSr_input', value: wakeAlias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('wakeAlias'), 'aria-label': t('wakeAlias'), onChange: (event) => setWakeAlias(event.target.value) }) : null,
            wakePlanNow?.action === 'new' && !wakeBlockedMain ? h(ModelPicker, { t, scope, value: newModel, onChange: setNewModel, followLabel: followModel, disabled: busy }) : null,
            h('textarea', { className: 'dshaSr_area', rows: 2, value: wakeNote, placeholder: t('wakeNote'), 'aria-label': t('wakeNote'), onChange: (event) => setWakeNote(event.target.value) }),
            h('span', { className: 'dshaSr_hint' }, t('wakeHint')),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
              h(Button, { variant: 'primary', disabled: busy || !wakeReady, onClick: doWake }, t('wakeConfirm')))
          ) : null,
          mode === 'reply' ? h('div', { className: 'dshaSr_sec' },
            h('textarea', { id: id + '-reply', className: 'dshaSr_area', rows: 3, value: text, placeholder: t('replyPlaceholder'), 'aria-label': t('reply'), onChange: (event) => setText(event.target.value) }),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')),
              h(Button, { variant: 'primary', disabled: busy || text.trim() === '', onClick: send }, t('send')))
          ) : null,
          !expanded ? h('div', { className: 'dshaSr_row' },
            entry.state !== 'gone' && !isSelf ? h(Button, { disabled: busy, onClick: () => openSession(entry.sessionId) }, t('openSession')) : null,
            entry.state !== 'gone' && entry.status === 'ready' ? h(Button, { disabled: busy, onClick: () => setMode('assign') }, t('assign')) : null,
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { onClick: () => setUnfolded(true), 'aria-expanded': 'false' }, t('cardMore'))
          ) : h('div', { className: 'dshaSr_row' },
            entry.state !== 'gone' && !isSelf ? h(Button, { disabled: busy, onClick: () => openSession(entry.sessionId) }, t('openSession')) : null,
            entry.state !== 'gone' && mode !== 'reply' ? h(Button, { disabled: busy, onClick: () => setMode('reply') }, t('reply')) : null,
            entry.state !== 'gone' && entry.status === 'ready' && mode !== 'assign' ? h(Button, { disabled: busy, onClick: () => setMode('assign') }, t('assign')) : null,
            // 运行中也显示按钮，但置灰并写明原因；打开后由实时检查决定能否确认
            !isSelf && entry.state !== 'gone' && mode !== 'wake'
              ? h(Button, { disabled: busy || entry.state === 'running', onClick: () => setMode('wake') }, entry.state === 'running' ? t('wakeRunning') : t('wake')) : null,
            !isSelf && entry.state !== 'gone' && entry.status !== 'done' && entry.status !== 'abandoned' && mode !== 'takeover'
              ? h(Button, { disabled: busy || entry.state === 'running', onClick: () => setMode('takeover') }, entry.state === 'running' ? t('toRunning') : t('takeover')) : null,
            entry.state !== 'gone' ? h(Button, { disabled: busy, onClick: () => act({ action: 'set-main', target: entry.sessionId }, t('saved')) }, t('setMain')) : null,
            h('span', { className: 'dshaSr_spacer' }),
            mode === 'leave'
              ? h(React.Fragment, null,
                h(Button, { variant: 'danger', disabled: busy, onClick: () => act({ action: 'leave', target: entry.sessionId }, t('saved')).then(() => setMode(undefined)) }, t('confirmLeave')),
                h(Button, { disabled: busy, onClick: () => setMode(undefined) }, t('cancel')))
              : h(Button, { variant: 'danger', disabled: busy, onClick: () => setMode('leave') }, t('leave')),
            unfolded && mode === undefined && entry.category !== 'attention' ? h(Button, { onClick: () => setUnfolded(false), 'aria-expanded': 'true' }, t('cardLess')) : null
          )
        );
      }

      // 归档分区「清理」：两步确认；默认不清「提交本机已不存在」（要核对），单独一个按钮
      function PruneArchive({ t, archived, busy, act }) {
        const [armed, setArmed] = React.useState(undefined);
        const missing = archived.filter((entry) => entry.categoryReason === 'missing').length;
        const rest = archived.length - missing;
        const run = (kind) => {
          if (armed !== kind) { setArmed(kind); return; }
          setArmed(undefined);
          act({ action: 'prune-archived', reasons: kind === 'missing' ? ['missing'] : undefined }, undefined);
        };
        if (rest === 0 && missing === 0) return null;
        return h('div', { className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta', style: { flex: '1 1 14em' } }, t('pruneHint')),
          rest > 0 ? h(Button, { variant: armed === 'all' ? 'danger' : undefined, disabled: busy, onClick: () => run('all') }, format(t(armed === 'all' ? 'pruneConfirm' : 'prune'), { n: rest })) : null,
          missing > 0 ? h(Button, { variant: armed === 'missing' ? 'danger' : undefined, disabled: busy, onClick: () => run('missing') }, format(t(armed === 'missing' ? 'pruneConfirm' : 'pruneMissing'), { n: missing })) : null,
          armed ? h(Button, { disabled: busy, onClick: () => setArmed(undefined) }, t('cancel')) : null);
      }

      /*
       * 新建会话用的模型（0.19.0）。目录与本工作区两组角色模型由 view=models 给出，按会话 / 工作区缓存 30 秒。
       * 表单值：'follow'（跟随：角色模型或原会话）| 'default'（DSH 全局默认）| { provider, model, reasoningEffort? }。
       */
      const modelsCache = new Map();
      function modelsQuery(scope) {
        return scope?.session ? { session: scope.session } : scope?.workspace ? { workspace: scope.workspace } : {};
      }
      function useModels(scope, refreshKey) {
        const key = JSON.stringify(modelsQuery(scope));
        const cached = modelsCache.get(key);
        const [data, setData] = React.useState(cached?.value);
        React.useEffect(() => {
          const hit = modelsCache.get(key);
          if (hit !== undefined && Date.now() - hit.at < 30000 && refreshKey === hit.refreshKey) { setData(hit.value); return undefined; }
          let alive = true;
          request('GET', undefined, { view: 'models', ...modelsQuery(scope) }).then(
            (payload) => { const value = payload?.models ?? null; modelsCache.set(key, { at: Date.now(), value, refreshKey }); if (alive) setData(value); },
            () => { if (alive) setData(null); });
          return () => { alive = false; };
        }, [key, refreshKey]);
        return data;
      }
      function modelKey(provider, model) { return provider + '\u0001' + model; }
      function modelText(selection) {
        if (!selection || typeof selection !== 'object') return '';
        return selection.provider + '/' + selection.model + (selection.reasoningEffort ? '@' + selection.reasoningEffort : '');
      }
      /** 模型下拉 + 推理强度。value / onChange 用上面的表单值；followLabel 说明「跟随」此刻会落到哪个模型。 */
      function ModelPicker({ t, scope, value, onChange, followLabel, label, disabled, refreshKey, allowFollow = true }) {
        const id = React.useId();
        const data = useModels(scope, refreshKey);
        if (data === undefined) return h('span', { className: 'dshaSr_meta' }, t('modelLoading'));
        if (data === null || !data.supported || !data.catalog) return h('span', { className: 'dshaSr_meta' }, t('modelUnsupported'));
        const groups = data.catalog.groups ?? [];
        const picked = value && typeof value === 'object' ? value : undefined;
        const selected = picked ? modelKey(picked.provider, picked.model) : value === 'default' ? 'default' : allowFollow ? 'follow' : 'default';
        const info = picked ? groups.find((group) => group.id === picked.provider)?.models.find((item) => item.id === picked.model) : undefined;
        const efforts = info?.efforts ?? [];
        const globalDefault = data.catalog.default;
        const sameAsDefault = (provider, model) => Boolean(globalDefault?.reasoningEffort) && globalDefault.provider === provider && globalDefault.model === model;
        const pick = (raw) => {
          if (raw === 'follow' || raw === 'default') { onChange(raw); return; }
          const [provider, model] = raw.split('\u0001');
          const next = groups.find((group) => group.id === provider)?.models.find((item) => item.id === model);
          // 和 DSH 全局默认是同一个模型：带上全局默认的推理强度；否则用模型自己的默认强度
          const effort = sameAsDefault(provider, model) ? globalDefault.reasoningEffort : next?.defaultEffort;
          onChange({ provider, model, ...(effort ? { reasoningEffort: effort } : {}) });
        };
        const defaultText = data.labels?.default ? format(t('modelGlobalDefault'), { v: data.labels.default }) : t('modelGlobalDefaultBare');
        return h('div', { className: 'dshaSr_row' },
          h('label', { className: 'dshaSr_meta', htmlFor: id + '-m' }, label ?? t('modelLabel')),
          h('select', { id: id + '-m', className: 'dshaSr_input', style: { flex: '1 1 14em', width: 'auto' }, value: selected, disabled, onChange: (event) => pick(event.target.value) },
            allowFollow ? h('option', { value: 'follow' }, followLabel ? format(t('modelFollowIs'), { v: followLabel }) : t('modelFollow')) : null,
            h('option', { value: 'default' }, defaultText),
            ...groups.map((group) => h('optgroup', { key: group.id, label: group.name || group.id },
              ...group.models.map((item) => h('option', { key: item.id, value: modelKey(group.id, item.id) }, item.name && item.name !== item.id ? `${item.name}（${item.id}）` : item.id))))),
          efforts.length > 0 ? h('select', { className: 'dshaSr_input', style: { flex: '0 1 9em', width: 'auto' }, value: picked?.reasoningEffort ?? '', disabled, 'aria-label': t('modelEffort'),
            onChange: (event) => onChange({ provider: picked.provider, model: picked.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) }) },
            // 显式的「默认」项：值为空时界面也显示「默认」，不会像只有一个选项时那样看着选中了 Max、实际没发强度
            h('option', { value: '' }, info?.defaultEffort ? format(t('modelEffortDefaultIs'), { v: info.defaultEffort }) : t('modelEffortDefault')),
            ...efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name || effort.id))) : null);
      }
      /** 成功提示后补一句模型：设上了写模型，没设上写原因。 */
      function modelFlash(t, result) {
        if (result?.modelError) return ' ' + format(t('modelNotApplied'), { v: result.modelError });
        return result?.modelLabel ? ' ' + format(t('modelIs'), { v: result.modelLabel }) : '';
      }
      /** 表单值 → 请求体字段：跟随时不发（服务端按角色 / 原会话）。 */
      function modelField(value) {
        return value === 'default' ? { model: 'default' } : value && typeof value === 'object' ? { model: value } : {};
      }
      /** 概览页「新建会话用的模型」：本工作区主会话 / 工作会话各一组，只有用户能改。 */
      function RoleModelsSection({ t, scope, board, busy, act, extra }) {
        const [refresh, setRefresh] = React.useState(0);
        const data = useModels(scope, refresh);
        const [edit, setEdit] = React.useState({});
        if (data === undefined) return h('span', { className: 'dshaSr_meta' }, t('modelLoading'));
        if (data === null || !data.supported) return h('p', { className: 'dshaSr_hint' }, t('modelUnsupported'));
        const row = (role) => {
          const current = data.roles?.[role] ?? null;
          const value = edit[role] ?? (current ?? 'default');
          const dirty = edit[role] !== undefined && modelText(edit[role] === 'default' ? null : edit[role]) !== modelText(current);
          return h('div', { key: role, className: 'dshaSr_card' },
            h('span', { className: 'dshaSr_label' }, t(role === 'main' ? 'modelRoleMain' : 'modelRoleWorker')),
            h('span', { className: 'dshaSr_hint' }, t(role === 'main' ? 'modelRoleMainHint' : 'modelRoleWorkerHint')),
            h(ModelPicker, { t, scope, value, allowFollow: false, refreshKey: refresh, disabled: busy, onChange: (next) => setEdit({ ...edit, [role]: next }) }),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_meta', style: { flex: '1 1 12em' } }, format(t('modelRoleNow'), { v: current ? modelText(current) : t('modelFollow') })),
              h(Button, { variant: 'primary', disabled: busy || !dirty, onClick: () => act({ action: 'role-model', role, ...(value === 'default' ? { model: 'default' } : { model: value }), ...extra }, t('saved')).then((payload) => {
                if (payload) { modelsCache.clear(); setEdit({ ...edit, [role]: undefined }); setRefresh(refresh + 1); }
              }) }, t('save'))));
        };
        return h(React.Fragment, null, h('p', { className: 'dshaSr_hint' }, t('modelRolesHint')), row('main'), row('worker'));
      }

      function OpenSection({ t, board, busy, act, openSession, scope }) {
        const id = React.useId();
        const [alias, setAlias] = React.useState('');
        const [cwd, setCwd] = React.useState(board.defaultCwd ?? '');
        // 角色：工作会话 / 主会话 / 不加入。没有主会话时默认选主会话
        const [role, setRole] = React.useState(board.coordinator ? 'worker' : 'main');
        const join = role === 'worker';
        const [model, setModel] = React.useState('follow');
        React.useEffect(() => { if (cwd === '' && board.defaultCwd) setCwd(board.defaultCwd); }, [board.defaultCwd]);
        const create = () => act({ action: 'open', alias, cwd, join, role, ...modelField(model) }, undefined).then((payload) => {
          if (payload?.result?.sessionId) { setAlias(''); setModel('follow'); openSession(payload.result.sessionId); }
        });
        const followLabel = (role === 'main' ? board.roleModels?.main : board.roleModels?.worker) || undefined;
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('openTitle')),
          h('p', { className: 'dshaSr_hint' }, t('openHint')),
          h('div', { className: 'dshaSr_card' },
            h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('alias')),
            h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'fix2', onChange: (event) => setAlias(event.target.value) }),
            h('label', { className: 'dshaSr_label', htmlFor: id + '-cwd' }, t('cwd')),
            h('input', { id: id + '-cwd', className: 'dshaSr_input', value: cwd, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, onChange: (event) => setCwd(event.target.value) }),
            h('div', { className: 'dshaSr_radio', role: 'radiogroup', 'aria-label': t('openRole') },
              h('label', null, h('input', { type: 'radio', checked: role === 'main', onChange: () => setRole('main') }), t('roleMain')),
              h('label', null, h('input', { type: 'radio', checked: role === 'worker', onChange: () => setRole('worker') }), t('join')),
              h('label', null, h('input', { type: 'radio', checked: role === 'none', onChange: () => setRole('none') }), t('roleNone'))),
            role === 'main' && board.coordinator ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('roleMainReplace'), { label: board.coordinator.label })) : null,
            h(ModelPicker, { t, scope, value: model, onChange: setModel, followLabel, disabled: busy }),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { variant: 'primary', disabled: busy || cwd.trim() === '', onClick: create }, role === 'main' ? t('createMain') : t('create')))
          )
        );
      }

      /** 交接面板：起草 / 审核 / 选接手方 / 确认；确认只在这里或 /relay handoff confirm。 */
      function HandoffSection({ t, board, busy, act, openSession, flash, selfId, scope }) {
        const id = React.useId();
        const handoff = board.handoff;
        const draft = handoff.draft;
        const [notes, setNotes] = React.useState(draft?.notes ?? '');
        const [dirty, setDirty] = React.useState(false);
        const [writing, setWriting] = React.useState(false);
        const [showSnap, setShowSnap] = React.useState(false);
        const [target, setTarget] = React.useState('new');
        const [pick, setPick] = React.useState('');
        const [alias, setAlias] = React.useState('');
        const [queue, setQueue] = React.useState(false);
        const [armed, setArmed] = React.useState(false);
        const [allHistory, setAllHistory] = React.useState(false);
        const [model, setModel] = React.useState('follow');
        // 自动刷新带来新草稿时，没改过才覆盖输入框
        React.useEffect(() => { if (!dirty) setNotes(draft?.notes ?? ''); }, [draft?.updatedAt]);
        const candidates = [...(board.entries ?? []), ...(board.others ?? [])].filter((item) => item.sessionId !== handoff.coordinator && item.state !== 'gone');
        const targetLabel = target === 'new' ? (alias.trim() ? '@' + alias.trim() : t('hoTargetNew')) : (candidates.find((item) => item.sessionId === pick)?.label ?? shortId(pick));
        const canConfirm = !busy && (target === 'new' || pick !== '') && (draft !== null || notes.trim() !== '');
        const confirm = () => {
          if (!armed) { setArmed(true); return; }
          setArmed(false);
          act({ action: 'handoff-confirm', to: target === 'new' ? 'new' : pick, alias: target === 'new' ? alias : undefined, notes: dirty || draft === null ? notes : undefined, mode: queue ? 'queue' : 'followup', ...(target === 'new' ? modelField(model) : {}) }, undefined).then((payload) => {
            const to = payload?.result?.to;
            if (!to) return;
            setDirty(false); setAlias(''); setModel('follow');
            flash(format(t('hoDone'), { label: payload.result.alias ? '@' + payload.result.alias : shortId(to) }) + modelFlash(t, payload.result), payload.result.modelError ? 'error' : 'ok');
            openSession(to);
          });
        };
        const editing = draft !== null || writing;
        const history = handoff.history ?? [];
        const latest = history[0];
        // 收起时一行摘要：草稿状态 + 最近一次交接；有草稿或没有主会话（要处理）时默认展开
        const summary = [
          draft ? format(t('hoDraftBy'), { who: draft.by === 'model' ? t('hoByModel') : draft.by === 'plugin' ? t('hoByPlugin') : t('hoByUser'), time: formatTime(draft.updatedAt) }) : handoff.coordinator === null ? t('hoNoMain') : t('hoNoDraft'),
          latest ? format(t('hoLatest'), { time: formatTime(latest.at) }) : ''
        ].filter(Boolean).join(' · ');
        const historyRow = (item, index) => h('div', { key: index, className: 'dshaSr_hoRow' },
          h('div', { className: 'dshaSr_hoText' },
            h('span', { className: 'dshaSr_hoWho dshaSr_clamp' }, `${item.fromLabel ?? '—'} → ${item.toLabel}`),
            h('span', { className: 'dshaSr_meta' }, formatTime(item.at))),
          item.from && item.from !== handoff.coordinator ? h(Button, { disabled: busy, onClick: () => act({ action: 'set-main', target: item.from }, t('saved')) }, t('hoRevert')) : h('span'));
        return h(Fold, { name: 'handoff', title: t('hoTitle'), summary, tone: handoff.coordinatorFailure ? 'error' : undefined, defaultOpen: draft !== null || handoff.coordinator === null },
          h('p', { className: 'dshaSr_hint' }, t('hoHint')),
          h('div', { className: 'dshaSr_card' },
            handoff.coordinator === null ? h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_meta', style: { flex: '1 1 14em' } }, t('hoNoMain')),
              selfId ? h(Button, { disabled: busy, onClick: () => act({ action: 'set-main', target: selfId }, t('saved')) }, t('makeSelfMain')) : null,
              h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'open', role: 'main', cwd: board.defaultCwd || board.workspace?.path, fromSession: undefined }, undefined).then((payload) => { if (payload?.result?.sessionId) openSession(payload.result.sessionId); }) }, t('createMain'))) : null,
            draft
              ? h('span', { className: 'dshaSr_meta' }, format(t('hoDraftBy'), { who: draft.by === 'model' ? t('hoByModel') : draft.by === 'plugin' ? t('hoByPlugin') : t('hoByUser'), time: formatTime(draft.updatedAt) }))
              : h('span', { className: 'dshaSr_meta' }, t('hoNoDraft')),
            handoff.coordinatorFailure ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('hoFailed'), { text: handoff.coordinatorFailure.text })) : null,
            h('div', { className: 'dshaSr_row' },
              // 主会话上一轮失败（如上下文超限）时不让它起草，改成插件整理
              handoff.coordinator !== null && !handoff.coordinatorFailure && !editing ? h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'handoff-ask' }, t('hoAsked')) }, t('hoAsk')) : null,
              handoff.coordinator !== null ? h(Button, { variant: handoff.coordinatorFailure ? 'primary' : undefined, disabled: busy, onClick: () => act({ action: 'handoff-auto' }, t('hoAutoDone')).then((payload) => { if (payload) { setDirty(false); setWriting(true); } }) }, t('hoAuto')) : null,
              !editing ? h(Button, { disabled: busy, onClick: () => setWriting(true) }, t('hoWrite')) : null),
            editing ? h(React.Fragment, null,
              h('label', { className: 'dshaSr_label', htmlFor: id + '-notes' }, t('hoNotes')),
              h('textarea', { id: id + '-notes', className: 'dshaSr_area', rows: 8, maxLength: 2000, value: notes, onChange: (event) => { setNotes(event.target.value); setDirty(true); setArmed(false); } }),
              h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_meta' }, format(t('chars'), { n: notes.length, max: 2000 })),
                h('span', { className: 'dshaSr_spacer' }),
                draft ? h(Button, { variant: 'danger', disabled: busy, onClick: () => act({ action: 'handoff-discard' }, t('removed')).then(() => { setDirty(false); setWriting(false); setNotes(''); }) }, t('hoDiscard')) : null,
                h(Button, { disabled: busy || notes.trim() === '' || !dirty, onClick: () => act({ action: 'handoff-save', notes }, t('saved')).then((payload) => { if (payload) setDirty(false); }) }, t('hoSave')))) : null,
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_meta' }, t('hoSnapshot')),
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { onClick: () => setShowSnap(!showSnap) }, showSnap ? t('hoHideSnapshot') : t('hoShowSnapshot'))),
            showSnap ? h('pre', { className: 'dshaSr_pre' }, handoff.snapshot) : null,
            editing ? h(React.Fragment, null,
              h('span', { className: 'dshaSr_label', id: id + '-target' }, t('hoTarget')),
              h('div', { className: 'dshaSr_radio', role: 'radiogroup', 'aria-labelledby': id + '-target' },
                h('label', null, h('input', { type: 'radio', name: id + '-to', checked: target === 'new', onChange: () => { setTarget('new'); setArmed(false); } }), t('hoTargetNew')),
                h('label', null, h('input', { type: 'radio', name: id + '-to', checked: target === 'existing', disabled: candidates.length === 0, onChange: () => { setTarget('existing'); setArmed(false); } }), t('hoTargetExisting'))),
              target === 'new'
                ? h(React.Fragment, null,
                  h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('hoAlias')),
                  h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: 'main2', onChange: (event) => { setAlias(event.target.value); setArmed(false); } }),
                  h(ModelPicker, { t, scope, value: model, onChange: (next) => { setModel(next); setArmed(false); }, followLabel: board.roleModels?.main || undefined, disabled: busy }))
                : h(React.Fragment, null,
                  h('label', { className: 'dshaSr_label', htmlFor: id + '-pick' }, t('hoPick')),
                  h('select', { id: id + '-pick', className: 'dshaSr_input', value: pick, onChange: (event) => { setPick(event.target.value); setArmed(false); } },
                    h('option', { value: '' }, '—'),
                    ...candidates.map((item) => h('option', { key: item.sessionId, value: item.sessionId }, `${shortId(item.sessionId)} · ${item.title ?? item.label}`)))),
              h('label', { className: 'dshaSr_check' },
                h('input', { type: 'checkbox', checked: queue, onChange: (event) => setQueue(event.target.checked) }),
                h('span', null, t('hoQueue'))),
              h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_spacer' }),
                armed ? h(Button, { disabled: busy, onClick: () => setArmed(false) }, t('cancel')) : null,
                h(Button, { variant: armed ? 'danger' : 'primary', disabled: !canConfirm, onClick: confirm }, armed ? format(t('hoConfirmAgain'), { target: targetLabel }) : t('hoConfirm')))) : null
          ),
          // 最近交接：只列最近一次，其余点开再看（插件最多留 5 条）
          history.length > 0 ? h('div', { className: 'dshaSr_card' },
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_label', style: { flex: '1 1 auto' } }, t('hoHistory')),
              history.length > 1 ? h('button', { type: 'button', className: 'dshaSr_link', 'aria-expanded': allHistory ? 'true' : 'false', onClick: () => setAllHistory(!allHistory) }, allHistory ? t('hoHistoryLess') : format(t('hoHistoryMore'), { n: history.length })) : null),
            ...(allHistory ? history : history.slice(0, 1)).map(historyRow)
          ) : null
        );
      }

      function releaseGap(t, main) {
        const m = Number((/\d+/.exec(main.build ?? '') ?? [])[0]);
        const r = Number((/\d+/.exec(main.released?.build ?? '') ?? [])[0]);
        if (!(m > r)) return '';
        return format(t('declGap'), { range: m - r === 1 ? 'build' + m : 'build' + (r + 1) + '–' + m });
      }

      /** 侧栏自动置顶开关（按工作区，默认关闭）。 */
      function PinSection({ t, board, busy, act }) {
        const id = React.useId();
        const pin = board.autoPin;
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('pinTitle')),
          h('p', { className: 'dshaSr_hint' }, t('pinHint')),
          h('div', { className: 'dshaSr_card' },
            h('label', { className: 'dshaSr_check' },
              h('input', { type: 'checkbox', checked: pin.enabled, disabled: busy || !pin.available, onChange: (event) => act({ action: 'auto-pin', enabled: event.target.checked, workspaceId: board.workspace?.id }, event.target.checked ? t('pinOn') : t('pinOff')) }),
              h('span', null, t('pinLabel'))),
            pin.enabled ? h('span', { className: 'dshaSr_meta' }, format(t('pinOwned'), { n: pin.owned })) : null));
      }

      /** 开发者模式开关（全局、限时，只由用户操作）。 */
      function DevSection({ t, dev, busy, act }) {
        const id = React.useId();
        const [hours, setHours] = React.useState(String(dev.defaultHours ?? 2));
        const until = dev.until ? new Date(dev.until).toLocaleString() : '';
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('devTitle')),
          h('p', { className: 'dshaSr_hint' }, t('devHint')),
          h('div', { className: 'dshaSr_card' },
            dev.enabled
              ? h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_status', 'data-tone': 'error', role: 'status', style: { flex: '1 1 16em' } }, format(t('devActive'), { time: until })),
                h(Button, { disabled: busy, onClick: () => act({ action: 'dev-mode', enabled: false }, t('devOffDone')) }, t('devDisable')))
              : h('div', { className: 'dshaSr_row' },
                h('label', { htmlFor: id + '-hours', className: 'dshaSr_meta' }, t('devHours')),
                h('input', { id: id + '-hours', className: 'dshaSr_input', type: 'number', min: '0.25', max: String(dev.maxHours ?? 24), step: '0.25', value: hours, style: { width: '6em' }, onChange: (event) => setHours(event.target.value) }),
                h('span', { className: 'dshaSr_spacer' }),
                h(Button, { variant: 'primary', disabled: busy || !(Number(hours) > 0 && Number(hours) <= (dev.maxHours ?? 24)), onClick: () => act({ action: 'dev-mode', enabled: true, hours: Number(hours) }, t('devOn')) }, t('devEnable')))));
      }

      function ghBad(gh) { return gh.match === 'mismatch' || (gh.match === 'missing' && !!gh.pinned); }
      function ghSummary(t, gh) {
        return ghBad(gh) ? t('ghSumBad') : gh.state === 'ready' ? format(gh.match === 'ok' ? t('ghSumOk') : t('ghSumReady'), { login: gh.login }) : t('ghSumOut');
      }
      /** 折叠的 GitHub 区块：不一致或登录进行中时默认展开。 */
      function GitHubFold({ t, gh, name, children }) {
        return h(Fold, { name, title: t('ghTitle'), tone: ghBad(gh) ? 'error' : undefined, defaultOpen: ghBad(gh) || gh.loginFlow?.state === 'pending', summary: ghSummary(t, gh) }, children);
      }

      /** GitHub 账号（共用的 gh 登录）：状态、登录验证码、锁定。只由用户操作。 */
      function GitHubSection({ t, gh, busy, act, copy, folded = true }) {
        const id = React.useId();
        const flow = gh.loginFlow;
        const pending = flow && flow.state === 'pending';
        const bad = gh.match === 'mismatch' || (gh.match === 'missing' && gh.pinned);
        const stateLine = gh.state === 'ready' ? format(t('ghReady'), { login: gh.login, id: gh.accountId })
          : gh.state === 'missing' ? t('ghMissing') : gh.state === 'unavailable' ? t('ghUnavailable')
          : gh.state === 'error' ? format(t('ghError'), { v: gh.error ?? '' }) : t('ghNone');
        const pinLine = gh.match === 'ok' ? format(t('ghPinnedOk'), { login: gh.pinned.login })
          : gh.match === 'mismatch' ? format(t('ghPinnedBad'), { login: gh.login, pinned: gh.pinned.login })
          : gh.pinned && gh.match === 'missing' ? format(t('ghPinnedGone'), { pinned: gh.pinned.login })
          : gh.state === 'ready' && !gh.pinned ? t('ghUnpinnedNote') : '';
        const flowLine = !flow || pending ? '' : flow.state === 'done' ? t('ghFlowDone') : flow.state === 'expired' ? t('ghFlowExpired')
          : flow.state === 'failed' ? format(t('ghFlowFailed'), { v: flow.error ?? '' }) : flow.state === 'cancelled' ? t('ghCancelled') : '';
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          folded ? null : h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('ghTitle')),
          h('p', { className: 'dshaSr_hint' }, t('ghHint')),
          h('div', { className: 'dshaSr_card' },
            h('span', { className: 'dshaSr_status', 'data-tone': gh.state === 'ready' ? undefined : 'error', role: 'status' }, stateLine),
            gh.source ? h('span', { className: 'dshaSr_meta' }, [gh.source === 'shell' ? t('ghSourceShell') : t('ghSourceGh'), gh.scopes.length > 0 ? format(t('ghScopes'), { v: gh.scopes.join(', ') }) : ''].filter(Boolean).join(' · ')) : null,
            pinLine ? h('span', { className: bad ? 'dshaSr_status' : 'dshaSr_meta', 'data-tone': bad ? 'error' : undefined, role: bad ? 'alert' : undefined }, pinLine) : null,
            pending && flow.userCode ? h('div', { className: 'dshaSr_card', 'aria-live': 'polite' },
              h('span', { className: 'dshaSr_meta' }, t('ghCode')),
              h('div', { className: 'dshaSr_row' },
                h('code', { className: 'dshaSr_code', style: { fontSize: '20px', fontWeight: 600, letterSpacing: '0.12em' } }, flow.userCode),
                h(Button, { onClick: () => { void copy(flow.userCode); } }, t('ghCopyCode'))),
              flow.opened ? h('span', { className: 'dshaSr_meta' }, t('ghCodeOpened')) : null,
              flow.verificationUri ? h('span', { className: 'dshaSr_meta' }, t('ghCodeOpen'), h('a', { href: flow.verificationUri, target: '_blank', rel: 'noopener noreferrer', className: 'dshaSr_a' }, flow.verificationUri)) : null) : null,
            flowLine ? h('span', { className: flow.state === 'done' ? 'dshaSr_meta' : 'dshaSr_status', 'data-tone': flow.state === 'done' ? undefined : 'error' }, flowLine) : null,
            h('div', { className: 'dshaSr_row' },
              h(Button, { disabled: busy, onClick: () => act({ action: 'github-refresh' }) }, t('ghRefresh')),
              h('span', { className: 'dshaSr_spacer' }),
              pending ? h(Button, { disabled: busy, onClick: () => act({ action: 'github-login-cancel' }, t('ghCancelled')) }, t('ghCancel'))
                : gh.state !== 'ready' && gh.state !== 'unavailable' ? h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'github-login' }) }, t('ghLogin')) : null,
              gh.state === 'ready' && gh.match !== 'ok' ? h(Button, { variant: gh.match === 'mismatch' ? undefined : 'primary', disabled: busy, onClick: () => act({ action: 'github-pin' }, t('ghPinDone')) }, gh.match === 'mismatch' ? t('ghRepin') : t('ghPin')) : null,
              gh.pinned ? h(Button, { disabled: busy, onClick: () => act({ action: 'github-unpin' }, t('ghUnpinDone')) }, t('ghUnpin')) : null)));
      }

      /** 拉起认领会话：选任务（默认最高优先）与别名，首条消息由插件生成。 */
      function ClaimSection({ t, board, busy, act, openSession, flash, scope }) {
        const id = React.useId();
        const tb = board.taskBoard;
        const [task, setTask] = React.useState('');
        const [alias, setAlias] = React.useState('');
        const [model, setModel] = React.useState('follow');
        React.useEffect(() => { if (task !== '' && !tb.open.some((row) => row.id === task)) setTask(''); }, [tb.open.map((row) => row.id).join(',')]);
        const go = () => act({ action: 'claim', task: task || undefined, alias: alias || undefined, ...modelField(model) }, undefined).then((payload) => {
          const result = payload?.result;
          if (!result?.sessionId) return;
          setAlias(''); setModel('follow');
          flash(format(t('claimDone'), { label: result.alias ? '@' + result.alias : shortId(result.sessionId) }) + (result.task ? ' ' + result.task : '') + modelFlash(t, result), result.modelError ? 'error' : 'ok');
          openSession(result.sessionId);
        });
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('claimTitle')),
          h('p', { className: 'dshaSr_hint' }, t('claimHint')),
          h('div', { className: 'dshaSr_card' },
            h('span', { className: 'dshaSr_meta' }, format(t('claimBoard'), { file: tb.file })),
            tb.open.length === 0 ? h('span', { className: 'dshaSr_meta' }, t('claimNone')) : h(React.Fragment, null,
              h('label', { className: 'dshaSr_label', htmlFor: id + '-task' }, t('claimTask')),
              h('select', { id: id + '-task', className: 'dshaSr_input', value: task, onChange: (event) => setTask(event.target.value) },
                h('option', { value: '' }, t('claimAny')),
                ...tb.open.map((row) => h('option', { key: row.id, value: row.id }, `${row.id}${row.priority ? ' ' + row.priority : ''} · ${row.title}`))),
              h('label', { className: 'dshaSr_label', htmlFor: id + '-alias' }, t('alias')),
              h('input', { id: id + '-alias', className: 'dshaSr_input', value: alias, maxLength: 32, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: task ? task.toLowerCase() : 't31', onChange: (event) => setAlias(event.target.value) }),
              h(ModelPicker, { t, scope, value: model, onChange: setModel, followLabel: board.roleModels?.worker || undefined, disabled: busy }),
              h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_spacer' }),
                h(Button, { variant: 'primary', disabled: busy, onClick: go }, t('claimGo'))))));
      }

      /** 工作树声明（只读）：计数一行，明细可展开。 */
      function DeclSection({ t, decl }) {
        const id = React.useId();
        const [open, setOpen] = React.useState(false);
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('declTitle')),
          h('p', { className: 'dshaSr_hint' }, t('declHint')),
          h('div', { className: 'dshaSr_card' },
            h('span', { className: decl.mismatches > 0 ? 'dshaSr_status' : 'dshaSr_meta', 'data-tone': decl.mismatches > 0 ? 'error' : undefined },
              format(t('declCounts'), { active: decl.active, mismatches: decl.mismatches, candidates: decl.candidates.length, pending: decl.pending.length, merged: decl.mergedActive.length, orphans: decl.orphans.length, undeclared: decl.undeclared.length })),
            decl.main ? h('span', { className: 'dshaSr_meta' }, format(t('declMain'), { sha: decl.main.short, build: decl.main.build ?? '?', subject: decl.main.subject })) : null,
            decl.main ? h('span', { className: 'dshaSr_meta' }, decl.main.released ? format(t('declReleased'), { build: decl.main.released.build, tag: decl.main.released.tag, gap: releaseGap(t, decl.main) }) : t('declReleasedNone')) : null,
            h('span', { className: 'dshaSr_meta' }, format(t('declExtra'), { landed: (decl.landed ?? []).length, overlaps: (decl.overlaps ?? []).length, bg: decl.backgroundAttention ?? 0 })),
            h('div', { className: 'dshaSr_row' },
              h('span', { className: 'dshaSr_spacer' }),
              h(Button, { 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(!open) }, open ? t('declHide') : t('declShow'))),
            open ? h('pre', { className: 'dshaSr_pre' }, decl.text) : null));
      }

      /** 侧栏登记在本工作区、但没加入看板的会话：紧凑列表，可打开或一键加入。 */
      function OthersSection({ t, board, busy, act, openSession, copy, selfId }) {
        const id = React.useId();
        return h('section', { className: 'dshaSr_sec', 'aria-labelledby': id + '-h' },
          h('h3', { id: id + '-h', className: 'dshaSr_h' }, t('othersTitle')),
          h('p', { className: 'dshaSr_hint' }, t('othersHint')),
          h('div', { className: 'dshaSr_card' },
            ...board.others.map((item) => h('div', { key: item.sessionId, className: 'dshaSr_row', 'data-self': item.sessionId === selfId ? 'true' : undefined },
              h('button', { type: 'button', className: 'dshaSr_chip', title: item.sessionId, onClick: () => copy(item.sessionId, t('idCopied')), 'aria-label': `${t('copyId')} ${item.sessionId}` }, shortId(item.sessionId)),
              h('span', { style: { flex: '1 1 8em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: item.title }, item.title),
              h('span', { className: 'dshaSr_meta' }, [stateText(t, item.state), item.model ? format(t('modelIs'), { v: item.model }) : '', item.optOut ? t('optedOut') : '', formatTime(item.updatedAt)].filter(Boolean).join(' · ')),
              item.sessionId === selfId ? h('span', { className: 'dshaSr_badge' }, t('thisSession')) : h(Button, { disabled: busy, onClick: () => openSession(item.sessionId) }, t('openSession')),
              h(Button, { disabled: busy, onClick: () => act({ action: 'join', target: item.sessionId }, t('saved')) }, t('joinThis'))
            )),
            board.othersTotal > board.others.length ? h('span', { className: 'dshaSr_meta' }, format(t('othersMore'), { n: board.othersTotal - board.others.length })) : null
          )
        );
      }

      /** 会话标签页顶部：本会话的完整 id、别名、协作身份；未加入时可一键加入。 */
      function SelfCard({ t, self, busy, act, copy }) {
        const names = [...(self.isMain ? ['@main'] : []), ...self.aliases.map((name) => '@' + name)];
        return h('div', { className: 'dshaSr_card', 'data-self': 'true' },
          h('div', { className: 'dshaSr_entryHead' },
            self.isMain ? h(StarIcon, { size: 14 }) : h('span', { className: 'dshaSr_dot', 'data-status': self.entry?.status ?? (self.participant ? 'joined' : undefined), 'aria-hidden': true }),
            h('span', { className: 'dshaSr_entryName' }, t('selfTitle')),
            names.length > 0 ? h('span', { className: 'dshaSr_meta' }, names.join(' ')) : null,
            self.entry?.status ? h('span', { className: 'dshaSr_badge', 'data-status': self.entry.status }, statusText(t, self.entry.status)) : self.isMain ? h('span', { className: 'dshaSr_badge', 'data-status': 'main' }, statusText(t, 'main')) : null,
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { onClick: () => copy(self.sessionId, t('idCopied')) }, t('copyId'))
          ),
          // 窄屏只显示前 8 位（点「复制 ID」拿完整的），宽屏显示完整 id
          h('span', { className: 'dshaSr_idline', title: self.sessionId }, h('span', { className: 'dshaSr_idFull' }, self.sessionId), h('span', { className: 'dshaSr_idShort' }, shortId(self.sessionId))),
          self.model ? h('span', { className: 'dshaSr_meta' }, format(t('modelIs'), { v: self.model })) : null,
          self.entry?.summary ? h('span', null, self.entry.summary) : null,
          self.mainElsewhere ? h('span', { className: 'dshaSr_hint' }, t('selfMainElsewhere')) : null,
          !self.participant ? h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_hint' }, self.seesLine ? t('selfObserver') : t('selfNotJoined')),
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'join', target: self.sessionId }, t('saved')) }, t('joinSelf'))) : null
        );
      }

      function Chevron() {
        return h('svg', { className: 'dshaSr_chev', width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M9 6l6 6-6 6' }));
      }

      /** 折叠状态按分区记在本机（localStorage），刷新后保持；不可用时只在内存里。 */
      const FOLD_KEY = 'dshaSr.fold.v1';
      function readFolds() {
        try { const value = JSON.parse(window.localStorage.getItem(FOLD_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
      }
      function writeFold(name, open) {
        try { const value = readFolds(); value[name] = open; window.localStorage.setItem(FOLD_KEY, JSON.stringify(value)); } catch {}
      }

      /**
       * 折叠分区的初始展开状态。
       * forceOpen：分组里只有一两条时直接展开（折叠态是按分区名记在本机的，会跨工作区继承，
       * 结果新工作区明明有卡片却什么都看不见）。其余情况优先用用户记下的状态。
       */
      function foldStartsOpen({ forceOpen = false, saved, defaultOpen = false } = {}) {
        if (forceOpen) return true
        return typeof saved === 'boolean' ? saved : defaultOpen
      }

      /** 可折叠分区：标题行是一个按钮（aria-expanded），收起时显示一行摘要。 */
      function Fold({ name, title, summary, tone, defaultOpen = false, forceOpen = false, onOpen, actions, children }) {
        const id = React.useId();
        // forceOpen：分组里只有一两条时直接展开（2026-11-06 实拍：新工作区继承了上次的「收起」，卡片全看不见）
        const [open, setOpen] = React.useState(() => foldStartsOpen({ forceOpen, saved: readFolds()[name], defaultOpen }));
        React.useEffect(() => { if (open && onOpen) onOpen(); }, [open]);
        const toggle = () => { const next = !open; setOpen(next); writeFold(name, next); };
        return h('section', { className: 'dshaSr_fold', 'data-open': open ? 'true' : 'false', 'aria-labelledby': id + '-t' },
          h('div', { className: 'dshaSr_foldHead' },
            h('h3', { className: 'dshaSr_foldTitle' },
              h('button', { type: 'button', id: id + '-t', className: 'dshaSr_foldBtn', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id + '-b', onClick: toggle },
                h(Chevron),
                h('span', { className: 'dshaSr_foldName' }, title),
                !open && summary ? h('span', { className: 'dshaSr_foldSum', 'data-tone': tone }, summary) : null)),
            open && actions ? h('div', { className: 'dshaSr_foldActs' }, actions) : null),
          open ? h('div', { id: id + '-b', className: 'dshaSr_foldBody' }, children) : null);
      }

      /**
       * 任务看板状态（只在展开时读取，结果是纯文本报告，约 2KB）与归档：先预览拿 planId，再确认执行。
       */
      function TasksSection({ t, sessionId, flash }) {
        const [report, setReport] = React.useState(undefined);
        const [plan, setPlan] = React.useState(undefined);
        const [working, setWorking] = React.useState(false);
        const run = React.useCallback(async (body) => {
          setWorking(true);
          try {
            const payload = await request('POST', { action: 'tasks', ...(sessionId ? { fromSession: sessionId } : {}), ...body });
            return payload.result;
          } catch (error) {
            flash(errorText(t, error), 'error');
            return undefined;
          } finally { setWorking(false); }
        }, [t, flash, sessionId]);
        const refresh = React.useCallback(() => run({}).then((result) => { if (result) setReport(result.text); }), [run]);
        const preview = () => run({ archive: 'preview' }).then((result) => { if (result) setPlan({ text: result.text, planId: result.planId }); });
        const apply = () => run({ archive: 'apply', planId: plan.planId }).then((result) => {
          if (!result) return;
          setPlan(undefined);
          flash(result.text.split('\n')[0], 'ok', true);
          void refresh();
        });
        return h(Fold, {
          name: 'tasks', title: t('tasksTitle'), summary: t('tasksSummary'), onOpen: () => { if (report === undefined) void refresh(); },
          actions: h(Button, { disabled: working, onClick: refresh }, t('tasksRefresh'))
        },
          h('p', { className: 'dshaSr_hint' }, t('tasksHint')),
          report === undefined ? h(Status, { text: working ? t('loading') : '' }) : h('pre', { className: 'dshaSr_pre dshaSr_clamp', style: { maxHeight: '22em' } }, report),
          h('div', { className: 'dshaSr_more' },
            h(Button, { disabled: working, onClick: preview }, t('tasksArchivePreview')),
            plan?.planId ? h(Button, { variant: 'primary', disabled: working, onClick: apply }, t('tasksArchiveApply')) : null,
            plan ? h(Button, { disabled: working, onClick: () => setPlan(undefined) }, t('cancel')) : null),
          plan ? h('pre', { className: 'dshaSr_pre', style: { maxHeight: '16em' } }, plan.text) : null);
      }

      const SEARCH_KIND_OPTIONS = ['prompt', 'output', 'call', 'result', 'error'];

      /**
       * 搜索页：「找会话」按 id / 别名 / 标题找会话并就地处理（会话上百个时代替翻列表）；
       * 「搜内容」查对话原文。两种模式共用工作区范围，模式记在本机。
       */
      const SEARCH_MODE_KEY = 'dshaSr.searchMode.v1';
      function SearchSection(props) {
        const { t } = props;
        const [mode, setModeState] = React.useState(() => { try { return window.localStorage.getItem(SEARCH_MODE_KEY) === 'content' ? 'content' : 'session'; } catch { return 'session'; } });
        const setMode = (next) => { setModeState(next); try { window.localStorage.setItem(SEARCH_MODE_KEY, next); } catch {} };
        return h(React.Fragment, null,
          h('div', { className: 'dshaSr_seg dshaSr_modeSeg', role: 'group', 'aria-label': t('pageSearch') },
            h('button', { type: 'button', 'aria-pressed': mode === 'session' ? 'true' : 'false', onClick: () => setMode('session') }, t('findMode')),
            h('button', { type: 'button', 'aria-pressed': mode === 'content' ? 'true' : 'false', onClick: () => setMode('content') }, t('contentMode'))),
          mode === 'session' ? h(SessionFind, props) : h(ContentSearch, props));
      }

      function SessionFind({ t, sessionId, workspace, scope, onScopeChange, openSession, busy, act, copy, flash }) {
        const [query, setQuery] = React.useState('');
        const [found, setFound] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [working, setWorking] = React.useState(false);
        const [mainOnly, setMainOnly] = React.useState(false);
        const serial = React.useRef(0);
        const lastQuery = React.useRef(undefined);
        React.useEffect(() => () => { serial.current++; }, []);
        const run = async (event, text = query.trim(), onlyMain = mainOnly) => {
          event?.preventDefault?.();
          if (text === '' && !onlyMain) return;
          const mine = ++serial.current;
          lastQuery.current = { text, onlyMain };
          setWorking(true); setError(undefined);
          try {
            const payload = await request('GET', undefined, { view: 'find', q: text, scope, ...(onlyMain ? { main: 1 } : {}), ...(sessionId ? { session: sessionId } : {}), ...(scope === 'workspace' && workspace?.id ? { workspace: workspace.id } : {}) });
            if (mine === serial.current) setFound(payload.find ?? null);
          } catch (cause) {
            if (mine === serial.current) setError(errorText(t, cause));
          } finally {
            if (mine === serial.current) setWorking(false);
          }
        };
        // 卡片上的操作（唤醒、移出看板、设主会话…）做完后按同一关键词刷新结果
        const actAndRefresh = React.useCallback(async (body, okText) => {
          const payload = await act(body, okText);
          if (payload && lastQuery.current) void run(undefined, lastQuery.current.text, lastQuery.current.onlyMain);
          return payload;
        }, [act, scope, sessionId, workspace?.id]);
        React.useEffect(() => { if (lastQuery.current) void run(undefined, lastQuery.current.text, lastQuery.current.onlyMain); }, [scope]);
        const results = found?.results ?? [];
        return h('section', { className: 'dshaSr_sec', 'aria-label': t('findMode') },
          h('div', { className: 'dshaSr_row' }, h('h3', { className: 'dshaSr_h' }, t('findTitle')),
            h('span', { className: 'dshaSr_spacer' }),
            h('div', { className: 'dshaSr_seg', role: 'group', 'aria-label': t('findTitle') },
              h('button', { type: 'button', 'aria-pressed': scope === 'workspace' ? 'true' : 'false', onClick: () => { if (scope !== 'workspace') onScopeChange('workspace'); } }, t('scopeWorkspace')),
              h('button', { type: 'button', 'aria-pressed': scope === 'all' ? 'true' : 'false', onClick: () => { if (scope !== 'all') onScopeChange('all'); } }, t('scopeAll')))),
          h('p', { className: 'dshaSr_hint' }, t('findHint')),
          h('form', { className: 'dshaSr_findForm', onSubmit: run },
            h('input', { className: 'dshaSr_input', type: 'search', value: query, maxLength: 120, autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, placeholder: t('findPlaceholder'), 'aria-label': t('findPlaceholder'), onChange: (event) => setQuery(event.target.value) }),
            h(Button, { variant: 'primary', disabled: working || (query.trim() === '' && !mainOnly), onClick: run }, working ? t('searchLoading') : t('searchSubmit'))),
          // 勾选后立刻按当前关键词（可为空）列主会话
          h('div', { className: 'dshaSr_searchOptions' },
            h('label', null, h('input', { type: 'checkbox', checked: mainOnly, onChange: (event) => { const next = event.target.checked; setMainOnly(next); if (next || query.trim() !== '') void run(undefined, query.trim(), next); else { setFound(undefined); lastQuery.current = undefined; } } }), t('findMainOnly'))),
          error ? h(Status, { text: error, tone: 'error' }) : null,
          found ? h('span', { className: 'dshaSr_meta', role: 'status' }, results.length === 0 ? t('findEmpty') : format(t('findCount'), { n: found.total, shown: results.length })) : null,
          results.length > 0 ? h('div', { className: 'dshaSr_entries' },
            ...results.map((item) => item.kind === 'board'
              ? h(EntryCard, { key: item.entry.sessionId, t, entry: item.entry, busy, act: actAndRefresh, openSession, copy, selfId: sessionId, flash, candidates: found.candidates ?? [] })
              : h('div', { key: item.session.sessionId, className: 'dshaSr_card dshaSr_findRow', 'data-self': item.session.sessionId === sessionId ? 'true' : undefined },
                h('div', { className: 'dshaSr_entryHead' },
                  item.session.isMain ? h(StarIcon, { size: 14 }) : null,
                  h('button', { type: 'button', className: 'dshaSr_chip', title: item.session.sessionId, onClick: () => copy(item.session.sessionId, t('idCopied')), 'aria-label': `${t('copyId')} ${item.session.sessionId}` }, shortId(item.session.sessionId)),
                  h('span', { className: 'dshaSr_entryName dshaSr_clamp', title: item.session.title }, item.session.title),
                  item.session.aliases?.length > 0 ? h('span', { className: 'dshaSr_meta' }, item.session.aliases.map((name) => '@' + name).join(' ')) : null),
                h('span', { className: 'dshaSr_meta' }, [stateText(t, item.session.state), t('findNotJoined'), item.session.optOut ? t('optedOut') : '', item.session.workspace && scope === 'all' ? format(t('inWorkspace'), { v: item.session.workspace }) : '', formatTime(item.session.updatedAt)].filter(Boolean).join(' · ')),
                h('div', { className: 'dshaSr_row' },
                  h('span', { className: 'dshaSr_spacer' }),
                  item.session.sessionId === sessionId ? h('span', { className: 'dshaSr_badge' }, t('thisSession')) : h(Button, { disabled: busy, onClick: () => openSession(item.session.sessionId) }, t('openSession')),
                  item.session.isMain ? null : h(Button, { disabled: busy, onClick: () => actAndRefresh({ action: 'join', target: item.session.sessionId }, t('saved')) }, t('joinThis')))))) : null);
      }

      function ContentSearch({ t, sessionId, workspace, scope, onScopeChange, openSession }) {
        const [query, setQuery] = React.useState('');
        const [regex, setRegex] = React.useState(false);
        const [caseSensitive, setCaseSensitive] = React.useState(false);
        const [allKinds, setAllKinds] = React.useState(false);
        const [tool, setTool] = React.useState('');
        const [turn, setTurn] = React.useState('');
        const [search, setSearch] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [working, setWorking] = React.useState(false);
        const serial = React.useRef(0);
        const controllerRef = React.useRef(undefined);
        React.useEffect(() => () => { serial.current++; controllerRef.current?.abort?.(); }, []);
        const run = async (event) => {
          event?.preventDefault?.();
          const text = query.trim();
          if (text === '') return;
          const parsedTurn = turn.trim() === '' ? undefined : Number(turn);
          if (parsedTurn !== undefined && (!Number.isSafeInteger(parsedTurn) || parsedTurn < 0)) {
            setError(t('searchTurnInvalid'));
            return;
          }
          const mine = ++serial.current;
          controllerRef.current?.abort?.();
          const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          controllerRef.current = controller;
          setWorking(true);
          setError(undefined);
          try {
            const payload = await request('GET', undefined, {
              view: 'search', q: text, scope,
              ...(scope === 'workspace' && workspace?.id ? { workspace: workspace.id } : {}),
              ...(sessionId ? { fromSession: sessionId } : {}),
              ...(regex ? { regex: true } : {}), ...(caseSensitive ? { caseSensitive: true } : {}),
              kinds: allKinds ? 'all' : SEARCH_KIND_OPTIONS.join(','),
              ...(tool.trim() ? { tool: tool.trim() } : {}), ...(parsedTurn === undefined ? {} : { turn: parsedTurn }),
              maxSessions: 25, maxHits: 40
            }, controller?.signal);
            if (mine === serial.current) setSearch(payload.search ?? null);
          } catch (cause) {
            if (mine === serial.current && cause?.name !== 'AbortError') setError(errorText(t, cause));
          } finally {
            if (mine === serial.current) setWorking(false);
          }
        };
        const groups = search?.groups ?? [];
        const skipped = search?.skipped > 0 ? format(t('searchSkipped'), { n: search.skipped }) : '';
        return h('section', { className: 'dshaSr_sec', 'aria-label': t('searchTitle') },
          h('div', { className: 'dshaSr_row' }, h('h3', { className: 'dshaSr_h' }, t('searchTitle')),
            h('span', { className: 'dshaSr_spacer' }),
            h('div', { className: 'dshaSr_seg', role: 'group', 'aria-label': t('searchTitle') },
              h('button', { type: 'button', 'aria-pressed': scope === 'workspace' ? 'true' : 'false', onClick: () => { setSearch(undefined); setError(undefined); if (scope !== 'workspace') onScopeChange('workspace'); } }, t('scopeWorkspace')),
              h('button', { type: 'button', 'aria-pressed': scope === 'all' ? 'true' : 'false', onClick: () => { setSearch(undefined); setError(undefined); if (scope !== 'all') onScopeChange('all'); } }, t('scopeAll')))),
          h('p', { className: 'dshaSr_hint' }, t('searchHint')),
          h('form', { className: 'dshaSr_searchForm', onSubmit: run },
            h('input', { className: 'dshaSr_input', value: query, maxLength: 300, placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'), onChange: (event) => setQuery(event.target.value) }),
            h('div', { className: 'dshaSr_searchControls' },
              h('input', { className: 'dshaSr_input', value: tool, placeholder: t('searchTool'), 'aria-label': t('searchTool'), onChange: (event) => setTool(event.target.value) }),
              h('input', { className: 'dshaSr_input', type: 'number', min: 0, step: 1, value: turn, placeholder: t('searchTurn'), 'aria-label': t('searchTurn'), onChange: (event) => setTurn(event.target.value) }),
              h('div', { className: 'dshaSr_row' },
                h(Button, { variant: 'primary', disabled: working || query.trim() === '', onClick: run }, working ? t('searchLoading') : t('searchSubmit')),
                h(Button, { disabled: working || search === undefined, onClick: () => { ++serial.current; controllerRef.current?.abort?.(); setSearch(undefined); setError(undefined); setWorking(false); } }, t('searchClear')))),
            h('div', { className: 'dshaSr_searchOptions' },
              h('label', null, h('input', { type: 'checkbox', checked: regex, onChange: (event) => setRegex(event.target.checked) }), t('searchRegex')),
              h('label', null, h('input', { type: 'checkbox', checked: caseSensitive, onChange: (event) => setCaseSensitive(event.target.checked) }), t('searchCase')),
              h('label', null, h('input', { type: 'checkbox', checked: allKinds, onChange: (event) => setAllKinds(event.target.checked) }), t(allKinds ? 'searchKindAll' : 'searchKindDefault')))),
          error ? h(Status, { text: error, tone: 'error' }) : null,
          working ? h(Status, { text: t('searchLoading') }) : null,
          search ? h('div', { className: 'dshaSr_sec' },
            h('span', { className: 'dshaSr_meta' }, format(t('searchStats'), { scanned: search.scanned, hits: search.total, skipped })),
            search.total === 0 && !groups.some((group) => group.error) ? h('span', { className: 'dshaSr_meta' }, t('searchNoResults')) : null,
            ...groups.map((group) => h('div', { key: group.sessionId, className: 'dshaSr_searchGroup' },
              h('div', { className: 'dshaSr_row' },
                h('strong', { className: 'dshaSr_entryName' }, group.title || group.label || shortId(group.sessionId)),
                group.workspace && scope === 'all' ? h('span', { className: 'dshaSr_meta' }, format(t('inWorkspace'), { v: group.workspace })) : null,
                h('span', { className: 'dshaSr_spacer' }),
                h(Button, { onClick: () => openSession(group.sessionId) }, t('searchOpen'))),
              group.error ? h('span', { className: 'dshaSr_status', 'data-tone': 'error' }, format(t('searchReadError'), { v: group.errorCode ?? group.error })) : null,
              ...group.hits.map((hit, index) => h('div', { key: `${hit.seq}-${index}`, className: 'dshaSr_searchHit' },
                h('span', { className: 'dshaSr_meta' }, `seq ${hit.seq} · ${t('searchTurn')} ${hit.turn} · ${hit.kind}/${hit.label}`),
                h('span', { className: 'dshaSr_searchHitText' }, hit.snippet)))))) : null
        );
      }

      /* ---------------------------------------------------------------- 用户不在时 / 初始化（概览页） */

      function formatTokens(value) {
        const n = Number(value) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return Math.round(n / 1000) + 'k';
        return String(n);
      }

      /** 主会话用 peer_ask_user 提的问题：每个选项一个按钮，外加「忽略」。点选以用户身份发给主会话。 */
      function AskSection({ t, asks, busy, act, extra }) {
        return h('div', { className: 'dshaSr_card', role: 'region', 'aria-label': t('askTitle') },
          h('div', { className: 'dshaSr_entryHead' },
            h('span', { className: 'dshaSr_entryName' }, t('askTitle') + '（' + asks.length + '）')),
          ...asks.map((ask) => h('div', { key: ask.id, className: 'dshaSr_sec' },
            h('p', { style: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, ask.question),
            h('span', { className: 'dshaSr_meta' }, format(t('askFrom'), { label: ask.byLabel ?? '', time: formatTime(ask.at) }) + (ask.aboutLabel ? ' · ' + format(t('askAbout'), { label: ask.aboutLabel }) : '')),
            h('div', { className: 'dshaSr_row' },
              ...ask.options.map((option) => h(Button, { key: option, variant: 'primary', disabled: busy, onClick: () => act({ action: 'ask-answer', id: ask.id, option, ...extra }, t('askAnswered')) }, option)),
              h(Button, { disabled: busy, onClick: () => act({ action: 'ask-dismiss', id: ask.id, ...extra }, t('askDismissed')) }, t('askDismiss'))))));
      }

      function wakeLineText(t, info) {
        return format(t('wakeLine'), { n: info.wakesThisHour, limit: info.limit === 0 ? t('wakeUnlimited') : info.limit, tokens: formatTokens(info.approxTokensThisHour) });
      }

      /** 无人值守唤醒预算到上限：顶部横幅 +「继续」。 */
      function WakePausedBanner({ t, info, busy, act, extra }) {
        return h('div', { className: 'dshaSr_card', role: 'alert' },
          h('p', { className: 'dshaSr_status', 'data-tone': 'error', style: { margin: 0 } }, format(t('wakePaused'), { time: formatTime(info.pausedAt) })),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta', style: { flex: '1 1 12em' } }, wakeLineText(t, info)),
            h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'unattended-resume', ...extra }, t('wakeResumed')) }, t('wakeResume'))));
      }

      /** 「初始化」：只在缺东西时出现，逐项给出动作。从不执行 git init。 */
      function SetupCard({ t, board, busy, act, sessionId, extra }) {
        const setup = board.setup;
        const [lineDraft, setLineDraft] = React.useState(() => t('setupLineTemplate'));
        if (!setup) return null;
        const noRoot = !setup.root;
        const items = [];
        if (!setup.hasMain) items.push(h('div', { key: 'main', className: 'dshaSr_row' },
          h('span', { className: 'dshaSr_meta', style: { flex: '1 1 16em' } }, t('setupNoMain') + (sessionId ? '' : ' ' + t('setupMainHint'))),
          sessionId ? h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'set-main', target: sessionId }) }, t('setupSetMain')) : null));
        if (!setup.hasLine) items.push(h('div', { key: 'line' },
          h('span', { className: 'dshaSr_meta' }, t('setupNoLine')),
          h('textarea', { className: 'dshaSr_area', rows: 2, value: lineDraft, maxLength: 1500, 'aria-label': t('lineTitle'), onChange: (event) => setLineDraft(event.target.value) }),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_spacer' }),
            h(Button, { variant: 'primary', disabled: busy || lineDraft.trim() === '', onClick: () => act({ action: 'board-line', text: lineDraft, ...extra }, t('saved')) }, t('setupLineSave')))));
        if (noRoot && (!setup.hasTaskBoard || !setup.isGitRepo)) items.push(h('span', { key: 'root', className: 'dshaSr_meta' }, t('setupNoRoot')));
        else {
          if (!setup.hasTaskBoard) items.push(h('div', { key: 'board', className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta', style: { flex: '1 1 16em' } }, t('setupNoBoard')),
            h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'task-init', ...extra }, t('setupBoardCreated')) }, t('setupInitBoard'))));
          if (!setup.isGitRepo) items.push(h('span', { key: 'git', className: 'dshaSr_meta' }, t('setupNotGit')));
        }
        if (items.length === 0) return null;
        return h('div', { className: 'dshaSr_card', role: 'region', 'aria-label': t('setupTitle') },
          h('div', { className: 'dshaSr_entryHead' }, h('span', { className: 'dshaSr_entryName' }, t('setupTitle'))),
          h('p', { className: 'dshaSr_hint' }, t('setupHint')),
          setup.root ? h('span', { className: 'dshaSr_meta' }, format(t('setupRoot'), { v: setup.root })) : null,
          ...items);
      }

      /** 常设授权编辑框：未设定时预填建议文字（保存后才生效）。 */
      function DelegationSection({ t, board, busy, act, extra }) {
        const current = board.delegation?.text ?? '';
        const [draft, setDraft] = React.useState(current || board.delegationDefault || '');
        React.useEffect(() => { if (current) setDraft(current); }, [current]);
        const max = board.delegationLimit ?? 600;
        return h('div', { className: 'dshaSr_card' },
          h('p', { className: 'dshaSr_hint' }, t('delegHint')),
          h('textarea', { className: 'dshaSr_area', rows: 4, value: draft, maxLength: max, 'aria-label': t('delegTitle'), onChange: (event) => setDraft(event.target.value) }),
          h('div', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta' }, board.delegation ? format(t('delegSet'), { time: formatTime(board.delegation.setAt) }) : t('delegNone')),
            h('span', { className: 'dshaSr_spacer' }),
            h('span', { className: 'dshaSr_meta' }, format(t('chars'), { n: draft.length, max })),
            board.delegation ? h(Button, { variant: 'danger', disabled: busy, onClick: () => act({ action: 'delegate-clear', ...extra }, t('delegCleared')) }, t('clear')) : null,
            h(Button, { variant: 'primary', disabled: busy || draft.trim() === '' || draft.trim() === current, onClick: () => act({ action: 'delegate', text: draft, ...extra }, t('delegSaved')) }, t('save'))));
      }

      function BoardPage({ t, openSession, marksStore, sessionId, embedded, initialPage }) {
        const [scope, setScope] = React.useState('workspace');
        const [board, setBoard] = React.useState(undefined);
        const [searchScope, setSearchScope] = React.useState('workspace');
        const [loadError, setLoadError] = React.useState(undefined);
        const [status, flash] = useFlash();
        const [busy, setBusy] = React.useState(false);
        const [page, setPageState] = React.useState(() => (PAGES.includes(initialPage) ? initialPage : readPage(embedded)));
        const setPage = (next) => { setPageState(next); writePage(embedded, next); };
        // 侧栏面板（没有会话视角）自己选工作区，记在本机；会话里的「协作」标签按会话所在工作区，不用选
        const [pickedWs, setPickedWsState] = React.useState(() => (sessionId ? undefined : readWorkspace()));
        const setPickedWs = (next) => { setPickedWsState(next); writeWorkspace(next); };
        const serial = React.useRef(0);
        const requestRef = React.useRef(undefined);
        const load = React.useCallback((quiet) => {
          if (quiet && requestRef.current !== undefined) return;
          const mine = ++serial.current;
          requestRef.current?.abort?.();
          const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
          requestRef.current = controller;
          if (!quiet) setLoadError(undefined);
          request('GET', undefined, { view: 'board', session: sessionId, scope: sessionId ? scope : undefined, workspace: sessionId ? undefined : pickedWs }, controller?.signal).then(
            (payload) => {
              if (mine !== serial.current) return;
              // 防御：返回的不是看板数据（如旧服务端）时报错而不是渲染崩溃
              if (!Array.isArray(payload.entries)) { if (!quiet) setLoadError(t('unavailable')); return; }
              // 记住的工作区已不在列表里（删掉了）：退回服务端默认
              if (!sessionId && pickedWs && Array.isArray(payload.workspaces) && !payload.workspaces.some((item) => item.id === pickedWs)) { setPickedWs(undefined); return; }
              setBoard(payload); setLoadError(undefined);
            },
            (error) => { if (mine === serial.current && !quiet && error?.name !== 'AbortError') setLoadError(errorText(t, error)); }
          ).finally(() => {
            if (requestRef.current === controller) requestRef.current = undefined;
          });
        }, [t, sessionId, scope, pickedWs]);
        React.useEffect(() => {
          load(false);
          const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(true); }, 10000);
          return () => { clearInterval(timer); serial.current++; requestRef.current?.abort?.(); requestRef.current = undefined; };
        }, [load]);
        const act = React.useCallback(async (body, okText) => {
          const mine = ++serial.current;
          setBusy(true);
          try {
            const payload = await request('POST', { ...body, ...(sessionId ? { fromSession: sessionId, scope } : {}) });
            if (mine === serial.current && Array.isArray(payload.board?.entries)) setBoard(payload.board);
            if (body.action === 'open' && payload.result?.sessionId) flash(format(t('created'), { label: payload.result.alias ? '@' + payload.result.alias : shortId(payload.result.sessionId) }) + modelFlash(t, payload.result), payload.result.modelError ? 'error' : 'ok');
            else if (okText) flash(okText, 'ok');
            void marksStore.refresh();
            return payload;
          } catch (error) {
            flash(errorText(t, error), 'error');
            return undefined;
          } finally {
            if (mine === serial.current) setBusy(false);
          }
        }, [t, flash, marksStore, sessionId, scope]);
        const copy = React.useCallback(async (text, okText) => {
          const ok = await copyText(text);
          flash(ok ? (okText ?? format(t('copied'), { text })) : t('copyFailed'), ok ? 'ok' : 'error');
        }, [t, flash]);
        const restart = board?.restart;
        const decl = board?.declarations;
        const tb = board?.taskBoard;
        const pin = board?.autoPin;
        const archived = (board?.entries ?? []).filter((entry) => entry.category === 'archived');
        const candidates = [...(board?.entries ?? []), ...(board?.others ?? [])];
        // 模型下拉按哪个视角取目录与角色模型：会话里按会话，侧栏按选中的工作区
        const modelScope = sessionId ? { session: sessionId } : board?.groupKey ? { workspace: board.groupKey } : {};
        const card = (entry) => h(EntryCard, { key: entry.sessionId, t, entry, busy, act, openSession, copy, selfId: sessionId, flash, candidates, scope: modelScope });
        const countOf = (cat) => (board?.entries ?? []).filter((entry) => (entry.category ?? (needsAttentionEntry(entry) ? 'attention' : 'active')) === cat).length;
        const attentionHere = countOf('attention');
        const hidden = board?.hiddenAttention?.length ?? 0;
        const opsAlert = (decl?.mismatches ?? 0) > 0 || (Array.isArray(board?.watches) && board.watches.some((item) => item.state === 'failed' || item.state === 'timeout'));
        const goBoardAll = () => { setScope('all'); setPage('board'); };
        // 侧栏角标按全部工作区计数；本工作区视图里要说清楚另外几个“需要处理”在哪
        const hiddenBanner = board && hidden > 0 ? h('div', { className: 'dshaSr_row', role: 'status' },
          h('span', { className: 'dshaSr_status', 'data-tone': 'error', style: { flex: '1 1 16em' } },
            format(t('hiddenAttention'), { n: hidden }) + ' '
            + board.hiddenAttention.slice(0, 3).map((item) => `${item.label}（${statusText(t, item.status)}${item.workspace ? ' · ' + format(t('inWorkspace'), { v: item.workspace }) : ''}）${item.summary ? '：' + item.summary : ''}`).join('；')),
          h(Button, { onClick: goBoardAll }, t('hiddenAttentionShow'))) : null;
        const tabs = h('div', { className: 'dshaSr_tabs', role: 'tablist', 'aria-label': t('panel') },
          ...PAGES.map((key) => h('button', { key, type: 'button', role: 'tab', id: 'dshaSr-tab-' + key, 'aria-selected': page === key ? 'true' : 'false', 'aria-controls': 'dshaSr-page-' + key, className: 'dshaSr_tab', onClick: () => setPage(key) },
            t(PAGE_LABEL[key]),
            key === 'board' && attentionHere + hidden > 0 ? h('span', { className: 'dshaSr_tabBadge', 'aria-label': format(t('tabAttention'), { n: attentionHere + hidden }) }, String(attentionHere + hidden)) : null,
            key === 'ops' && opsAlert ? h('span', { className: 'dshaSr_tabBadge', 'data-tone': 'error', 'aria-label': t('tabOpsAlert') }, '!') : null)));
        // 没有会话视角（侧栏面板）时按看板所在的工作区操作；有会话时服务端按 fromSession 推出
        const extra = sessionId || !board?.groupKey ? {} : { workspaceId: board.groupKey };
        const asks = Array.isArray(board?.asks) ? board.asks : [];
        const wakes = board?.unattended;
        const overview = () => [
          asks.length > 0 ? h(AskSection, { key: 'asks', t, asks, busy, act, extra }) : null,
          wakes?.paused ? h(WakePausedBanner, { key: 'wake-paused', t, info: wakes, busy, act, extra }) : null,
          // 开发者模式是「模式」不是故障：用中性色提示，别用错误色占一整屏注意力
          board.devMode?.enabled ? h('div', { key: 'dev', className: 'dshaSr_row', role: 'status' },
            h('span', { className: 'dshaSr_status', style: { flex: '1 1 16em' } }, format(t('devBanner'), { time: new Date(board.devMode.until).toLocaleString() })),
            h(Button, { disabled: busy, onClick: () => act({ action: 'dev-mode', enabled: false }, t('devOffDone')) }, t('devDisable'))) : null,
          board.self ? h(SelfCard, { key: 'self', t, self: board.self, busy, act, copy }) : null,
          h('div', { key: 'main', className: 'dshaSr_card' },
            h('div', { className: 'dshaSr_entryHead' },
              h(StarIcon, { size: 14 }),
              h('span', { className: 'dshaSr_entryName' }, board.coordinator ? format(t('mainIs'), { label: board.coordinator.label }) : t('mainNone')),
              board.coordinator?.model ? h('span', { className: 'dshaSr_meta' }, format(t('modelIs'), { v: board.coordinator.model })) : null,
              h('span', { className: 'dshaSr_spacer' }),
              board.coordinator ? h('button', { type: 'button', className: 'dshaSr_chip', title: board.coordinator.sessionId, onClick: () => copy(board.coordinator.sessionId, t('idCopied')) }, shortId(board.coordinator.sessionId)) : null,
              board.coordinator?.exists ? h(Button, { onClick: () => openSession(board.coordinator.sessionId) }, t('openSession')) : null
            ),
            board.line ? h('pre', { className: 'dshaSr_pre' }, board.line.text) : h('span', { className: 'dshaSr_meta' }, t('lineEmpty'))),
          board.setup ? h(SetupCard, { key: 'setup', t, board, busy, act, sessionId, extra }) : null,
          hiddenBanner,
          h('div', { key: 'counts', className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta', style: { flex: '1 1 12em' } }, format(t('overviewCounts'), { a: attentionHere, r: countOf('ready'), w: countOf('active') })),
            h(Button, { onClick: () => setPage('board') }, t('overviewToBoard'))),
          wakes && !wakes.paused ? h('div', { key: 'wakes', className: 'dshaSr_row' }, h('span', { className: 'dshaSr_meta' }, wakeLineText(t, wakes))) : null,
          board.delegationDefault !== undefined ? h(Fold, { key: 'deleg', name: 'deleg', title: t('delegTitle'), summary: board.delegation ? t('foldDelegOn') : t('foldDelegOff') },
            h(DelegationSection, { t, board, busy, act, extra })) : null,
          h(Fold, { key: 'open', name: 'open', title: t('openTitle'), summary: t('foldOpenSum') },
            h(OpenSection, { t, board, busy, act, openSession, scope: modelScope })),
          h(Fold, { key: 'models', name: 'models', title: t('modelRolesTitle'), summary: format(t('modelRolesSum'), { main: board.roleModels?.main || t('modelFollow'), worker: board.roleModels?.worker || t('modelFollow') }) },
            h(RoleModelsSection, { t, scope: modelScope, board, busy, act, extra }))
        ];
        const boardPage = () => [h('div', { key: 'cols', className: 'dshaSr_cols' },
          h('div', { className: 'dshaSr_col' },
            h('section', { className: 'dshaSr_sec' },
              sessionId && board.workspace ? h('div', { className: 'dshaSr_row' },
                h('span', { className: 'dshaSr_meta' }, format(t('workspaceIs'), { v: board.workspace.title || board.workspace.path })),
                h('span', { className: 'dshaSr_spacer' }),
                h('div', { className: 'dshaSr_seg', role: 'group' },
                  h('button', { type: 'button', 'aria-pressed': scope === 'workspace' ? 'true' : 'false', onClick: () => setScope('workspace') }, t('scopeWorkspace')),
                  h('button', { type: 'button', 'aria-pressed': scope === 'all' ? 'true' : 'false', onClick: () => setScope('all') }, t('scopeAll')))) : null,
              hiddenBanner,
              board.entries.length === archived.length ? h('p', { className: 'dshaSr_hint' }, t('boardEmpty')) : null,
              ...CATEGORY_ORDER.filter((cat) => cat !== 'archived').map((cat) => {
                const list = board.entries.filter((entry) => (entry.category ?? 'active') === cat);
                if (list.length === 0) return null;
                // 需要处理 / 可合并 / 进行中 默认展开，久未活动 / 空白 默认收起；展开状态记在本机。
                // 一两条时无条件展开：折叠起来反而看不到内容，也没省下滚动的力气（久未活动 / 空白仍默认收起）。
                return h(Fold, { key: 'cat-' + cat, name: 'cat-' + cat, title: t(CATEGORY_KEY[cat]), tone: cat === 'attention' ? 'error' : undefined, summary: format(t('foldCatSum'), { n: list.length }), defaultOpen: cat === 'attention' || cat === 'ready' || cat === 'active', forceOpen: list.length <= 2 && cat !== 'idle' && cat !== 'blank' },
                  h('div', { className: 'dshaSr_entries', 'data-cat': cat }, ...list.map(card)));
              }),
              board.entries.some((entry) => entry.category) ? h('p', { className: 'dshaSr_hint' }, t('catHint')) : null,
              board.hiddenByScope > 0 ? h('button', { type: 'button', className: 'dshaSr_btn', onClick: () => setScope('all') }, format(t('scopeHidden'), { n: board.hiddenByScope })) : null)),
          h('div', { className: 'dshaSr_col' },
            archived.length > 0 ? h(Fold, { name: 'archive', title: t('archiveTitle'), summary: format(t('foldArchiveSum'), { n: archived.length }) },
              h('p', { className: 'dshaSr_hint' }, t('archiveHint')),
              h(PruneArchive, { t, archived, busy, act }),
              h('div', { className: 'dshaSr_entries' }, ...archived.map(card))) : null,
            Array.isArray(board.others) && board.others.length > 0 ? h(Fold, { name: 'others', title: t('othersTitle'), summary: format(t('foldOthersSum'), { n: board.othersTotal ?? board.others.length }) },
              h(OthersSection, { t, board, busy, act, openSession, copy, selfId: sessionId })) : null))];
        const opsPage = () => [h('div', { key: 'cols', className: 'dshaSr_cols' },
          h('div', { className: 'dshaSr_col' },
            board.handoff ? h(HandoffSection, { t, board, busy, act, openSession, flash, selfId: sessionId, scope: modelScope }) : null,
            Array.isArray(board.watches) ? h(Fold, { name: 'watch', title: t('watchTitle'), summary: format(t('foldWatchSum'), { n: board.watches.filter((item) => item.state === 'active').length }) },
              h('p', { className: 'dshaSr_hint' }, t('watchHint')),
              board.watches.length === 0 ? h('span', { className: 'dshaSr_meta' }, t('watchEmpty')) : null,
              ...board.watches.map((item) => h('div', { key: item.id, className: 'dshaSr_row' },
                h('span', { className: item.state === 'failed' || item.state === 'timeout' ? 'dshaSr_status' : 'dshaSr_meta', 'data-tone': item.state === 'failed' || item.state === 'timeout' ? 'error' : undefined, style: { flex: '1 1 16em' } }, item.line),
                item.state === 'active' ? h(Button, { disabled: busy, onClick: () => act({ action: 'watch-cancel', id: item.id }, t('watchCancelled')) }, t('watchCancel')) : null))) : null,
            decl ? h(Fold, { name: 'decl', title: t('declTitle'), tone: decl.mismatches > 0 ? 'error' : undefined, summary: format(t('foldDeclSum'), { active: decl.active, mismatches: decl.mismatches }) },
              h(DeclSection, { t, decl })) : null),
          h('div', { className: 'dshaSr_col' },
            tb ? h(TasksSection, { t, sessionId, flash }) : null,
            tb ? h(Fold, { name: 'claim', title: t('claimTitle'), summary: format(t('foldClaimSum'), { n: tb.open.length }), defaultOpen: false },
              h(ClaimSection, { t, board, busy, act, openSession, flash, scope: modelScope })) : null,
            pin ? h(Fold, { name: 'pin', title: t('pinTitle'), summary: pin.enabled ? t('pinOn') : t('pinOff') },
              h(PinSection, { t, board, busy, act })) : null,
            board.github ? h(GitHubFold, { t, gh: board.github, name: 'github' },
              h(GitHubSection, { t, gh: board.github, busy, act, copy })) : null,
            board.devMode ? h(Fold, { name: 'dev', title: t('devTitle'), summary: board.devMode.enabled ? format(t('devActive'), { time: new Date(board.devMode.until).toLocaleString() }) : t('devOff') },
              h(DevSection, { t, dev: board.devMode, busy, act })) : null,
            h(Fold, { name: 'restart', title: t('restartTitle'), summary: restart?.phase === 'watching' ? t('foldRestartWatching') : t('foldRestartIdle') },
              h('div', { className: 'dshaSr_card' },
                h('span', null, restart?.text ?? ''),
                h('div', { className: 'dshaSr_row' },
                  h('span', { className: 'dshaSr_spacer' }),
                  restart?.phase === 'watching'
                    ? h(Button, { disabled: busy, onClick: () => act({ action: 'restart-cancel' }) }, t('restartCancel'))
                    : h(Button, { variant: 'primary', disabled: busy, onClick: () => act({ action: 'restart-watch' }) }, t('restartStart')))))))];
        const body = !board ? [] : page === 'board' ? boardPage()
          : page === 'search' ? [h(SearchSection, { key: 'search', t, sessionId, workspace: board.workspace, scope: searchScope, onScopeChange: setSearchScope, openSession, busy, act, copy, flash })]
          : page === 'ops' ? opsPage() : overview();
        return h('div', { className: 'dshaSr_page' }, h('div', { className: 'dshaSr_pageIn' },
          embedded ? null : h('h2', { className: 'dshaSr_title' }, t('panel')),
          !sessionId && board && Array.isArray(board.workspaces) && board.workspaces.length > 1 ? h('label', { className: 'dshaSr_row' },
            h('span', { className: 'dshaSr_meta' }, t('wsPick')),
            h('select', {
              className: 'dshaSr_input', style: { flex: '1 1 14em', width: 'auto' }, value: board.groupKey ?? '', disabled: busy, 'aria-label': t('wsPick'),
              onChange: (event) => { setBoard(undefined); setPickedWs(event.target.value || undefined); }
            }, ...board.workspaces.map((item) => h('option', { key: item.id, value: item.id }, (item.title || item.path || item.id) + (item.hasMain ? t('wsPickMain') : ''))))) : null,
          board ? tabs : null,
          loadError ? h(Status, { text: loadError, tone: 'error', onRetry: () => load(false), retryText: t('retry') }) : null,
          !board && !loadError ? h(Status, { text: t('loading') }) : null,
          status.text ? h('div', { className: 'dshaSr_toast' }, h(Status, { text: status.text, tone: status.tone })) : null,
          board ? h('div', { className: 'dshaSr_tabPanel', role: 'tabpanel', id: 'dshaSr-page-' + page, 'aria-labelledby': 'dshaSr-tab-' + page }, ...body) : null
        ));
      }

      /* 面板分页：概览 / 看板 / 搜索 / 交接与核验。侧栏整页与会话里的「协作」标签各记各的，存在本机。 */
      const PAGES = ['overview', 'board', 'search', 'ops'];
      const PAGE_LABEL = { overview: 'pageOverview', board: 'pageBoard', search: 'pageSearch', ops: 'pageOps' };
      const PAGE_KEY = 'dshaSr.page.v1';
      function readPage(embedded) {
        try {
          const value = JSON.parse(window.localStorage.getItem(PAGE_KEY) || '{}');
          const page = value && typeof value === 'object' ? value[embedded ? 'tab' : 'panel'] : undefined;
          return PAGES.includes(page) ? page : 'overview';
        } catch { return 'overview'; }
      }
      /* 侧栏面板选的工作区（id），存在本机；没选过返回 undefined（服务端按最近指定主会话的工作区）。 */
      const WS_KEY = 'dshaSr.workspace.v1';
      function readWorkspace() {
        try { const value = window.localStorage.getItem(WS_KEY); return value ? value : undefined; } catch { return undefined; }
      }
      function writeWorkspace(id) {
        try { if (id) window.localStorage.setItem(WS_KEY, id); else window.localStorage.removeItem(WS_KEY); } catch {}
      }
      function writePage(embedded, page) {
        try {
          const raw = JSON.parse(window.localStorage.getItem(PAGE_KEY) || '{}');
          const value = raw && typeof raw === 'object' ? raw : {};
          value[embedded ? 'tab' : 'panel'] = page;
          window.localStorage.setItem(PAGE_KEY, JSON.stringify(value));
        } catch {}
      }
      function needsAttentionEntry(entry) {
        return (entry.status === 'question' || entry.status === 'blocked') && !entry.answered;
      }

      const CATEGORY_ORDER = ['attention', 'ready', 'active', 'idle', 'blank', 'archived'];
      const CATEGORY_KEY = { attention: 'catAttention', ready: 'catReady', active: 'catActive', idle: 'catIdle', blank: 'catBlank', archived: 'archiveTitle' };


      /** “对话 / 轨迹”旁的“协作”标签：当前会话视角的完整看板。 */
      function ConversationRelayView({ sessionId, t, openSession, marksStore, initialPage }) {
        return h(BoardPage, { t, openSession, marksStore, sessionId, embedded: true, initialPage });
      }

      return { SessionRelaySettings, BoardPage, SessionFind, ConversationRelayView, foldStartsOpen };
    }
    // 与入口 PANEL_KIT 对齐
    return { make, KIT_VERSION: 1 };
  }
});
