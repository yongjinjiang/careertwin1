# M0 数据、计数与存储约定

日期：2026-10-19（America/Denver）。本文件中的具体字段、算法、数据库名称及端口是 **M0 新增实现决定**；M1 延续这些约定并新增下面注明的操作规则，产品约定来源见完整计划。

## 最小数据类型

定义位置：`src/domain/profile.ts`。所有记录包含：

| 字段 | 约定 |
| --- | --- |
| `formatVersion` | 当前为 1；记录格式版本，与 IndexedDB schema 版本分开 |
| `id` | 稳定记录 ID，编辑与覆盖不得重新分配 |
| `type` | `project` 或 `basic_info`；用它识别记录类型，不用单位或名称 |
| `displayName` | 显示名称，不替代原文 |
| `originalText` | 用户输入原文，保留换行、空格、标点，不进行规范化或静默截断 |
| `organization` | 项目为用户填写的单位或 `null`；Basic Info 固定 `basic info` |
| `createdAt` / `updatedAt` | `Date.toISOString()` 生成的 UTC ISO 8601 字符串 |

普通项目：`id = project:<crypto.randomUUID()>`，`type = project`；增加 `startYear: number | null`、`endYear: number | null` 和 `isCurrent: boolean`。年份按四位整数 1000–9999 表示，只记年、不增加月份。无时间为两个 `null` 与 `false`；至今时 `endYear = null`、`isCurrent = true`；两年都填写时起年不得大于止年。起年可空。这些元数据的表单与运行时校验已在 M1 实现。

Basic Info：固定 `id = basic_info`、`type = basic_info`、`displayName = Basic Info`、`organization = basic info`，不含工作起止年份与至今字段。没有内容时可以没有这条记录；初始化不创建空白用户记录。M1 在此固定 ID 写入，才能保证至多一条，不得用随机 ID 新建 Basic Info。TypeScript 联合类型与 M1 仓库的固定写入入口共同落实此约定。

项目名称留空时从原文首个非空行生成简短名称、不调用 LLM，这是既定产品约定；**M1 新增默认**：首个非空行按 Unicode code point 截取 40 个，超长追加省略号；显式名称去除首尾空白。覆盖必须保留 ID、创建时间、默认单位与时间，仅更新原文及修改时间，元数据仅在用户明确修改时更新。M0 定义约束，M1 在统一编辑器与事务仓库中实现。

## 500 字的确定算法

实现：`src/domain/text.ts` 的 `countProfileText`，逐个 Unicode code point 扫描，与浏览器 UI 或语言设置无关，不用 `Intl.Segmenter`。

1. 每个 Unicode `Script=Han` 字符计 1，包含扩展区汉字；按 code point 而非 UTF-16 长度计数。
2. 其余文字中，连续的 Unicode 字母或数字计 1；随后的组合附加符号归属该词。因此英文按词，`API`、`v2`、`2026` 各计 1；重音字母的组合写法不增加计数。其他非汉字语言暂时也使用连续字母数字规则，不承诺语言学分词。
3. 英文直/弯撇号 `'` / `’` 仅当在词内、下一字符为非汉字字母或数字时连接为同一词，`don't` 和 `user’s` 各计 1。
4. 空格、制表符、换行、全角空格均为分隔符，自身计 0。其他标点、连字符、下划线、斜线、符号和 emoji 自身计 0，同时分隔词。
5. 汉字与非汉字串互相分隔，混合输入累加；不需要用户插入空格。
6. 数字连续串计 1，数字中的标点仍会分隔：`12.5` 计 2，`1,000` 计 2，`-30` 计 1，`30%` 计 1。这是长度规则，不是数字解析。
7. 纯空白、纯标点或纯 emoji 没有可计数正文，普通项目校验返回 `empty`。任何至少 1 个计数单位的正文都可保存，没有更高的最低字数。
8. 普通项目 **500 可接受、501 超限**，`validateProjectText` 返回计数与 `empty` / `too_long`，不修改输入。Basic Info 不调用这个普通项目上限校验。

