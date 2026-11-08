# dsh-session-relay 2.4.1

2.4.1 收口侧栏刷新体验：进入侧栏先出页签框架与骨架，chunk 空闲预取；页面刷新 / 重开时先用上次快照渲染，再后台刷新；侧栏 chunk 改为按 KIT 命名（`client.sidebar40.js`），彻底绕开 WebView 对固定 chunk 名的旧缓存。串行测试 440 全过。

## 亮点

- **框架先出**：看板快照未到时先渲染页签栏、刷新 / 设置位与骨架，看板到达后原位替换；加载中可以先切页签，不再整块空白。
- **上次快照**：看板、PR / 问题列表与页签计数写入 `sessionStorage`（6 小时 TTL，当前标签页有效）；页面刷新 / 重开侧栏时先用上次内容渲染，再后台刷新，顶部显示「正在重新加载…」，不再从骨架闪到内容。
- **chunk 空闲预取**：侧栏正文在宿主空闲时预取，预取完成后首次打开直接渲染，不再闪「正在加载协作面板」；嵌入面板复用同一份已解析模块。
- **按版本命名的 chunk**：侧栏正文改为 `lib/client.sidebar40.js`，入口 `SIDEBAR_CHUNK` 指向新文件；KIT 一升就换文件名，浏览器不会命中旧 chunk 的 immutable 缓存。此前固定文件名 `client.sidebar.js` 在部分 WebView 里会一直返回旧版本，出现 `v39 → v40` 卡住、反复刷新 / 重启都不生效。
- **PR 刷新反馈**：刷新期间保留旧列表，标题栏显示「正在重新加载…」，不再像卡住。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.4.1.tgz`。

## 升级

- 从 2.4.0 覆盖安装；装好后**整页刷新**。如果页面仍停在 `v39 → v40` 的旧 chunk 提示，执行 `/relay reload`（或重启 DSH）后再整页刷新——2.4.1 入口会请求新的 `client.sidebar40.js`，旧缓存的 `client.sidebar.js` 不再被使用。
- 右侧边栏仍 9 页签，左栏 / 对话「协作」嵌入面板 11 页签；`SIDEBAR_KIT 40`；`PANEL_KIT 8` 未变（`client.panel.js` 未改）。
- 任务库、邮箱、仓库守候数据沿用 2.4.0 格式，无需迁移。
- 已发布的 2.4.0 tag / Release 保持只读。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.4.1/CHANGELOG.md
- 维护与已知坑：`docs/maintenance-guide.md`
- 发版清单：`docs/release-checklist.md`
