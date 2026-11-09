window.__ModuleLoader__.load({
  id: 'dsh-session-relay',
  chunk: 'client.sidebar.mail47.js',
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


    const MAIL_KIND = { watch: 'mailKindWatch', build: 'mailKindBuild', version: 'mailKindVersion', board: 'mailKindBoard', system: 'mailKindSystem', notice: 'mailKindNotice' };
    const MAIL_RESULT = { '成功': ['mailResultOk', 'ok'], '失败': ['mailResultFail', 'error'], '超时': ['mailResultTimeout', 'warn'], '已取消': ['mailResultCancelled', undefined], '恢复': ['mailResultRecovered', 'ok'], '已恢复': ['mailResultRecovered', 'ok'] };
    /** 邮件标题（服务端拼的 label · CI · 标题 · 结果）拆成结构化字段，收起时只留一行。 */
    function parseMail(item) {
      const text = String(item?.subject ?? '').trim();
      const ci = /CI\s+(\d+)/.exec(text)?.[1];
      const repo = /@([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(text)?.[1];
      const title = /「([^」]+)」/.exec(text)?.[1];
      const result = /(成功|失败|超时|已取消|已恢复|恢复)/.exec(text)?.[1];
      const sha = /sha[\s=：:]+([0-9a-f]{7,40})/i.exec(text)?.[1];
      const label = ci === undefined ? text : text.split(' · CI ')[0].trim();
      return { label: label === '' ? text : label, ci, repo, title, result, sha };
    }

    function MailBox({ kit, sessionId, isMain = true }) {
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
          const mail = parseMail(item);
          const result = mail.result === undefined ? undefined : MAIL_RESULT[mail.result];
          return h('details', { key: item.id, className: 'dshaSv_mail' },
            h('summary', { className: 'dshaSv_row' },
              h('span', { className: 'dshaSv_pill', 'data-tone': read ? undefined : 'warn' }, read ? t('mailRead') : t('mailUnread')),
              h('span', { className: 'dshaSv_mailTitle dshaSv_grow', title: item.subject }, mail.label),
              result ? h('span', { className: 'dshaSv_pill', 'data-tone': result[1] }, t(result[0])) : null,
              h('span', { className: 'dshaSv_muted' }, kit.formatTime(item.at))),
            h('div', { className: 'dshaSv_bar' },
              h('span', { className: 'dshaSv_pill' }, t(MAIL_KIND[item.kind] ?? 'mailKindSystem')),
              mail.repo ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: mail.repo }, mail.repo) : null,
              mail.ci ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: 'CI #' + mail.ci }, 'CI #' + mail.ci) : null,
              mail.sha ? h('span', { className: 'dshaSv_metaChip', 'data-mono': true, title: mail.sha }, mail.sha.slice(0, 7)) : null,
              mail.title ? h('span', { className: 'dshaSv_metaChip', title: mail.title }, mail.title) : null),
            h('p', { className: 'dshaSv_muted' }, item.body || t('mailNoBody')),
            h('div', { className: 'dshaSv_taskActs' },
              !read ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => mark([item.id]) }, t('mailMarkRead')) : null,
              // 归档只允许主会话（服务端 main-only 限制不变）；非主会话视图不露按钮
              isMain !== false ? h('button', { type: 'button', className: 'dshaSv_btn', disabled: busy, onClick: () => mark([item.id], 'archived') }, t('mailArchive')) : null));
        })) : null);
    }

    /** 仓库守候设置（2.2.0）：总览 / 判定 / 触发 / 设置 四个子页签。 */

    function MailTab({ kit, sessionId, isMain = true }) {
      return h(MailBox, { kit, sessionId, isMain });
    }

    /** 更多页：快捷入口 + 同步、仓库状态。 */

      return { MailTab, MailBox, parseMail };
    }

    return { KIT_VERSION: 47, make };
  }
});
