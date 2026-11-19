# M2.1 独立验收记录

状态：2026-11-18，真实邮件收信、6 位验证码登录、服务端身份验证、当前用户私有 Profile 读取和刷新恢复均已通过。**完整 M2.1 验收仍待双用户隔离等测试。**

## 功能链与协作

当前目标链路是：账号页发送/验证邮箱验证码 → Supabase Auth → 本地受保护 API 验证身份 → 私有 Postgres 按事务绑定用户 → 账号页显示连接结果。现有 Profile 编辑器仍用本地 IndexedDB，登录不上传或关联本地资料。

Claude 实现，Codex 配置开发资源并独立审查。0013 交接经 0015 ACK，0031 提交实现和 62 文件 SHA-256 清单，指纹 `73ce3c8884c962ec07b1ba9d1b75065f8dd646d4508e2741a8472af1c4016bf0`。Codex 复核时全量哈希一致，原有 domain、repository、编辑器与测试没有越权修改；既有依赖版本没有变化。

## 已实际确认的云端配置

- 独立项目 career-twin1-dev，ref `ducpghchmqtdcvqwifgl`，组织 yongjinjiang's Org，us-west-1，Free / Healthy；其他云项目未改动。
- 初始枚举只有 Supabase 系统表。审查修正后，迁移 `20261108221505_m2_1_private_profile.sql` 应用成功，SHA-256 `22095e2b6789d5882d0d8b8e52b2f2197e2785613c2b5ba41547949c7a3debd7`；已应用文件冻结。
- 实际运行角色 `careertwin1_app` 可登录，不拥有业务表，无超级用户、BYPASSRLS、创建角色/数据库、复制或继承权限，无其他角色成员身份。表属于 postgres，两表均 ENABLE + FORCE RLS，UPDATE 同时有 USING / WITH CHECK。
- anon、authenticated、service_role 均无私有 schema 的 USAGE。匿名 Data API 请求：私有 schema 返回 406/PGRST106，public 表路径返回 404/PGRST205。
- 控制台提供的实际事务池是 `aws-0-us-west-1.pooler.supabase.com:6543`。直接 IPv6 连接不可达；使用控制台官方根证书、verify-full 成功连入，实际 current_user 为受限角色。没有关闭证书校验。
- 无绑定用户时读取为 0；无身份插入和指定不同归属插入均返回 42501；回滚后用户上下文为空。此检查没有创建真实 Auth 身份，不能替代两用户验收。
- Supabase security / performance advisors 均返回空 lints。
- `.env.local` 和私有角色配置被忽略，权限 0600。只有公开 Auth 配置进入浏览器；测试管理员 key 尚未配置。

对应证据在被忽略的 `.agents_context/validation/`：`m2-1-cloud-role-connect.json`、`m2-1-cloud-anon-data-api.json`、`m2-1-cloud-fail-closed.json`。没有密钥值写入本记录。

## 实际检查结果

| 检查 | 执行者 / 结果 | 证明范围 |
| --- | --- | --- |
| `M21_CLOUD_TESTS=0 npm test` | Codex：86 passed，10 skipped | 原 57 项和新增单元 / mock；10 个真实云端测试未执行 |
| `npm run build` | Codex：类型和生产构建通过 | TypeScript、前端打包；未部署 Vercel |
| `npm run check:m2-1-bundle` | Codex：3 文件、1 个实际服务端值，泄漏值 / 模式匹配均为空 | 连接串和已扫描的秘密边界 |
| `npm audit --omit=dev --json` | Codex：运行时通告 0 | 当前运行时依赖；不是全系统安全审计 |
| 原 `scripts/browser-check.mjs` | Codex：以原脚本支持的参数运行隔离 headless Edge，12 场景通过，pageErrors / externalRequests 为空 | 原有 M1 实际浏览器回归 |
| 原 Chrome 浏览器回归 | Claude：首次启动超时，重试后 12 场景通过 | Claude 的实际运行记录，未算作 Codex 亲自运行 Chrome |
| 新账号 Chrome 检查 | Claude：7 类场景通过，Auth / API 全为 stub | 页面、SDK 会话持久化、退出、切号、原 IndexedDB 不变、375px；不证明真实认证 / 邮件 |
| 两个独立恢复竞态探针 | Codex：修复前均失败，修复后均通过 | 较早 getSession 不覆盖更新的切号或退出事件 |
| 实际本地 HTTP | Codex：页面 200；无凭证 / 错项目 / 过期凭证均 401，API no-store | 真实 dev middleware 和拒绝路径；无真实用户的成功路径 |
| 2026-11-18 本机 HTTP 预检 | Codex：页面 200；无凭证 `/api/me` 与 `/api/profile` 均为 401 / missing_token / no-store | 现有 5181 开发服务的页面与身份拒绝边界；未证明已登录访问 |
| 2026-11-18 真实 SMTP 收信 | Codex：账号页发送一次；Gmail INBOX 收到，SPF / DKIM / DMARC 均 pass | 真实 Auth 发码与 SMTP 投递；实际码长 8，尚未验证登录 |
| 2026-11-18 修正云端参数后的真实登录 | 控制台回读为 6 位、600 秒。重发后 Gmail 收到新邮件，账号页显示已登录，服务端成功验证授权邮箱，私有 Profile 返回 0 条记录、版本 0。刷新页面后再次成功 | 真实单用户登录、受保护 API 和刷新恢复 |