| 输入 | 计数 |
| --- | ---: |
| `开发项目` | 4 |
| `Build a reliable profile` | 4 |
| `开发React项目2026版` | 7 |
| `负责API设计，提升30%效率。` | 10 |
| `don't user’s O'Reilly` | 3 |
| `full-stack foo_bar UI/UX` | 6 |
| `12.5 -30 1,000` | 5 |
| `C++ C# v2` | 3 |
| `𠀀研究` | 3 |
| 空白、`，。！？`、emoji | 0 |

M1 编辑器直接复用同一个函数显示实时计数，超限保留输入并提示，不静默截断；仓库写入时再次校验。Basic Info 可以保存空文本（明确清空），不复用普通项目上限。

## 独立 IndexedDB 边界

实现：`src/storage/profileDatabase.ts`。

- 数据库：`careertwin1-profile`；IndexedDB schema version：`1`。
- 唯一 object store：`records`，keyPath：`id`。
- 非唯一索引：`by-type`，keyPath：`type`，供 M1 将项目与 Basic Info 分开读取。
- M0 初始化仅创建并检查 schema，不写入、读取、迁移或删除用户记录，完成后关闭连接。重复初始化不清空资料。M1 使用同一固定名称连接进行事务 CRUD，每次事务完成或失败后关闭连接，schema/记录版本仍为 1。
- 没有接受数据库名称的接口；测试只能注入 IDBFactory。应用只调用固定新版名称的 `open`。
- 旧版 `careertwin`（只读查得 version 3）和 `careertwin-shares` 均未被应用打开、升级或写入；不导入 verified facts、proposals、审核或兼容模型。
- 不兼容或较新版本报错，不通过删除数据库“修复”。初始化失败显示错误与重试，失败不报告就绪。
- IndexedDB 按 origin 与浏览器隔离。开发固定 `http://127.0.0.1:5181`，严格端口；旧 Vite 默认端口为 5173，旧全栈 API 参考端口 3000。构建预览单独用 5182。
- 浏览器清理站点数据会丢失本地资料。跨设备同步未实现；版本化备份导出和恢复属于 M2，M0 不提前定义备份载荷或旧数据迁移协议。

## M1 新增操作决定

- 原生 IndexedDB 读写事务的 complete 事件是唯一成功依据，request success 不足以报告保存成功；abort 会拒绝并保留界面输入。
- 一个新建编辑会话只分配一个 ID。重复点击用同步互斥锁阻止；同 ID、同内容重试在仓库层幂等，不同内容冲突时拒绝。成功后进入编辑模式，另建必须显式切换。
- 新建仅保存名称与原文，元数据默认为空。成功后原文编辑区暂时禁用，补充信息独立更新同一记录；跳过/取消恢复已保存元数据。补充失败保留已存原文与未保存的补充输入。
- 覆盖不自动选目标。覆盖更新当前输入的原文，保留目标元数据；名称留空（含仅空白）时保留目标原名称，填写名称则改名。新建与编辑模式的留空名称仍按原文首行生成。从列表 Edit 或覆盖成功后的编辑模式可显式修改元数据。
- 列表按更新时间倒序，ID 作为同时间的稳定排序项；摘录以 CSS 显示原文前两行，全文保留空白换行。
- 未保存的项目或 Basic Info 切页/切换新建模式需确认；保存进行中阻止应用内切页，同时注册浏览器 beforeunload 提示。
- 浏览器后退/前进同样需确认。每个应用历史记录项在 `history.state.careerTwin1Index` 记录位置；取消时按方向 `history.go` 回到原记录项，不改写其他历史记录，之后确认的后退/前进仍能到达原页面。地址栏直接输入的新 hash 没有位置标记，取消时后退一步返回。同时监听 `popstate` 与 `hashchange`：相同 hash 的记录项之间后退/前进（例如保存后“切换为新建项目”产生的两个 `#/`）只触发 `popstate`，也同步位置；同一次跳转的两个事件只确认一次。
- 删除使用浏览器原生确认，包含名称、单位、年份；取消不写入，失败保留列表项。
- 年份仅接受四位 ASCII 数字，单位去除首尾空白，原文不做去空白或规范化。修改保持创建时间，更新时间至少比旧值晚 1ms。
