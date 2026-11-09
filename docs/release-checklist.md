# 发版清单（GitHub Release）

本仓库不发 npm，只发 GitHub Release：一个版本一个 tag、一个 `.tgz`。适用于任何版本；括号里是 2.4.5 的当前值（发版准备时）。

**硬规则**：推送 main、打 tag、发 Release、合并、安装插件、删除任何已发布内容，都必须由用户在主会话明确同意后执行；已发布的 tag / Release 永不删改，要修正就发新版本（版本号 +1）。

## 0. 前置确认

- [ ] 用户明确同意推送 main / 打 tag / 发 Release（2.4.5：用户已于 2026-11-09 在本会话明确同意推送 / tag / Release）。
- [ ] `git status` 干净；`.agents/` 是插件看板快照，已在 `.gitignore` 忽略，不提交、不打包。
- [ ] `git rev-parse HEAD` 记录发版提交（2.4.5：准备完成后的 HEAD）。
- [ ] `git ls-remote origin refs/heads/main` 仍是预期基线（2.4.5：`a93789b`，v2.4.4），确认本地领先提交数（2.4.5：T20/T22 共 2 个 + 本轮发版准备 = 3 个）。
- [ ] 工作树声明已更新（`.SESSION-DONE` 或声明文件写明发版状态）；看板核对通过（T20/T22 均已合入本地 main，声明已标 .SESSION-DONE + 待推送）。
- [ ] 本仓库没有 GitHub Actions，测试以本地串行结果为准；不要假设远端 CI。
- [ ] `package.json` 的 `version` 等于 tag（2.4.5）。
- [ ] `engines.dsh` / `peerDependencies` 范围与 README「运行环境」一致（2.4.5：`>=0.2.2-rc.1` 起，未变）。
- [ ] CHANGELOG 有对应版本段，且没有遗留「未发布」标题。
- [ ] README 的功能、安装、发版段与代码一致（本次已按 2.4.5 更新）。
- [ ] 本次改过 `lib/client.panel.js` / 侧栏正文时，`lib/client.js` 有对应的 touch 行；`PANEL_KIT` 与 `client.panel.js` 的 `KIT_VERSION` 相等；`SIDEBAR_KIT`、`SIDEBAR_CHUNK` 与侧栏外壳的 `KIT_VERSION` 一致，且**全部页签 chunk 的 `KIT_VERSION` 也都等于 `SIDEBAR_KIT`**（2.4.5：侧栏 48，外壳 + shared + 10 个页签共 12 个文件；面板 11）。
- [ ] 若改过 `lib/client.js`，发版前整页刷新验过面板（本机宿主客户端热更新会直接生效）；改过 `lib/index.js` 则用「重启 DSH」验证。

## 1. 测试（必须串行）

```sh
node --test --test-concurrency=1 test/*.test.js
```

- 结果必须是 508 pass / 0 fail 才继续（2.4.5 当前 508，约 30–62s）。
- 偶发 `ENOTEMPTY` 等环境错误先重跑一次并记录；不重试到「抽到绿色」为止，要确认失败原因。
- 真机确认项（用户）：右侧边栏 9 页签 / 嵌入 11 页签；票子驾驶舱技能胶囊为绿色、relay-main / worker / release 可三选一；嵌入面板顶栏工作区下拉可切换、切走显示只读、写动作被拦、切回跟随；票子驾驶舱持有者活跃 / 久未活动时出现「交接给新会话」、依赖 / 审批 / 技能不满足时禁用并给原因；票子驾驶舱显示 holder / 分支 / 工作树 / 最近汇报、合并状态与「随 v2.4.5 发布」、任务审批单独；「还有 N 条」可展开；PR 11 态 chip / 筛选 / 图例 / 详情动作；AI 审核拉起后先「审批中」、结束自动「已审核 / 已驳回」；不出现 stale 提示。
- 真机步骤：插件管理器装本版本 → `/relay reload`（本轮含服务端改动）→ 整页刷新 → 打开侧栏、任务、PR、设置发布卡、票子驾驶舱与嵌入面板工作区切换各过一遍。

## 2. 版本号与 CHANGELOG

- `package.json` version 为 `2.4.5`，tag 为 `v2.4.5`。
- CHANGELOG 的版本标题用 `## 2.4.5 - YYYY-MM-DD`；本仓库既有条目用发布当天日期（2.4.5 写 `2026-11-09`）。
- 2.4.5 段按主题收口（协作面板工作区切换 / 票子驾驶舱交接 / KIT 与测试），不保留「未发布」段。
- 从 2.4.4 升级：右侧边栏仍 9 页签，嵌入面板 11 页签；侧栏文件改为 `client.sidebar<name>48.js`；`SIDEBAR_KIT 48`；`PANEL_KIT 11`；装好后整页刷新。

## 3. 打包

