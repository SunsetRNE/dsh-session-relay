# dsh-session-relay 2.4.2

2.4.2 把右侧边栏 / 嵌入面板的正文从单个 chunk 拆成「外壳 + 共享件 + 10 个页签 chunk」：首次打开只加载外壳、共享件与当前页签，其余页签按需加载、悬停 200ms 预取；每个 chunk 自带 KIT 校验，右栏与嵌入面板共用同一加载器缓存。串行测试 446 全过。

## 亮点

- **按页签拆 chunk**：`lib/client.sidebar41.js` 只保留 TABS / TabBar / RelaySidebar / useBoard 与加载器；`client.sidebar.shared41.js` 放 Card / CopyId / 富文本 / WorkItem* / useLazyDetail / useRemoteList / 模型选择等共享件；会话 / 任务 / 交接 / 地图 / PR / 分支 / 问题 / 邮箱 / 更多 / 设置各一个 `client.sidebar.<name>41.js`。
- **按需加载与预取**：首次只拉「外壳 + 共享件 + 当前页签」，未访问页签不下载；hover / focus 页签 200ms 后预取，移出 / 点击取消；`navigator.connection.saveData === true` 时不预取。
- **共用缓存与失败回退**：右栏与嵌入面板共用模块级 chunk 缓存，同一 chunk 只下载 / 执行一次；加载中给同高骨架，失败给最小一行 + 刷新按钮；chunk `KIT_VERSION` 不配套显示实际 / 期望版本。
- **KIT 与缓存**：`SIDEBAR_KIT 41`，文件名带 KIT（`client.sidebar41.js` / `client.sidebar.<name>41.js`），换版本即换 URL，不命中 WebView 旧缓存；`PANEL_KIT 8` / `client.panel.js` 未改。
- **页签数不变**：右侧边栏仍 9 页签，嵌入「协作」面板 11 页签；数据格式与接口无变化，无需迁移。

## 要求

DeepSeek Harness **0.2.2-rc.1 及以上**（`engines.dsh` / `peerDependencies` 见 `package.json`）；系统需已登录 `gh`。

## 安装

插件管理器 → 从 Release 安装本页唯一的 `dsh-session-relay-2.4.2.tgz`。

## 升级

- 从 2.4.1 覆盖安装；装好后**整页刷新**。2.4.2 入口会请求新的 `client.sidebar41.js` 与按页签的 chunk，旧缓存的 `client.sidebar40.js` 不再被使用；若页面仍停在 stale 提示，按 `整页刷新 → /relay reload → 重启 DSH` 顺序处理。
- 首次打开侧栏 / 嵌入面板只加载当前页签；切换其它页签时首次会拉对应 chunk，之后走缓存。
- 已发布的 2.4.1 tag / Release 保持只读。

## 链接

- CHANGELOG：https://github.com/SunsetRNE/dsh-session-relay/blob/v2.4.2/CHANGELOG.md
- 维护与已知坑：`docs/maintenance-guide.md`
- 发版清单：`docs/release-checklist.md`
