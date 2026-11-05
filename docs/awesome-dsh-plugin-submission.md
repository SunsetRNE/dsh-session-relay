# 上架 awesome-dsh-plugin 的公开约定（2026-11 版）

给正在做插件、准备上架市场的人/会话用。内容来自该仓库 `contributing.md`、`.github/pull_request_template.md`、
CI 工作流，以及我们（dsh-session-relay）实际提 PR、被合并、再提更新 PR 的全过程。
官方原文才是准绳，本文件是提炼 + 踩过的坑。

- 数据源仓库：`awesome-dsh-plugin/awesome-dsh-plugin`（`data/plugins/*.yml`）
- 市场（如 dsh-market）不接收投稿，它每次打开时读该仓库生成的 `plugins.json`
- 所以**唯一投稿渠道**就是向那个仓库提 PR；不要往市场仓库提条目

## 1. 一个文件 = 全部投稿

```
data/plugins/<owner>__<repo>.yml
```

- 一条插件一个文件，**永不与别人冲突**（这是他们把 README 改成分文件的原因：以前所有人往同一个 README 段落追加，合一条就撞下一条）
- **两个 README 由脚本生成**：`npm ci && node scripts/generate-readme.mjs`。不要手改；不提交也行，合并后 main 会自动重新生成
- 想本地预览可以生成，但提交的结果必须与数据源一致
- **更新自己已有的条目：只改自己那一条**。改别人的条目是明确的拒绝理由（历史上出过两次：issue #1348），CI 的 gate 会列出 PR 改动的每一条既有条目供人追问
- 一个 PR **最多 3 条**（超过 CI 直接拒；余量是留给 monorepo 子包的）

## 2. 条目字段

```yaml
url: https://github.com/owner/repo          # 必须与仓库完全一致
name: owner/repo                            # 列表里显示的链接文字
category: tools                             # 见第 3 节
description:
  en: 'One line, ends with a period.'       # 只有 en 必填
  zh: 一句话，以句号结尾。                     # 可选，维护者会补
icon: https://raw.githubusercontent.com/owner/repo/main/assets/icon.png   # 可选，GitHub 托管位图
tarball: https://github.com/owner/repo/releases/download/v1.2.0/pkg-1.2.0.tgz  # 可选，见第 4 节
```

- **描述里含 `: `（冒号+空格）必须加引号**，否则 YAML 会当成嵌套键解析失败；中文全角冒号没这个问题
- monorepo 子包：`url` 指到子目录，`name` 用 `owner/repo#子包名`，文件名 `owner__repo--packages-my-plugin.yml`
- 截图**不写在这里**，见第 5 节

## 3. 分类

`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`

分类选得不贴合**不会被打回**，维护者直接改。挑最接近的即可，不必纠结。

## 4. tarball：两种写法，一种会烂

市场优先展示 tarball 而不是「源码构建」命令，所以发版方式值得认真选。

| 写法 | 结论 |
|---|---|
| `https://github.com/owner/repo/releases/download/v1.2.0/pkg-1.2.0.tgz`（**钉 tag**，文件名带版本） | ✅ 官方推荐。永不过期 |
| `https://github.com/owner/repo/releases/latest/download/pkg.tgz`（**latest**，文件名**不带**版本） | ✅ 可以，但要保证资产名永远不带版本号 |
| `https://github.com/owner/repo/releases/latest/download/pkg-1.2.0.tgz`（latest + 文件名带版本） | ❌ **会烂**：`latest/download/` 只解析 latest，文件名照字面取；下次发版就 404，而且没人会发现 |

- 必须是 `https` + GitHub Release 托管（`github.com/.../releases/...`），第三方图床/网盘一律不收
- 每个 Release 只挂一个 `.tgz`（插件管理器按 Release 安装时只认唯一附件）

## 4b. 市场会不会「钉住」你第一次发的版本？（实测：不会）

`awesome-dsh-plugin.com/plugins.json` 是把 `data/plugins/*.yml` 原样发布的：`tarball` 就是你写的那条字符串，生成时不重写、不解析。
所以：

