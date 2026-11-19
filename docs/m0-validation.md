# M0 实施与验证记录

日期：2026-10-19（America/Denver）。M0 已完成；后续用户追加授权继续 M1，最终页面将由 M1 替换空骨架。

## 初始状态和隔离

- 指定目录确为用户的新仓库。物理路径为 `/Users/shuaiyuan/Dropbox/Mac/Documents/ChatGPT/career-twin1`，与指定路径同一目录。
- 初始内容只有 `.git`，`main` 尚无提交，无既有源码或用户改动；未发现适用的 AGENTS.md。
- 旧版 `/Users/shuaiyuan/Dropbox/Mac/Documents/careertwin` 只读检查：`main...origin/main`，59 个已跟踪文件变更，22 个未跟踪条目。未整理、复制、提交或修改旧版。
- 旧数据库名称只读查得 `careertwin`（version 3）、`careertwin-shares`；新版使用 `careertwin1-profile`（version 1），没有旧模型、兼容层或迁移。
- 默认 shell/文件工具因 Documents 是符号链接而无法启动/写入；获自动审查允许后，受限于新版目录执行必要命令，未更改用户沙盒配置。

## M0 交付

独立 React 18 + TypeScript + Vite 工程、主页与两个 Profile 页面空状态、hash 路径、稳定记录类型、固定 Basic Info ID、独立 IndexedDB 初始化、500 字计数/校验函数、完整计划和 M1 验收清单。具体规则见 data-contract.md。

## 实际执行结果

- `npm install --no-audit --no-fund`：成功，生成独立 package-lock.json。
- `npm run typecheck`：通过。首次检查发现状态联合类型需拆为独立分支，修正后通过。
- `npm test`：**2 个文件、37 项通过**。覆盖汉字/英文/混合输入、数字/标点/组合字符、500/501、空内容，以及真实 fake-indexeddb 工厂下的旧库隔离、重复初始化、空 schema、固定 Basic Info 键、失败/新版本保护及连接释放。
- `npm run build`：通过，29 个模块，生产 JS 151.14 kB（gzip 49.23 kB）。
- `npm run dev`：实际启动成功，Vite 在 `127.0.0.1:5181` 就绪。
- `curl --fail http://127.0.0.1:5181/`：成功返回新版 HTML。
- 内置浏览器 CUA 启动受相同符号链接沙盒问题阻碍，未声称通过该工具的视觉检查；后续 M1 将使用本机 Chrome 进行真实浏览器验收。

M0 骨架不包含用户记录 CRUD 或保存界面。M1 是后续追加授权的独立实施范围；备份恢复、导入和下游功能均未开始。
