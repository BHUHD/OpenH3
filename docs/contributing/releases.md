# Release guide / 发布指南

公开安装包和校验文件放在主仓库 [GitHub Releases](https://github.com/pigq/OpenH3/releases)，不提交到源码树；`BHUHD/OpenH3` 只作为同一项目的镜像。

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

## 左下角更新入口（下一个客户端版本）

桌面客户端启动后延迟 30 秒静默检查，此后每 6 小时检查；已有下载缓存可先验证并恢复。发现新版本后在设置旁显示更新入口，用户点击才下载，下载完成后确认安装。普通退出不会自动安装。WebUI 不挂载桌面更新控制器。

发布时须验证当前配置更新源能提供匹配版本、平台、架构的元数据与安装包，校验信息必须一致。无兼容安装包时回退到发布页，不显示无效下载操作。安装包回退明确显示“打开安装包”，不承诺自动重启。

验收至少覆盖：无更新、发现更新但不弹窗、下载进度与失败重试、关闭详情保留入口、确认取消不安装、确认后升级、撤回版本后入口消失。单元测试通过不等同于安装包升级成功；仍需独立 Windows 安装环境实测。

### 确认后的静默覆盖安装

正常自动更新调用 `quitAndInstall(true, true)`：Windows 安装器接收 `--updated /S --force-run`，在原安装位置替换程序并重启，不展示安装向导。首次安装仍保留向导；普通退出仍不安装更新。提权安装仍可能出现系统授权窗口。

NSIS 明确配置 `deleteAppDataOnUninstall: false`，保留现有安装 GUID 和用户资料目录，不通过卸载清数据再安装实现更新。自动更新不可用时，完整安装包入口标为“手动安装（备用）”，不冒充自动更新。

回归检查使用已安装的 NsisUpdater 实现验证实际启动参数，并验证停后端后才交接安装器。仍须在独立 Windows 测试用户中，从旧安装包升级至新包，核对配置、数据库、历史记录与文件，不能用单元测试代替此步骤。

### Desktop update source

Desktop updates use only GitHub Releases in `pigq/OpenH3`. Publish the draft release after uploading installers, blockmaps and all platform/architecture `latest*.yml` files. The native GitHub updater reads these manifests; manual checks use the GitHub Releases API and preserve asset download URLs. Drafts are excluded, prereleases require opt-in, and older versions are not installed. GitHub failures can be retried; there is no upstream CDN fallback.

The normal flow is: download in the background → confirm restart and update → silent replacement and restart. Existing configuration and user data are retained. Manual installer fallback remains a separately labelled action.
