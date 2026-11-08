# 发版清单（GitHub Release）

本仓库不发 npm，只发 GitHub Release：一个版本一个 tag、一个 `.tgz`。适用于任何版本；括号里是 2.4.2 的当前值（发版准备时）。

**硬规则**：推送 main、打 tag、发 Release、合并、安装插件、删除任何已发布内容，都必须由用户在主会话明确同意后执行；已发布的 tag / Release 永不删改，要修正就发新版本（版本号 +1）。

## 0. 前置确认

- [ ] 用户明确同意推送 main / 打 tag / 发 Release（2.4.2：待用户同意；2.4.1 已于 2026-11-09 同意并发布）。
- [ ] `git status` 干净；`.agents/` 是插件看板快照，已在 `.gitignore` 忽略，不提交、不打包。
- [ ] `git rev-parse HEAD` 记录发版提交（2.4.2：准备完成后的 HEAD）。
- [ ] `git ls-remote origin refs/heads/main` 仍是预期基线（2.4.2：`94ce887`，v2.4.1），确认本地领先提交数（2.4.2：T13 `fec91ad` + 本轮发版准备 = 2 个）。
- [ ] 工作树声明已更新（`.SESSION-DONE` 或声明文件写明发版状态）；看板核对通过（T13 已合入本地 main，声明已标 `.SESSION-DONE`）。
- [ ] 本仓库没有 GitHub Actions，测试以本地串行结果为准；不要假设远端 CI。
- [ ] `package.json` 的 `version` 等于 tag（2.4.2）。
- [ ] `engines.dsh` / `peerDependencies` 范围与 README「运行环境」一致（2.4.2：`>=0.2.2-rc.1` 起，未变）。
- [ ] CHANGELOG 有对应版本段，且没有遗留「未发布」标题。
- [ ] README 的功能、安装、发版段与代码一致（本次已按 2.4.2 更新）。
- [ ] 本次改过 `lib/client.panel.js` / 侧栏正文时，`lib/client.js` 有对应的 touch 行；`PANEL_KIT` 与 `client.panel.js` 的 `KIT_VERSION` 相等；`SIDEBAR_KIT`、`SIDEBAR_CHUNK` 与侧栏外壳的 `KIT_VERSION` 一致，且**全部页签 chunk 的 `KIT_VERSION` 也都等于 `SIDEBAR_KIT`**（2.4.2：侧栏 41，外壳 + shared + 10 个页签共 12 个文件；面板 8 未改）。
- [ ] 若改过 `lib/client.js`，发版前整页刷新验过面板（本机宿主客户端热更新会直接生效）；改过 `lib/index.js` 则用「重启 DSH」验证。

## 1. 测试（必须串行）

```sh
node --test --test-concurrency=1 test/*.test.js
```

- 结果必须是 446 pass / 0 fail 才继续（2.4.2 当前 446，约 30–62s）。
- 偶发 `ENOTEMPTY` 等环境错误先重跑一次并记录；不重试到「抽到绿色」为止，要确认失败原因。
- 真机确认项（用户）：右侧边栏仍 9 页签、嵌入面板 11 页签；首次打开只拉「外壳 + shared + 当前页签」，其它页签首次点击后再拉对应 chunk；hover / focus 页签约 200ms 后预取；切页签有骨架、无整块空白或报错；不出现 `v40 → v41` stale 提示（出现则按整页刷新 → `/relay reload` → 重启 DSH 顺序处理）；PR 刷新期间保留旧列表并显示「正在重新加载…」；`/relay drop` 快路径仍正常（需 reload，本轮无服务端改动）。
- 真机步骤：插件管理器装本版本 → `/relay reload`（本轮无服务端改动，可选）→ 整页刷新 → 打开侧栏、11 页签、PR 页各过一遍。

## 2. 版本号与 CHANGELOG

- `package.json` version 为 `2.4.2`，tag 为 `v2.4.2`。
- CHANGELOG 的版本标题用 `## 2.4.2 - YYYY-MM-DD`；本仓库既有条目用发布当天日期（2.4.2 写 `2026-11-09`）。
- 2.4.2 段按主题收口（按页签拆 chunk / 按需加载 / hover 预取 / 共用缓存 / 失败回退 / 测试与文档），不保留「未发布」段。
- 从 2.4.1 升级：右侧边栏仍 9 页签，嵌入面板 11 页签；侧栏文件改为 `lib/client.sidebar41.js`（外壳）+ `client.sidebar.shared41.js` + 10 个 `client.sidebar.<页签>41.js`；`SIDEBAR_KIT 41`；`PANEL_KIT 8` 未变；装好后整页刷新。

