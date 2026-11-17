# 原生云账号客户端交付

此入口连接原生账号网关，用于登录、钱包、用量和受管模型。它与旧体验供应商的 `OPENH3_GATEWAY_URL` / `OPENH3_DEFAULT_API_KEY` 路径独立。按用户账号收费不能依赖全体客户端共享的内置 Provider key；配置账号入口不需要任何上游 Key、商户密钥或客户端 capability。既有 BYOK 和体验供应商行为保持现状，公发前须核验实际安装包没有携带共享上游钥匙。

## 当前可交付配置

未确定可信 HTTPS 入口时保持以下配置，不填写 LAN HTTP 地址：

```json
{
  "OPENH3_CLOUD_ACCOUNT_ENABLED": "0",
  "OPENH3_CLOUD_ACCOUNT_ENDPOINT": ""
}
```

网关部署并确认 HTTPS 后，把开关改为字符串 `"1"`，endpoint 填经审核的 **HTTPS 基址**；可包含反向代理路径前缀（例如 `https://api.bhhaihuan.com/hhaiapi/`），不含 `/api/openh3`、`/v1`、用户名、密码、查询或 fragment。Core 自行请求 `/api/openh3/*`。域名、证书和网关必须就绪后再启用；只设置客户端变量不能修复网关 `capabilities` 的 404。

正式版和测试版使用同一现有交付入口：

| 场景                                       | 配置位置                                             | 生效方式                                                    |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Windows 本地 `dist:*`                      | 仓库外 `%APPDATA%/OpenH3/distribution-defaults.json` | `scripts/build-with-builder.js` 默认读取                    |
| 指定配置文件                               | `OPENH3_DISTRIBUTION_DEFAULTS_FILE`                  | 指向上述同结构 JSON，可合并现有发行配置                     |
| CI `dist:*`                                | `OPENH3_DISTRIBUTION_DEFAULTS_JSON`                  | 现有 reusable build 从同名仓库 Secret 注入                  |
| 开发、`package` 直调 Vite 或安装包临时验证 | 当前启动/构建进程的上述两个环境变量                  | `package` 不经过发行配置文件 loader；开发启动只使用运行环境 |

显式构建环境变量优先于发行 JSON，包括 `OPENH3_CLOUD_ACCOUNT_ENABLED=0`。生产构建只把非秘密开关和经校验的 HTTPS 基址编入 Electron **main**；图标启动时，main 在启动其 Core 子进程时填充缺省值。运行环境变量再次优先，包括显式 `0` 或空 endpoint。这不会写入 renderer 配置或改动 Core 的 HTTPS、认证、权限、重试规则。无发行配置的源码构建默认关闭。

更换入口或开关会使自动增量构建缓存失效。切换这两个值时正常运行 `dist:*`，不要用 `--skip-vite` 强行打包旧 main。必须随包提供包含账号路由的同版本 Core；仅重建 renderer 不会替换 Core。

`OPENH3_CLOUD_ACCOUNT_ALLOW_LOOPBACK_HTTP=1` 仍仅用于明确的本机开发，不在发行配置白名单内，也不能让 LAN HTTP 成为可信入口。`OPENH3_CLOUD_ACCOUNT_CAPABILITY` 由 main 每次启动生成，仅交给其拥有的 Core；禁止写入 JSON、安装包、日志或 renderer。WebUI 的精确 `OPENH3_CLOUD_ACCOUNT_TRUSTED_ORIGINS` 配置仍在 Core 运行环境管理，桌面发行默认值不为其放宽权限。

## 冷启动与持久化验收

使用专门测试账号、独立客户端资料目录和最终待发布的安装包。以下是环境验收步骤，本说明不代表这些步骤已在公网完成：

1. 在目标客户端机器用正常系统证书信任校验读取已确认入口的 `/api/openh3/capabilities`；确认返回原生网关成功 envelope，且不依赖跳转、证书绕过或代理改写。404 表示该入口尚未提供所需路由。
2. 清除测试启动环境中的上述两个变量，正常安装后从系统图标启动。打开账号入口，确认登录能力来自预期网关；没有配置的包应保持账号未启用。
3. 登录专门测试账号，读取用户、钱包、设备、模型目录，主动选择官方模型。记录账号和本次设备的可见标识、钱包观察时间。若需要推理，使用明确授权的测试额度做一次小请求，核对网关的实际请求和扣减记录。
4. 正常退出全部 OpenH3/Core 进程，保持相同资料目录和加密根；从图标再次启动。确认恢复同一账号/设备、目录及模型选择，钱包与用量通过网关重新读取；再覆盖一次 access token 到期后的刷新与重启。仅有画面截图不能证明凭据已持久化或刷新成功。
5. 退出登录，再次完全退出并从图标启动，确认仍未连接。更换资料目录或 endpoint 属于不同本地/issuer 边界，应重新登录。历史消息来源不授予旧账号或钱包访问权。
6. 用显式运行环境 `OPENH3_CLOUD_ACCOUNT_ENABLED=0` 启动同一包，确认账号关闭；移除覆盖后重启，确认恢复包内缺省值。此步骤检查运维关闭能力，不代表注销远端设备。

持久化来源：`core/crates/openh3-db/migrations/047_cloud_account.sql` 的账号行按 `(owner, issuer)` 绑定，凭据保存在加密载荷中；`core/crates/openh3-system/src/provider/cloud_account/service/mod.rs` 在读取会话时恢复并按需刷新。加密根解析见 `core/crates/openh3-app/src/services/mod.rs`：显式 `OPENH3_ENCRYPTION_SECRET` 优先，否则读取/首次持久化系统用户的加密根。不得每次启动生成新的环境加密密钥；备份、恢复和升级须一并保留资料数据库及对应加密材料，不要输出凭据或加密根来验证。

## 环境负责人须提供

- 经批准的预发布/正式域名、DNS、受信任的 HTTPS 证书及完整链、反向代理路由和可达范围。客户端入口保持 HTTPS 基址及路径前缀；确认对外原生账号 capabilities 成功。
- 网关原生账号启用、邮箱/验证策略、受支持的认证方式和真实注册/恢复邮件通道。凭据及数据库/Redis秘密由服务端部署存储管理。
- 管理员验证的精确模型 ID、协议和工具能力、渠道、价格、额度换算和同步计费策略，以及专用测试账号/额度。模型名不能代替能力证据。
- 真实收费需要单独确定合规、商户、支付方式、金额/币种、额度、回调 HTTPS 地址和对账负责人。客户端配置不启用真实收费，也不提供默认商户或费率；预发布验证从受控测试额度开始。
- 签名/公证、准确源码提交与 Core 来源、安装包校验和、备份恢复与回退责任人。域名/TLS、真实邮件、实际扣费与付款回调、冷启动/升级都须用目标环境验收。

更完整的网关计费与部署约束见 [账号架构](../architecture/cloud-account.md#build-and-deployment-operations)。
