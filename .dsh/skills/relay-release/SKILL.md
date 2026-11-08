---
name: relay-release
description: Prepare and publish a dsha-session-relay GitHub Release safely — version/CHANGELOG/release-notes/checklist, serial tests, exactly one tgz, push/tag/Release only after explicit user approval, market PR, and post-release verification.
whenToUse: When the user approves publishing a new dsha-session-relay version, or asks to prepare release materials, tag, Release, tarball, or market-entry update for it.
---

# relay 发版流程

事实源是 `docs/release-checklist.md`，逐项执行；主会话协调流程见 `relay-main`。先确认用户已在**当前会话**明确同意 push / tag / Release——旧版本的同意不延续。

## 准备（不需要额外授权）

1. 确认基线：`git status` 干净、`git ls-remote origin refs/heads/main`、预期 tag/Release、本地领先提交。
2. 版本号：`package.json` → `<版本>`；CHANGELOG 收口为 `## <版本> - <日期>`，不保留「未发布」；写 `docs/release-notes-<版本>.md`；更新 README 与 `docs/release-checklist.md` 的实际值。
3. 侧栏 KIT 校验：`SIDEBAR_KIT` 与外壳/全部 chunk 的 `KIT_VERSION` 一致，`PANEL_KIT` 与面板一致，`SIDEBAR_CHUNK` 与文件名一致；改过 `lib/client.js` 要整页刷新验过。
4. 串行测试：`node --test --test-concurrency=1 test/*.test.js` 全绿。
5. 打包：`npm pack --pack-destination dist`；确认唯一 `.tgz`、版本号、包内容、sha256。

## 发布（需用户明确同意）

1. `git push origin main` → 核对 `origin/main` 指向发版提交。
2. `git tag v<版本> <发版提交>` → `git push origin v<版本>` → 核对远端 tag。
3. `gh release create v<版本> dist/dsh-session-relay-<版本>.tgz --title v<版本> --notes-file docs/release-notes-<版本>.md`。
4. 核对：Latest、唯一附件、附件 size 与 sha256 与本地一致；下载一次复核 sha256。

## 市场（单独 PR）

- 只改 awesome-dsh-plugin 里自己那一条；tarball 钉 tag 且文件名带版本；Submission gate 必须通过；合并由市场维护者决定。
- 发版顺序：先 Release，再更新市场条目。

## 发布后

- 用 `peer_line` 更新版本线（版本、tag、Release、origin/main、附件 sha、下一版本状态）。
- 请用户从 Release 安装一次做真机核对（侧栏 9 页签 / 嵌入 11 页签、stale 提示、PR 刷新）。
- 记录遗留项；已发布内容只读，修正发新版本。

## 不要做

- 不发 npm；不 force push main；不移动/删除已发布 tag；不改已发布 Release/tarball；每个 Release 只挂一个 `.tgz`。
