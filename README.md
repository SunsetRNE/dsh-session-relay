# dsh-session-relay

DeepSeek Harness（DSHA）平级会话互通插件：一个主会话协调多个工作会话，提供版本线公告、指令模板、汇报合并唤醒、任务看板核对、会话检查与主会话交接。

## 功能

- `/relay` 命令：新建 / 打开会话、指派编号、群发指令、版本线、模板、接手与唤醒、主会话交接、任务看板（`/relay tasks`）、会话检查与搜索（`/relay inspect`、`/relay search`）。完整用法见 `/relay help`。
- 模型工具：`peer_list`、`peer_report`、`peer_send`、`peer_spawn`、`peer_alias`、`peer_inspect`、`peer_tasks`，主会话另有 `peer_line`、`peer_assign`、`peer_workspace`、`peer_handoff`。
- 协作面板（Web 客户端）：看板、交接预览、会话唤醒。

## 运行环境

- DeepSeek Harness，插件依赖的 `@deepseek-ai/dsh-*` 包由宿主提供，不单独安装。
- 部分功能（设备桥）读取 DSHA 容器内的 `/root/.dsh/.bridge_headers` 与 `/root/.dsh/.bridge_port`，非 DSHA 环境下这些功能不可用。

## 开发

```sh
# 测试需要宿主的 node_modules，本地软链即可（已在 .gitignore 中忽略）
ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules node_modules
npm test
```

加载方式：`lib/index.js` 是外壳，逻辑在 `lib/impl.js` 及其依赖里。改实现文件后 `/relay reload` 即可生效；改 `lib/index.js`、`lib/client.js`、`package.json` 的 `dsh` 字段或 `cordis.patch.yml` 需要重启 DSH。

## 打包

```sh
npm pack
```

生成 `dsh-session-relay-<版本>.tgz`，内容由 `package.json` 的 `files` 字段决定。

## 许可

MIT
