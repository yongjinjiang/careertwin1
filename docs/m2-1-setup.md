# M2.1 配置与检查说明

本文件说明 M2.1（登录、私有开发数据库、用户隔离）的配置与检查方式。验收状态见 `docs/m2-1-scope-and-acceptance.md` 与 Codex 维护的验证记录，本文件不代表任何一项已通过。M2.2、M2.3 与正式部署均未授权。

## 环境变量

把 `.env.example` 复制为 `.env.local`（被 Git 忽略）。真实值不进入源码或聊天。

| 变量 | 位置 | 说明 |
| --- | --- | --- |
| `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY` | 浏览器 | 仅公开值。缺失或 URL 无效时账号页显示“未配置”，本地 Profile 正常可用 |
| `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` | 服务端 | 用于向 Supabase Auth 验证令牌；签发者固定为 `<SUPABASE_URL>/auth/v1` |
| `CAREERTWIN1_DATABASE_URL` | 服务端 | 仅限受限运行角色 `careertwin1_app`，不得使用 `postgres` 或 `service_role` |
| `CAREERTWIN1_DATABASE_CA` | 服务端，可选 | 数据库 CA 的 PEM（可用字面量 `\n`）。设置后强制校验证书 |
| `M21_TEST_SUPABASE_ADMIN_KEY` | 仅云端检查 | 只用于创建和删除合成测试账号，运行中的 API 不读取 |

非本机数据库必须使用经过验证的 TLS：连接串带 `sslmode=verify-full`，或不带 `sslmode` 并设置 `CAREERTWIN1_DATABASE_CA`。缺少 TLS 选项、较弱的 `sslmode`，以及 `sslmode`、`sslrootcert` 以外的查询参数都会被视为配置无效，API 返回 503。

## 本地运行

`npm run dev` 同时提供页面和 `/api/*`（`http://127.0.0.1:5181`），API 与 Vercel 入口 `api/*.ts` 共用 `server/api.ts`。本阶段不创建或部署 Vercel 项目，也不需要 Docker。

- `GET /api/me`：返回已验证账号。
- `GET /api/profile`：只读返回该账号自己的私有记录。请求中的 owner/user 类参数返回 400。

## 登录与会话

账号页 `#/account` 使用邮箱验证码：`signInWithOtp` 发送、`verifyOtp`（`type: 'email'`）验证。登录与退出不读写本地 IndexedDB，也不上传本地资料。

邮件模板必须输出 `{{ .Token }}`，否则用户收到的是魔法链接而不是验证码。模板样例见 `supabase/templates/email-otp.html`，需要同时用于 Magic Link 与 Confirm signup。云端模板和自有 SMTP 由 Codex 配置；未配置前云端验证码登录不算通过。

退出使用 `signOut({ scope: 'local' })`，只结束当前浏览器的会话，并撤销该会话的 refresh token。根据 Supabase 文档，已签发的 access token 在到期前仍可能有效（默认 1 小时）；浏览器在退出后会丢弃它。若需要立即吊销，需另行提出方案。

## 数据库

迁移 `supabase/migrations/20261108221505_m2_1_private_profile.sql` 已由 Codex 审查并应用到唯一开发项目，**不得再修改**，后续变更必须新增并经审查的 forward migration。

私有 schema `careertwin1_private` 不进入 Data API。运行角色 `careertwin1_app` 不拥有表、无 BYPASSRLS；角色的 LOGIN 与密码在迁移之外单独配置。每个请求在事务内执行 `set_config('app.user_id', <已验证 UUID>, true)`，提交或回滚后自动失效，无绑定时读不到也写不了任何记录。

`supabase/config.toml` 是本机 Supabase 的配置，保留用于参考；按当前决定不使用 Docker 或本机 Supabase。

## 检查命令

| 命令 | 真实程度 |
| --- | --- |
| `npm run typecheck`、`npm test`、`npm run build` | 单元/mock。`tests/m2-1/api.unit`、`account`、`cloud-target` 不连接云端；云端套件未启用时显示为 skipped，skip 不等于通过 |
| `npm run check:browser` | 真实 Chrome，M1 的本地回归 |
| `npm run check:m2-1-browser` | 真实 Chrome 和 supabase-js，但 **Auth 与 `/api/*` 全部为 stub**，不发邮件、不连云端。证明界面、会话持久化和本地隔离，不证明真实 Auth |
| `npm run check:m2-1-bundle` | 构建后扫描 `dist/`，确认没有服务端值或密钥形态字符串。只输出变量名 |
| `M21_CLOUD_TESTS=1 npm run test:m2-1-cloud` | **写入云端开发项目**，由 Codex 审查并执行 |

### 云端检查的边界

`scripts/test-m2-1-cloud.mjs` 和套件本身都会先核对：显式启用、`SUPABASE_URL` 为开发项目 `ducpghchmqtdcvqwifgl`、数据库主机与用户完全匹配（`aws-0-us-west-1.pooler.supabase.com` + `careertwin1_app.ducpghchmqtdcvqwifgl`，或 `db.ducpghchmqtdcvqwifgl.supabase.co` + `careertwin1_app`）。任一不符都在创建客户端或测试账号之前失败。启用后配置缺失是失败，不是跳过。

测试账号通过 Auth admin 方法创建，默认邮箱域名 `careertwin1.test`（可用 `M21_TEST_EMAIL_DOMAIN` 覆盖），结束时只删除本次运行创建的账号。套件使用 **admin 生成的验证码，不发送邮件**，因此不能证明 SMTP 或真实收信。退出后旧 access token 的实际状态只记录在输出中，不作断言。
