# 发版清单（GitHub Release）

本仓库不发 npm，只发 GitHub Release：一个版本一个 tag、一个 `.tgz`。适用于任何版本；括号里是 2.0.0 的实际值。

**硬规则**：推送 main、打 tag、发 Release、合并、安装插件、删除任何已发布内容，都必须由用户在主会话明确同意后执行；已发布的 tag / Release 永不删改，要修正就发新版本（版本号 +1）。

## 0. 前置确认

- [ ] 用户明确同意推送 main / 打 tag / 发 Release（三条可以一起问，但要一次说清）。
- [ ] `git status` 干净；`.agents/` 是插件看板快照，已在 `.gitignore` 忽略，不提交、不打包。
- [ ] `git rev-parse HEAD` 记录发版提交（2.0.0：准备完成后的 HEAD）。
- [ ] `git ls-remote origin refs/heads/main` 仍是预期基线（2.0.0：`bb5bcee`），确认本地领先提交数（2.0.0：40+）。
- [ ] 工作树声明已更新（`.SESSION-DONE` 或声明文件写明发版状态）；看板核对通过。
- [ ] 本仓库没有 GitHub Actions（`.github/workflows` 不存在），测试以本地串行结果为准；不要假设远端 CI。
- [ ] `package.json` 的 `version` 等于 tag（2.0.0）。
- [ ] `engines.dsh` / `peerDependencies` 范围与 README「运行环境」一致（2.0.0：`>=0.2.2-rc.1` 起）。
- [ ] CHANGELOG 有对应版本段，且没有遗留「未发布」标题。
- [ ] README 的功能、安装、发版段与代码一致（本次已按 2.0.0 更新）。

## 1. 测试（必须串行）

```sh
node --test --test-concurrency=1 test/*.test.js
```

- 结果必须是 346 pass / 0 fail 才继续（2.0.0 当前 346）。
- 偶发 `ENOTEMPTY` 等环境错误先重跑一次并记录；不重试到「抽到绿色」为止，要确认失败原因。
- 真机确认项（用户）：UI 五批、T3 模板 / 全文搜索、任务页闪烁、成功反馈动画；projectStatus A/B 已实弹通过（T3 → issue #1 → Project 1，Todo → In Progress）。
- 真机步骤：插件管理器装本版本 → `/relay reload` → 刷新面板 → 侧栏 4 页签 / 模板 / 全文搜索 / 任务详情 / 动态页票卡与拆分子任务各过一遍；错误文案仍应是文字。

## 2. 版本号与 CHANGELOG

- `package.json` version 为 `2.0.0`，tag 为 `v2.0.0`。
- CHANGELOG 的版本标题用 `## 2.0.0 - YYYY-MM-DD`；本仓库既有条目都用 UTC 日期（2.0.0 写 `2026-11-06`）。
- 2.0.0 段按主题收口（侧栏 / 任务与审批 / GitHub / 模板与搜索 / 协作可靠性），不再保留逐检查点的「未发布」段。
- 从 1.11.x 升级：任务库的 `stage` / `approval` 是增量字段，旧任务缺字段时降级显示；issue / repo / sync 开关默认关，不打开不会写 GitHub。

## 3. 打包

```sh
# 只删本地未发布产物；dist/ 里已发布版本的 tgz 不要删
rm -f dist/dsh-session-relay-2.0.0.tgz
npm pack --pack-destination dist
tar -tzf dist/dsh-session-relay-2.0.0.tgz | head -30
```

- 每个 Release 只挂一个 `.tgz`：插件管理器按 Release 安装时只认唯一附件。
- `files` 白名单：`lib/*.js`、`CHANGELOG.md`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`。
- 校验包内 `package.json` 的 version 与 tag 一致，且 `lib/index.js`、`cordis.patch.yml` 在包里。
- 不要 `npm publish`。

## 4. 推送与 tag（需用户同意）

```sh
git push origin main
git tag v2.0.0 <发版提交>
git push origin v2.0.0
```

- 先确认发版提交就是清单里记录的 SHA；tag 指向该提交，不指向旧检查点。
- 推送 main 前再确认：没有别的会话在写同一个工作树（看声明），测试是刚跑过的。
- 已发布 tag 不移动、不删除、不改写；也不 force push main。

## 5. GitHub Release（需用户同意）

```sh
gh release create v2.0.0 dist/dsh-session-relay-2.0.0.tgz \
  --title v2.0.0 --notes-file docs/release-notes-2.0.0.md
```

- 说明文件用 `docs/release-notes-2.0.0.md`（亮点、要求 DSH 0.2.2-rc.1+、安装、升级注意、CHANGELOG 链接）。
- 只挂一个附件；不要同时挂源码包或第二个 tgz。
- 发布后从 Release 安装一次到干净环境验证：插件管理器 → 从 Release 安装；确认装到的是 2.0.0、侧栏能打开。
- 市场会钉住 latest tarball；Release / tag 不能再改。

## 6. 市场条目

- 市场 PR #12624 等维护者合并，不轮询；合并后看 `plugins.json` 的 `updated` 是否当天（目录定时重建，合并 ≠ 立刻生效）。
- 条目更新只改自己那一条；已合并条目钉住 tarball，所以发版顺序是：先 Release，再让市场读到新 latest。
- 是否给条目补「兼容 Claude / GPT（DSH 可配置模型都能当主会话 / 工作会话）」说明，待用户决定；README「为什么是平级会话」已有该事实。
- 投稿格式、字段与 tarball 约定的细节见 `docs/awesome-dsh-plugin-submission.md`。

## 7. 发版后核对

- [ ] 版本线用 `peer_line` 更新：HEAD、tag、Release、origin/main 基线、下一版本状态。
- [ ] issue #1：推送 / 合并后按 `closeOnTerminal` 规则应自动关闭；核对状态，未关则查同步队列（不手工改 GitHub）。
- [ ] 看板 T1 / T2（已放弃示例）与 T3（已完成）经用户确认后归档：`/relay tasks archive`。
- [ ] `/relay reload` 或重启 DSH（改过 `lib/index.js`、`package.json` 时）后，侧栏 4 页签、模板、搜索、任务详情正常。
- [ ] 已发布内容只读：不再改 2.0.0 的 tag / Release / tarball；后续修正发 2.0.1。

## 附：2.0.0 本轮已知状态

- 本地 HEAD：准备完成后的 SHA（起点 `3a9b38c`；收口提交在其后）。
- `origin/main`：`bb5bcee`（v1.11.6 在 `24902db`）。
- 本地领先：40 个检查点 + 本轮发版准备提交；未推送、未打 tag、未发 Release。
- 串行测试：346 pass / 0 fail（约 35s）。
- 市场：PR #12624 等维护者；issue #1 等推送后按规则关闭。