## 3. 打包

```sh
# 只删本地未发布产物；dist/ 里已发布版本的 tgz 不要删
rm -f dist/dsh-session-relay-2.4.2.tgz
npm pack --pack-destination dist
tar -tzf dist/dsh-session-relay-2.4.2.tgz | head -30
```

- 每个 Release 只挂一个 `.tgz`：插件管理器按 Release 安装时只认唯一附件。
- `files` 白名单：`lib/*.js`、`CHANGELOG.md`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`（`package.json` / `README.md` / `LICENSE` 由 npm 自动带上）。
- 校验包内 `package.json` 的 version 与 tag 一致，且 `lib/index.js`、`lib/client.sidebar41.js`、`lib/client.sidebar.shared41.js`、`lib/client.sidebar.tasks41.js`、`cordis.patch.yml` 在包里。
- 不要 `npm publish`。

## 4. 推送与 tag（需用户同意）

```sh
git push origin main
git tag v2.4.2 <发版提交>
git push origin v2.4.2
```

- 先确认发版提交就是清单里记录的 SHA；tag 指向该提交，不指向 T13 检查点或旧的 `94ce887`。
- 推送 main 前再确认：没有别的会话在写同一个工作树（看声明），测试是刚跑过的。
- 已发布 tag 不移动、不删除、不改写；也不 force push main。

## 5. GitHub Release（需用户同意）

```sh
gh release create v2.4.2 dist/dsh-session-relay-2.4.2.tgz \
  --title v2.4.2 --notes-file docs/release-notes-2.4.2.md
```

- 说明文件用 `docs/release-notes-2.4.2.md`（亮点、要求 DSH 0.2.2-rc.1+、安装、升级注意、CHANGELOG 链接）。
- 只挂一个附件；不要同时挂源码包或第二个 tgz。
- 发布后从 Release 安装一次到干净环境验证：插件管理器 → 从 Release 安装；确认装到的是 2.4.2、侧栏 9 页签 / 嵌入 11 页签能打开，按需加载与 stale 回退正常。
- 市场会钉住 latest tarball；Release / tag 不能再改。

## 6. 市场条目

- 历史：PR #13149（条目 v1.11.6→2.3.0）已于 2026-11-09 合并，市场条目现钉 v2.3.0。
- 当前：PR #13382（条目 → v2.4.1）open，Submission gate + check 已通过，等维护者合并；2.4.2 的市场更新等 Release 之后再提（若 #13382 仍未合并，可在该 PR 上更新或另提，由用户决定）。
- 条目更新只改自己那一条；已合并条目钉住 tarball，所以发版顺序是：先 Release，再让市场读到新版本。
- 投稿格式、字段与 tarball 约定的细节见 `docs/awesome-dsh-plugin-submission.md`。

## 7. 发版后核对

- [ ] 版本线用 `peer_line` 更新：HEAD、tag、Release、origin/main 基线、下一版本状态。
- [ ] issue #1 已于 2.0.0 关闭；若 2.4.2 又关联任务，按 `closeOnTerminal` 规则核对，未关则查同步队列（不手工改 GitHub）。
- [ ] 看板终态任务经用户确认后归档：`/relay tasks archive`。
- [ ] `/relay reload` 或重启 DSH（改过 `lib/index.js`、`package.json` 时）后，侧栏 9 页签、嵌入 11 页签、PR / 分支 / 问题 / 地图 / 邮箱 / 更多、卫星环正常。
- [ ] 已发布内容只读：不再改 2.4.1 / 2.4.2 的 tag / Release / tarball；后续修正发 2.4.3。

## 附：2.4.2 本轮已知状态

- `origin/main`：`94ce887`（v2.4.1 tag）。
- 本地 main：T13 `fec91ad` + 本轮发版准备提交（准备完成后记录 HEAD；未推送）。
- 串行测试：446 pass / 0 fail（约 30–62s）。
- 侧栏：`SIDEBAR_KIT 41` / 外壳 `lib/client.sidebar41.js` + `client.sidebar.shared41.js` + 10 个页签 chunk / `PANEL_KIT 8` 未改。
- 真机：用户 2026-11-09 预览 T13（stage 到运行中插件 + 整页刷新）确认可用；未做量化首开耗时对比。
- 市场：条目钉在 v2.3.0（#13149 已合并）；PR #13382（→ v2.4.1）open、gate 已过。
- 待用户侧归档：0575dd9d、0e2c79b3、@ui-longtext 5b3fd5df、@ui-workitem 175a2ed3（模型无归档工具）。
