# M2.1 验证码发信配置方案

状态：2026-11-18，已在开发项目控制台确认验证码长度为 6 位、有效期为 600 秒。用户通过 Gmail 收到新邮件并完成登录，刷新后仍可读取自己的私有 Profile。云端重发间隔仍待核实。

## 资源准备进展（2026-11-15）

- 用户提供的 GoDaddy 订单截图显示 `careertwin1.com` 注册 1 年，域名项目价格 $12.99。
- Resend 中添加 `auth.careertwin1.com`，区域 North Virginia / us-east-1；用户截图显示 Status 为 Verified、Resend Forge 为 Ready。
- 本次控制台生成 1 条 DKIM TXT 与 2 条发送用 CNAME，实际名称为 `resend._domainkey.auth`、`rsend.auth`、`send.auth`。按本次生成的记录配置，不套用旧指南中的 MX / SPF TXT 示例。
- Codex 只读查询公共 DNS，确认 `rsend.auth.careertwin1.com` 指向 `rsend.forge.rmta.net`，`send.auth.careertwin1.com` 指向 `send.forge.rmta.net`，两条 CNAME 的 TTL 均为 3600 秒。目标的 SPF / MX 记录也已查询；这不替代真实 SMTP 收信验收。
- 用户确认已将 Resend API key 保存到 Mac“密码”App；密钥内容未提供给 Codex，权限与域名限制尚未独立核实。
- 用户确认已按下表在 `career-twin1-dev` 保存 SMTP。当前 Supabase 连接工具未提供 Auth 配置接口，浏览器控制又因工作区路径包含符号链接而无法启动，因此 SMTP 字段与保存结果尚未由 Codex 独立回读；不能据此记为 SMTP 实测通过。
- 后续实际测试进展见下节；11 月 15 日的保存确认不单独视为实测通过。

## 真实发信检查（2026-11-18）

- 用户确认分别保存了首次确认和再次登录两个模板。Codex 直接读取再次登录模板，确认主题、正文和 `{{ .Token }}` 与仓库模板一致；首次确认模板仅有用户保存确认。
- 用户明确授权测试收件邮箱。Codex 从本机 `http://127.0.0.1:5181/#/account` 发送一次真实验证码；邮件于 2026-11-18 20:58:39 PST 进入该 Gmail 的 INBOX。
- 发件人为 `CareerTwin1 Dev <login@auth.careertwin1.com>`，主题为 `CareerTwin1 登录验证码`。实际邮件的 SPF、DKIM、DMARC 均为 pass；这次真实投递已通过，未读取或记录 SMTP 密钥。
- 邮件正文实际验证码为 **8 位**，而模板说明与账号页要求 **6 位**。修改模板文字不会改变 Supabase 生成的长度；需在云端 Authentication → Sign In / Providers → Email 中调整 Email OTP Length 为 6，并核实 Email OTP Expiration 为 600 秒。
- 未截短验证码，未提交验证，未建立登录会话。600 秒有效期和 60 秒重发间隔尚未独立回读。云端控制台导航后出现空白，未完成设置修改；不能把本机参考配置视作云端已应用。
- 当晚复测时，Codex 重新打开开发项目的 Email 设置，读到 Email OTP length 为 6，Email OTP expiration 为 600。本机账号页触发重发，Gmail 收件箱出现新邮件，账号页显示已登录。服务端验证了同一邮箱，私有 Profile 返回 0 条记录、版本 0。刷新后两个结果均复现。

## 推荐选择

采用 **Resend Free + Supabase Auth 自定义 SMTP**。验证码仍由 Supabase 生成、验证和管理会话；Resend 只负责把认证邮件送到收件箱，不需要在前端增加邮件 SDK，也不需要自己搭建邮件服务器。

Resend 当前免费事务邮件额度为每月 3,000 封、每日 100 封，可用于小规模开发验证。域名注册费用不包含在此额度中；本方案不启用付费套餐或自动超额计费。[官方价格](https://resend.com/pricing)

官方 Supabase SMTP 接入要求 Resend API key 和已验证域名。本次用户已准备以上资源，且已完成一次真实收信；登录链路仍待通过。[官方接入前提](https://resend.com/docs/send-with-supabase-smtp)

## 需要准备的资源

1. 用户完成 Resend 账号注册和必要验证。
2. 一个可管理 DNS 的域名，优先使用独立发信子域，例如 `auth.example.com`（示例，不是实际资源）。按 Resend 控制台给出的实际记录配置 DKIM/SPF，等状态变为已验证；保留现有邮箱服务的 DNS 记录。[域名验证说明](https://resend.com/docs/add-a-domain)
3. 独立的 `career-twin1-dev-auth` 发信密钥，选择发信权限并限定已验证域名。该密钥只填入 Supabase SMTP 密码栏，不放入前端、仓库或聊天。[密钥与域名权限](https://resend.com/docs/dashboard/api-keys/introduction)
4. 用户明确授权接收验证码的真实测试邮箱。完整双账号收信验收需要两个可区分的邮箱身份。

## Supabase 开发项目的具体配置

只配置 `career-twin1-dev`（`ducpghchmqtdcvqwifgl`）的 [SMTP Settings](https://supabase.com/dashboard/project/ducpghchmqtdcvqwifgl/auth/smtp)：

| 字段 | 设置 |
| --- | --- |
| Enable custom SMTP | 开启 |
| Sender name | `CareerTwin1 Dev` |
| Sender email | `login@auth.careertwin1.com` |
| Host | `smtp.resend.com` |
| Port | `465`，使用隐式 TLS |
| Username | `resend` |
| Password | 该项目专用 Resend 发信 API key |

这些连接参数来自 [Resend Supabase SMTP 官方指南](https://resend.com/docs/send-with-supabase-smtp)；465 的 TLS 方式见 [SMTP 说明](https://resend.com/docs/send-with-smtp)。

SMTP 启用后，在 [Templates](https://supabase.com/dashboard/project/ducpghchmqtdcvqwifgl/auth/templates) 的首次确认和再次登录邮件中使用当前项目的 `supabase/templates/email-otp.html`，显示 `{{ .Token }}`。验证码长度设为 6 位、有效期 600 秒、重发间隔 60 秒，和账号页一致。保留开发期发信限额，并以控制台的实际设置为准。

新建免费 Supabase 项目在默认邮件服务下不能修改认证模板，自有 SMTP 是这条验证码路线的前提；不把默认 magic link 邮件记为验证码交付。[Supabase 变更说明](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)

## 配置后的验收

先使用用户授权的测试邮箱，从本机账号页发送验证码，确认真实邮件到达并能完成登录。检查错误码、过期、重发、重复使用、刷新恢复和本浏览器退出；随后用第二个邮箱检查用户隔离。发送接口成功或 Resend 的投递模拟事件都不能代替实际收信。

数据库双用户隔离还可通过支持的 Auth 管理接口创建专用合成身份、生成验证码来验证；该路径不发送邮件，报告必须与真实 SMTP 验收分开。测试管理员密钥与 Resend 发信密钥用途不同，运行中的 Profile API 继续使用受限数据库角色。

真实 SMTP 收信、单用户登录和刷新恢复已通过。完整 M2.1 的剩余检查见[独立验收记录](m2-1-validation.md)。