- `latest/download/<不带版本的文件名>`：**永远解析到当时的 latest**。以后发新版，所有人都拿到新版，不用再提 PR 改条目
- `/releases/download/vX.Y.Z/...`：真正的版本钉死，这时必须永远不删、不改写那个 tag

线上现状（2026-11-05 拉取，8879 条）：有 `tarball` 的 1257 条里，`latest/download/` 形式 469 条、钉 tag 形式 748 条——两条都正当；
其中已有 5 条踩了「latest/download + 文件名带版本号」的烂链形态。

两个细节：

- **GitHub 的 `latest` 排除 draft 和 prerelease**。把某版标成 pre-release，`latest/download/` 会继续指向上一个正式版——既是坑，也可以当「先放出来但不当默认」的杠杆
- **目录是定时重建的**：合并 ≠ 立刻生效。market 拉到的那份 `plugins.json` 有 `updated` 字段，可以先看它是不是当天的

打包时的小技巧：资产名要「不带版本号」时，除了上传 API 指定 name，也可以**先把本地文件改名成 `pkg.tgz` 再 `gh release create`**——gh 用文件名当资产名，改好文件名最省事。
另外 proroot 环境下 gh 报的附件体积可能失真（有会话遇到过上报 714MB 的），发布后务必核 `size` + `sha256`。

## 5. 截图：放自己仓库（可选，强烈推荐）

仓库根（monorepo 放子目录）放 `screenshots.json`，列 1–8 张图：

