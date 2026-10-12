# Release guide / 发布指南

公开安装包和校验文件放在 [GitHub Releases](https://github.com/BHUHD/OpenH3/releases)，不提交到源码树。

## 当前 Alpha

Windows Alpha 为未签名体验包，当前通过 Releases 手动更新。Alpha 2 发布说明要求下载其显式应用源码 ZIP：自动生成的 Source code 附件不包含该包的全部待同步修复。两个仓库同名旧标签也不是同一提交。保留历史说明，后续版本应修复可追溯关系，不能静默移动已发布标签。

## 下一版本的检查项

1. 将计划发布的修改提交到官方仓库，用新的 tag 标记准确提交。
2. 从干净 checkout 安装锁定依赖，运行 CI 和相关测试，再构建发布包。
3. 分别检查源码与解包产物的凭据、第三方 NOTICE 和源码提供材料。
4. 在独立环境验证安装、首启、一个小任务和升级；记录平台与已知限制。
5. 上传安装包和 SHA256，说明签名状态、更新方式及准确的源码提交。

`scripts/open-source-release-audit.js` 是辅助检查：没有产物时 artifact findings 为零不代表二进制通过检查；固定的许可证 review 项也不是自动计算的未解决数量。

不要修改旧兼容标识或更新源来“统一文案”。更新源迁移必须同时检查主进程、feed、允许域名与安装包元数据。

参考：[CI](ci.md)、[第三方 NOTICE](../../resources/third-party-licenses/NOTICE.OpenH3.txt)、[源码提供说明](../../resources/third-party-licenses/SOURCE-OFFER.md)。
