# M2.1 实施边界与验收

状态：用户已明确授权 M2.1；Codex 协调和独立审查，Claude 实现。M2.2、M2.3 和正式部署均未授权。

## 授权依据与目标

用户原话：“好，先按计划实施 M2.1，继续和 Claude Code 协作，你负责协调和独立审查，Claude 负责实现。先完成登录、云端数据库和用户隔离，暂时不进入后续阶段或正式部署。”

本次只交付邮箱验证码登录/退出/会话恢复、独立开发数据库及私有数据访问边界。受保护的最小 API 与真实数据库隔离测试是 M2.1 的验收对象；把全部 Profile 表单切到云端、版本/去重写入、资料迁入和备份恢复仍分别属于 M2.2/M2.3。

## 开发资源

- Supabase 项目：career-twin1-dev；ref：ducpghchmqtdcvqwifgl；组织：yongjinjiang's Org（dbrtdvedhwhjvihtpaap），由用户明确选择。
- 区域：us-west-1。创建返回 ACTIVE_HEALTHY。
- 不访问或修改旧 career-twin、Quantum Cloister、Starwish Cottage 等其他云项目。
- 不创建或部署 Vercel 网站，不启用付费升级；当前 API 可在本地运行。
- Codex 负责开发云资源配置、审查并执行 Claude 提交的迁移、独立验收；Claude 不自行改远程资源。
- 2026-11-08 用户要求避免使用 Docker：本阶段改用独立云端开发项目验证真实认证和数据库，不把 Docker 或本地 Supabase 作为运行或验收前提。云端邮件仍需有效 SMTP；合成用户、管理员生成验证码与真实邮件投递的证据分别记录。

## 页面与数据边界

保留 M1 本地功能、现有路由和 careertwin1-profile 数据。M2.1 通过独立账号/连接验证页面提供登录能力（建议 #/account），清楚标明当前本地 Profile 尚未同步。不要让已登录账号旁边的本地资料看起来已经归属该云端账号；登录不能触发上传、迁移或删除本地资料。

账号页支持：发送验证码、输入验证码验证、重发限制/过期/错误反馈、当前账号、退出、会话恢复及受保护 API 的连接状态。配置缺失时给出清楚状态，现有本地 Profile 仍可使用。退出和账号变化时清空账号页的云端结果，旧请求的迟到响应不能显示在新账号下。

邮箱验证码需修改正确邮件模板并验证发信；不要把 signInWithOtp 默认魔法链接当作已经实现验证码。当前按用户偏好不使用 Docker：SMTP 缺失时可用受支持的 Auth 管理接口创建合成身份并验证生成的验证码，但这不证明真实邮件投递成功，必须把云端邮件实测缺口单列。不得向无授权的真实邮箱群发测试。

## 最小后端

- TypeScript 认证/数据库逻辑，供本地开发服务与 Vercel API 入口共同调用，保持现有 React/Vite 工程。
- 建议受保护的 GET /api/me 和 GET /api/profile（或等价只读连接/私有记录读取入口）。前者返回已验证账号，后者仅查询该用户数据。不要提前完成云端项目 CRUD 或把现有编辑器接入云端。
- 每个请求验证 Supabase 身份，不能仅解码 JWT 或信任客户端 userId、owner、user_metadata 或 getSession 的未验证值。
- 业务记录置于未公开 schema，浏览器的 anon/authenticated Data API 路径不得绕过后端。普通请求用非 owner、无 BYPASSRLS 的最小权限数据库角色。
- 事务内绑定已验证 user ID，使用参数化 SQL；提交/回滚后不得残留用户上下文。RLS 缺少用户上下文时应拒绝/不返回记录。
- 数据库验证读、插入、更新和删除隔离；UPDATE USING 与 WITH CHECK 均须保护 owner，不能重新分配记录给他人。
- 准备 Profile 状态和记录表，记录身份用 (owner_id, id)，basic_info 每用户唯一。保持原有 record type / text / metadata 契约。版本字段可先有默认值，完整 CAS 与操作去重实现留到 M2.2。
- 不建立公开测试写入入口、测试万能令牌或浏览器 service_role。连接串、应用角色密码及管理员凭据均只在被忽略的服务端配置中；日志和构建产物不得含秘密或个人原文。

## 单写归属

Codex 只修改协调文件、阶段/验收文档和独立开发资源配置，不编写实现源代码。Claude 在编号 ACK 后独占以下实现范围：

- 新建 src/auth/**、src/components/AccountPage.tsx、server/**、api/**、supabase/**、tests/m2-1/**。
- 必要修改 src/App.tsx、src/main.tsx、src/styles.css、package.json、package-lock.json、tsconfig.json、vite.config.ts。
- 新建 scripts/dev-api.*、scripts/check-m2-1-*、scripts/test-m2-1-*、.env.example、docs/m2-1-setup.md。
- 原有 Profile 编辑器、local repository、M1 浏览器脚本和其他既有测试保持只读；若确需额外文件，先在编号消息中提出。
- Codex 负责 docs/m2-1-scope-and-acceptance.md、docs/m2-1-validation.md、阶段状态文档、.agents_context/** 和 .env.local 等实际私有运行配置。Claude 可读取运行配置用于测试，但不得输出秘密。
- 仅安装必要、固定版本的依赖；不得自动提交 Git、push、合并或部署。

迁移先由 Claude 写成可审查 SQL 与配置说明，Code 独立审查后才在唯一开发项目执行。CLI 命令先查 --help；按本机实际工具准备环境，不把 mock 数据库当作真实 RLS 证明。

## 必需验证

- [ ] 验证码登录、失败/过期、退出及刷新后会话恢复；登录错误不能显示成功。
- [ ] 账号 A/B 切换与迟到响应不会串用资料；本地 Profile 未被上传或改动。
- [ ] 无/伪造/过期/错项目凭证被 API 拒绝；请求中的 owner 不改变查询范围。
- [ ] 两个合成测试身份分别只能读取自己的数据；真实 Postgres 角色/RLS 对跨用户的读写删和 owner 重分配均有效。
- [ ] 无用户上下文时失败关闭；复用同一连接先 A 再 B、以及事务回滚后不泄漏身份。
- [ ] 私有 schema 和 Data API 边界实际验证，运行角色确实非 owner 且无 BYPASSRLS。
- [ ] 前端构建无数据库密码/服务端密钥；认证配置缺失时安全失败。
- [ ] 原 57 项测试及 12 场景浏览器回归、类型与构建通过；增加必要的 API、数据库和账号 UI 测试。
- [ ] 实际执行结果分清：单元/mock、真实浏览器加 stub、独立云开发库 / Auth、云端真实邮件，各自哪些通过、哪些受环境阻碍；不要求本地 Supabase。

任何关键实测未完成都不能标记 M2.1 全部通过。完成本阶段后停止，不自动进入 M2.2/M2.3。无需为已授权范围的常规修复再次向用户确认。