```json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

`{"screenshots": [...]}` 也行。规则：
- 相对路径**不能跳出插件目录**（不能 `/` 开头、不能含 `..`）
- 也可以用绝对 URL，但必须是 GitHub 托管（`raw.githubusercontent.com`、`user-images.githubusercontent.com`、`camo.githubusercontent.com`、github.com 附件）
- 改图推自己仓库即可，不用再来提 PR，下一次构建自动生效
- 不声明也没关系，市场会从 README 抽图；声明只是让你控制顺序与取舍

## 6. `peerDependencies` 的预发布陷阱（最容易踩、最难发现）

node-semver 规则：**带预发布标签的版本，只有当范围里存在「同一个 major.minor.patch 元组」且自身带预发布标签的比较符时才满足**。

实测（`semver.satisfies`，未开 `includePrerelease`）：

| 范围 | 0.2.2-rc.1 | 0.2.3-rc.1 | 0.2.9 |
|---|---|---|---|
| `>=0.2.2-rc.1 <0.3.0-0` | ✅ | ❌ **静默排除** | ✅ |
| `>=0.2.0-0 <0.3.0-0`（看起来最宽） | ❌ | ❌ | ✅ |
| `>=0.2.2-rc.1 <0.3.0-0 \|\| >=0.2.3-rc.1 <0.3.0-0 \|\| >=0.2.4-rc.1 <0.3.0-0` | ✅ | ✅ | ✅ |

后果：用户装插件时撞 `ERESOLVE`，还得自己加 `--legacy-peer-deps`。

**做法**：每个你想支持的补丁位写一条显式分支（`||`），至少覆盖当前版本与接下来一两个补丁位；
`engines.dsh` 也一并写。官方 `@deepseek-ai/*` 一律放 `peerDependencies`（不是 `dependencies`），
避免 profile 里出现重复运行时。

## 7. CI 会依次检查什么

1. **条目数**：一个 PR 最多 3 条（最先查，早于任何网络请求）
2. **`dsh.bundle`**：从你仓库的 `package.json` 读（根包，或 `packages/` `plugins/` `apps/` 子包）。**只声明 `dsh.client` 会在这里失败** —— 这是最常见的被拒原因。需要：

   ```jsonc
   "dsh": {
     "bundle": { "patch": "./cordis.patch.yml" },  // ← 必须，且仓库根要有这个文件
     "client": { "platform": "web" }               // 仅带浏览器 UI 时需要
   }
   ```

3. **仓库年龄 ≥ 1 天**（建仓时间，自动检查；不达标就等，结论过期会自动重跑，不用推空提交）
4. **`awesome-lint` 与站点构建**：双语一致性、分隔符、日期、截图格式

失败会明确说要改什么——**在同一分支推修复即可**，不用重开 PR。

## 8. 评审关注点（CI 绿只是前置条件）

1. 代码是否真做到了条目描述里的每一句（含数字、命令名、API 名）——**夸大是唯一会让好插件被打回的原因**
2. 分类是否合理（不会因此被打回）
3. 是否是真代码，不是占位/空壳
4. 是否与已有条目重复：同功能先到者保留位置，但**这是一次平局判据，不是既得利益**；维护得更好、确实新增东西的 fork **可以**被收录（先例 `panando/dsh-pua`）
5. 源码是否有可疑之处（混淆、凭据外传、安装期异常行为）——收录不等于安全审查
6. PR 是否动了无关条目
7. 是不是**纯聚合包**（内容只有依赖清单）——不收；自己做事（合成配置、提供设置界面、运行时协调）才算插件
8. 聚合包的依赖是否指向**原作者**仓库或 npm 包——指向自己转存的副本不收

## 9. `held: author` 标签

需要改东西时维护者会给 PR 打 `held: author`：
- **不是拒绝**，只是暂停在合并队列里等你改
- 把修复推到同一分支，然后留**一条**评论说改了什么，这是全部需要的信号；反复推送、追问都不会更快
- 标签不会自动摘，只有重新评审才会摘
- 自查状态看 **"Held pull requests that may have healed"** 跟踪 issue（每天 06:19 UTC 刷新）
- 表里 gate 显示 `—` 通常是分支与 main 冲突（冲突的 PR 没有 merge ref，CI 根本不跑）；对投稿来说冲突几乎都在生成的 README 行上，**靠推送解决不了**，得维护者 rebase

## 10. 本容器的操作配方（DSHA / 手机 Ubuntu 容器）

`gh` 是 Go 程序，看不到 Ubuntu 文件、也起不了 git，所以 `gh pr create` / `gh repo clone` / `gh pr checkout` 都不可用；用 REST。

```sh
# 0) 环境已升级到 DSH 0.2.2-rc.1 后，gh 的 CA 路径变成错的（报 x509，还说 token 无效）
export DSHA_GH_CA=/data/data/<包名>/files/linux/ubuntu/usr/local/share/dsha/ca-certificates.crt
#    <包名> 形如 io.github.sunsetrne.dsha；不设的话 gh 一律 TLS 失败

# 1) fork 同步到上游最新（POST merge-upstream，fast-forward）
gh api -X POST repos/<你>/awesome-dsh-plugin/merge-upstream -f branch=main

# 2) 从 fork 的 main 拉新分支
gh api -X POST repos/<你>/awesome-dsh-plugin/git/refs \
  -f ref=refs/heads/add-my-plugin -f sha=<fork main 的 sha>

# 3) 用 contents API 写条目文件（已存在时带 sha 更新）
gh api -X PUT repos/<你>/awesome-dsh-plugin/contents/data/plugins/<owner>__<repo>.yml \
  --input body.json    # {message, content: base64, sha?, branch}

# 4) 开 PR（REST；body 用 JSON 传，避免 shell 转义问题）
gh api -X POST repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls \
  --input pr.json      # {title, head: "<你>:add-my-plugin", base: "main", body}

# 5) 后续修改：往同一个分支再提一次 contents PUT，CI 自动重跑
```

PR 正文建议照 `.github/pull_request_template.md` 的清单写（一个文件 / `dsh.bundle` / 满 1 天 / 分类 / 描述属实 / 有 topic），
再补「改了什么、为什么」。用 deepseek harness 做的，结尾附官方徽章：

```markdown
[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
```

## 11. 其它实践

- 仓库要打 `dsh-plugin` topic（硬性要求之一）
- 合并节奏很快：维护者会批量扫，有时 2 分钟合 20 条，**零评论也能过**；被要求改会以 PR 评论指出具体哪一行
- 条目合并后，**市场会钉住那个 tarball**：所以已发布的 Release / tag **永远不要删、不要改写**，要修正就发新版本（版本号 +1），否则老用户的安装直接断链
- 发版顺序建议：`npm test` → `npm pack` 到 `dist/` → 打 tag 并 push → `gh release create` 只挂这一个 tgz → 核对 `sha256`（本地包 / Release 附件摘要 / 重新下载三者一致）