日志：`codex-unit-tests-r1.log`、`codex-build-r1.log`、`codex-m1-edge-r1.log`、`codex-runtime-audit.json`、`m2-1-local-http-denials.json`。

11 月 18 日的摘要证据为被忽略的 `.agents_context/validation/m2-1-smtp-live-20261118.json` 与 `m2-1-smtp-send-20261118-1795064556980.jpg`。摘要不保存验证码、密钥、会话或完整邮件。该次只复核相关边界，没有重跑上表既有回归。对 0031 的 62 文件基线复核，仅 AGENTS.md 与三份协调 / 验收文档不同，实现文件未变。

## 已修正的独立审查发现

1. Basic Info 单位 NULL 会以 SQL UNKNOWN 绕过 CHECK，已改为显式非 NULL 比较；真实两用户数据库的该项回归仍待执行。
2. 初始化会话恢复可能覆盖较新的认证事件，已加事件代次保护；两个独立探针通过。
3. 无效云端 URL 使模块初始化抛错，已验证配置并安全退回未配置状态，保留本地功能。
4. 非本机数据库缺少 TLS 参数时可能明文连接，已要求 verify-full 或强制验证 CA，并拒绝覆盖参数及重复参数。
5. 云端测试目标原先只核对角色前缀，现核对确切开发项目主机 / 用户；错目标在启动测试前拒绝。
6. generateLink 不足以证明用户由本次测试创建，现先 createUser，记录成功创建的身份，并验证验证码所属 ID。失败创建 / 返回其他 ID 的清理行为有 stub 回归。

## 用户偏好与当前缺口

用户要求避免 Docker。已取消本项目的本地 Supabase 启动流程；没有成功启动过本地 Auth / DB，也没有用其结果算通过。其他应用容器未修改。当前实现和测试不依赖 Docker。

云端尚缺 `M21_TEST_SUPABASE_ADMIN_KEY`，因此支持的 Auth admin 合成身份、真实 OTP 校验、getUser、双用户 RLS 读写删 / owner 重分配、池化连接 A/B 切换和真实退出均未跑；10 个 skipped 不能记为通过。受限角色的部分 live SQL 检查与这些缺口分开记录。

初始验收时控制台确认 custom SMTP 关闭。2026-11-15 用户确认已在 `career-twin1-dev` 保存 Resend SMTP；由于连接工具没有 Auth 配置接口、浏览器控制因工作区符号链接错误无法启动，本次尚未独立回读字段或验证发信。新免费 Supabase 项目使用默认邮件服务时不能修改认证模板，且默认服务仅面向团队地址。[模板限制](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)、[默认服务限制](https://supabase.com/docs/guides/auth/auth-smtp)

用户已购买 GoDaddy 域名 `careertwin1.com`，并提供 Resend `auth.careertwin1.com` 的 Verified / Forge Ready 截图。Codex 公共 DNS 查询确认两条发送 CNAME 的目标及 3600 秒 TTL；Resend 密钥由用户保存到 Mac“密码”App，未提供给 Codex。具体进展和预期 SMTP 字段见 [SMTP 配置方案](m2-1-smtp-plan.md)。

仓库模板与参考配置已复核：`supabase/templates/email-otp.html` 输出 `{{ .Token }}`，参考配置为 6 位、600 秒、重发间隔 60 秒。本地文件不代表云端已应用。11 月 18 日用户确认两个模板已保存；Codex 直接读取再次登录模板，主题、正文和变量正确，首次确认模板尚未独立回读。

11 月 18 日 20:58:39 PST，用户授权的 Gmail 收件箱收到真实邮件，发件人为 `CareerTwin1 Dev <login@auth.careertwin1.com>`，主题正确，邮件验证结果 SPF / DKIM / DMARC 均 pass。**真实 SMTP 投递通过，真实登录未通过验收**：正文实际生成 8 位验证码，但账号页仅允许 6 位。未截短或提交该验证码，未建立会话；核验停在这个配置不一致处。需将云端 Email OTP Length 改为 6，核实有效期 600 秒和重发 60 秒后重新发码。控制台导航后显示空白，Codex 未完成该修改。登录、刷新恢复、退出、重复使用 / 过期、双用户隔离仍待验收。

当晚修正参数后的复测结果见上表。截图保存在本地忽略目录 `.agents_context/validation/`。云端重发间隔、验证码过期或重复使用时的实际行为、真实退出及双用户隔离仍待验证。