```sh
# 只删本地未发布产物；dist/ 里已发布版本的 tgz 不要删
rm -f dist/dsh-session-relay-2.4.5.tgz
npm pack --pack-destination dist
tar -tzf dist/dsh-session-relay-2.4.5.tgz | head -30
```

- 每个 Release 只挂一个 `.tgz`：插件管理器按 Release 安装时只认唯一附件。
- `files` 白名单：`lib/*.js`、`bundled-skills/*/SKILL.md`、`CHANGELOG.md`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`（`package.json` / `README.md` / `LICENSE` 由 npm 自动带上）。
- 校验包内 `package.json` 的 version 与 tag 一致，且 `lib/index.js`、`lib/release.js`、`lib/ticket-cockpit.js`、`lib/prreview.js`、`lib/client.sidebar48.js`、`lib/client.sidebar.shared48.js`、`lib/client.sidebar.tasks48.js`、`bundled-skills/relay-worker/SKILL.md`、`cordis.patch.yml` 在包里。
- 不要 `npm publish`。

## 4. 推送与 tag（需用户同意）

```sh
git push origin main
git tag v2.4.5 <发版提交>
git push origin v2.4.5
```

- 先确认发版提交就是清单里记录的 SHA；tag 指向该提交，不指向 T20/T22 或发版准备的中间提交。
- 推送 main 前再确认：没有别的会话在写同一个工作树（看声明），测试是刚跑过的。
- 已发布 tag 不移动、不删除、不改写；也不 force push main。

## 5. GitHub Release（需用户同意）

```sh
gh release create v2.4.5 dist/dsh-session-relay-2.4.5.tgz \
  --title v2.4.5 --notes-file docs/release-notes-2.4.5.md
```

- 说明文件用 `docs/release-notes-2.4.5.md`（亮点、要求 DSH 0.2.2-rc.1+、安装、升级注意、CHANGELOG 链接）。
- 只挂一个附件；不要同时挂源码包或第二个 tgz。
- 发布后从 Release 安装一次到干净环境验证：插件管理器 → 从 Release 安装；确认装到的是 2.4.5、侧栏 9 页签 / 嵌入 11 页签能打开，工作区切换 / 票子交接 / PR 11 态 / AI 自动回写正常。
- 市场会钉住 latest tarball；Release / tag 不能再改。

## 6. 市场条目

- 历史：PR #13149（v1.11.6→2.3.0）、PR #13382（→2.4.2）已被维护者合并；PR #13409（→2.4.3）open，Submission gate 已通过，等维护者合并。
- 当前：2.4.5 的市场更新等 Release 之后再提；若 #13409 仍未合并，可在该 PR 上更新或另提，由用户决定。
- 条目更新只改自己那一条；已合并条目钉住 tarball，所以发版顺序是：先 Release，再让市场读到新版本。
- 投稿格式、字段与 tarball 约定的细节见 `docs/awesome-dsh-plugin-submission.md`。

## 7. 发版后核对

- [ ] 版本线用 `peer_line` 更新：HEAD、tag、Release、origin/main 基线、下一版本状态（2.4.6）。
- [ ] issue #1 已于 2.0.0 关闭；若 2.4.5 又关联任务，按 `closeOnTerminal` 规则核对，未关则查同步队列（不手工改 GitHub）。
- [ ] 看板终态任务经用户确认后归档：`/relay tasks archive`。
- [ ] `/relay reload` 或重启 DSH（改过 `lib/index.js`、`package.json` 时）后，侧栏 9 页签、嵌入 11 页签、工作区切换 / 票子交接 / PR 11 态 / 任务页展开正常。
- [ ] 已发布内容只读：不再改 2.4.5 的 tag / Release / tarball；后续修正发 2.4.6。

## 附：2.4.5 本轮已知状态

- `origin/main`：`a93789b`（v2.4.4 tag，Release Latest）。
- 本地 main：T20 `9bedea5` + T22 `567606e` + 本轮发版准备提交（准备完成后记录 HEAD；推送前未发布）。
- 串行测试：508 pass / 0 fail（约 40–60s）。
- 侧栏 / 面板：`SIDEBAR_KIT 48` / 外壳 `lib/client.sidebar48.js` + `client.sidebar.shared48.js` + 10 个页签 chunk / `PANEL_KIT 11`。
- 真机：用户已于 2026-11-09 在本机 `/relay reload` + 整页刷新后核对 T20 工作区切换 / T22 交接按钮与 2.4.4 回补项，未报问题；发布后仍按 §5 从 Release 装一次复核。
- 市场：PR #13409（→2.4.3）open、gate 已过；2.4.5 条目待 Release 后更新（方式待用户定）。
- 待用户侧归档：0575dd9d、0e2c79b3、@ui-longtext 5b3fd5df、@ui-workitem 175a2ed3（模型无归档工具）。
