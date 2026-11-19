# M1 协作通道与恢复

当前结果：真实消息往返和 Claude watcher 投递已验证；M1 工程验收与独立交叉审查通过。真实经历试用待用户完成，M2 未开始。最新待办始终以编号消息和 relay.py status 为准。

## 协议与恢复入口

全新项目本地 relay 位于 `.agents_context/`，整个目录由 Git 忽略，与旧 CareerTwin 的消息、触发器和 watcher 分开。根目录 AGENTS.md、CLAUDE.md 指向恢复说明。

- `HANDOFF.md`：角色、文件归属、消息与恢复协议。
- `relay.py`：标准库 helper，原子发布、编号、pending、领取和归档。
- `msgs/`：追加式编号消息；`archive/`：已领取 hint 的归档。
- `baselines/` 与 `baseline-snapshots/`：逐文件 SHA-256 和供独立 diff 使用的旧文件内容。
- `watch_claude_trigger.sh`：由 Claude 自己的 harness 启动的一次性 watcher。
- `BOOTSTRAP.md`：已完成首联的恢复索引，并保留最初受限的历史记录。

```sh
python3 .agents_context/relay.py status
python3 .agents_context/relay.py pending --recipient codex
python3 .agents_context/relay.py pending --recipient claude
python3 .agents_context/test_relay.py
```

消息使用 `NNNN-codex-*.md` / `NNNN-claude-*.md`；不使用旧版的非对称 planner/builder 算法。消息必须声明 sender、recipient、type、scope、addresses、closes、reply_required、baseline、ownership，并写明实际验证与限制。ACK 只确认接收，不关闭请求；完成回复通过明确的 closes 关闭被回应的请求。

发布时加进程间锁并立即分配编号，完整文件 fsync 后以排他 hard-link 发布，随后才原子写 hint。消息永不覆盖。编号消息决定 pending，触发器、时间戳和进程存在与否都不代表完成。

## 已发生的真实交换

| 消息 | 实际结果 |
| --- | --- |
| 0001 Codex request | 请求 Claude 独立只读审查 M1，冻结产品文件 |
| 0002 Claude ACK | 接受只读角色和文件归属 |
| 0003 Claude review | 无阻塞/数据丢失缺陷；提出覆盖留空名称和 Back 取消两个小问题 |
| 0004 Codex handoff | 独立核查后限定五个文件，交由 Claude 单独修复 |
| 0005 Claude ACK | 明确确认通过自己 harness 的 watcher 收到 0004 |
| 0006 Claude response | 修复完成并提交新基线，等待独立复核 |
| 0007 Codex review | F1 接受；额外 Chrome 复现发现相同 URL 的 Back 未同步位置，限定四个文件跟进 |
| 0008 Claude ACK | 再次确认 watcher 投递和单独写入权限 |
| 0009 Claude response | 完成剩余相同 URL 历史记录修复，提交新基线 |
| Codex 最终独立复核 | 57 项测试、类型、构建、12 个 Chrome 场景及额外独立历史/hash 检查通过；接受两项修复 |

每个修复阶段由 Claude 单独写入明确列出的产品文件，Codex 保持只读并核对实际 diff 与基线。Codex 负责协调和验收文档。未发生双写、依赖更新、Git 提交、push、合并或部署。后续进一步修改仍需遵守当前请求/ACK 中的明确文件归属。

## 最终复核证据

- 逐一核对 Claude 的 33 个文件 SHA-256，复算两份后续 manifest 的 fingerprint 均匹配。第一次修复仅改约定五个文件，跟进仅改约定四个文件。
- 独立运行 `npm run typecheck`、`npm test`（4 个文件、57 项）、`npm run build`，均通过。
- 独立运行 `npm run check:browser`，12 个场景通过，pageErrors = []、externalRequests = []；本次从外层施加 90 秒上限，正常完成。
- 额外 Chrome 独立复现确认：相同 URL Back 后取消返回原 index，后续接受 Back 到达原 Profile 页面，共两次确认；原文保留。
- 额外检查直接修改 hash 的取消与接受，输入保留，每次仅确认一次。
- 最终验证期间产品文件没有变化。详细交付和限制见 m1-validation.md。

## Watcher 与实际限制

由 Claude 的实际 runtime 启动整个命令：

```text
Bash(command: "bash .agents_context/watch_claude_trigger.sh --once", run_in_background: true)
```

不能嵌套 &、nohup 或 disown；消息处理后按需要由 Claude 自己重新启动。重启或压缩恢复后先 reconcile durable messages，不因没有 hint 推断无待办。

最初首联确实受官方 CLI 缺少可用交互会话发送入口、CUA 符号链接沙盒错误和 System Events 辅助访问拒绝限制；后来通过用户在现有 Claude 会话粘贴启动文本完成首联。现在不能再把“尚无 ACK”当成当前状态。历史 PID、会话状态和当时权限也不能用于推断现在的运行状态。

Codex 在活跃回合使用本地 one-shot 等待和手动 reconcile 接收回复；`.trigger-codex` 自身仍不是已验证的桌面自动唤醒机制。没有创建计划自动化、OS 服务、替代 Claude 会话或私有 IPC 桥。用户再次恢复会话时应检查 mailbox。

验证环境是 Chrome 与 jsdom，未验证 Safari/Firefox、真实配额耗尽或辅助技术。浏览器脚本本身尚无总超时，本次复核由外层限制执行时间；Claude 记录过旧代码负向实验长时间挂起，它不能被说成干净的失败断言。最终修复代码的正向验证和新增单元回归均通过。
