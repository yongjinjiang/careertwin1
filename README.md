# CareerTwin1

以用户原文为资料来源的本地个人经历库。**M0 与 M1 已实现**，当前可手动建立、浏览和维护 Profile。真实经历试用待用户完成；M2 及后续未开始。

## 本地启动

需要 Node.js 22.12+（本次验证 25.5.0）与 npm：

```sh
cd /Users/shuaiyuan/Documents/ChatGPT/career-twin1
npm ci
npm run dev
```

打开 http://127.0.0.1:5181/ 。固定使用这个地址；`localhost`、不同端口、浏览器或设备各有独立存储。端口被占用时明确报错，不自动换端口。

## 使用

- **主页**：输入可选名称与项目原文。名称留空取原文首个非空行，最多 40 个 Unicode code point。中文按字、英文按词，普通项目上限 500，没有高于非空的最低要求。
- **Save as new**：先保存原文，再可选补充单位和年份。可以跳过或取消，已保存原文不会丢失；留空单位为个人项目。
- **Overwrite existing**：明确选择已有目标，按名称、单位、年份辨认。按钮显示目标名称；名称留空保留目标名称，明确填写则改名；覆盖保留 ID、创建时间和原元数据。
- **我的 Profile → 项目**：浏览原文前两行与全文，Edit 返回主页同一编辑器。保存修改更新同一项目；“切换为新建项目”明确开始另一条。
- **删除**：确认提示包含目标名称、单位和年份。
- **Basic Info**：在独立 tab 直接编辑并保存，始终使用一条固定记录，不受 500 字上限限制。可以清空内容后保存。
- 保存失败保留输入；重复提交不会重复新建。离开未保存内容会确认，保存进行中会阻止应用内切页。

所有手动维护都不调用模型。不需要 API key、登录或后端。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run check:browser
```

浏览器检查需先启动本地服务，并安装 Google Chrome。默认使用本机 Chrome 的全新临时上下文，测试资料全部为合成内容，不访问个人浏览器资料。也可设置 `CAREERTWIN_BROWSER_EXECUTABLE` 指定 Chromium 可执行文件，或 `CAREERTWIN_BASE_URL` 指向本地预览地址。截图与 JSON 结果写到已忽略的 `artifacts/browser/`。

`npm run preview` 使用 http://127.0.0.1:5182/ ，与开发端口的数据分开。构建产物位于 `dist/`。

## 数据与范围

资料存储在当前浏览器此 origin 的 IndexedDB `careertwin1-profile`，与旧版数据库独立。原文不会被生成摘要、静默截断或写回其他模型。备份恢复与跨设备同步尚未实现，清理浏览器站点数据会删除资料。代码目录位于 Dropbox 不代表浏览器资料会自动同步。

项目只包含 React + TypeScript 前端、原生 IndexedDB 与必要开发/测试依赖。没有备份恢复（M2）、简历导入（M3）、Job Analysis、Resume Generation、雇主分享或旧数据迁移。工作保留在本地，没有 push、合并或部署。

## 路径与文档

| 路径 | 页面 |
| --- | --- |
| `/#/` | 统一项目编辑器 |
| `/#/profile/projects` | 项目浏览、全文、编辑与删除 |
| `/#/profile/basic-info` | 基本信息直接编辑与保存 |

- [完整原计划与当前进度](docs/profile-first-rebuild-plan.md)
- [数据、计数与独立存储约定](docs/data-contract.md)
- [M0 实施与验证记录](docs/m0-validation.md)
- [M1 验收清单](docs/m1-acceptance.md)
- [M1 实施与验证记录](docs/m1-validation.md)

## 本地协作

Claude/Codex 的恢复入口见 AGENTS.md、CLAUDE.md 与 [协作记录](docs/m1-collaboration.md)。真实 request/ACK/review 往返和 Claude watcher 投递已验证；M1 修复通过独立复核（57 项测试、12 个 Chrome 场景）。恢复后先运行 relay.py status，不依赖触发器推断待办。
