
### 2026-09-23 P0 发布审计首轮

- [x] 新增 scripts/open-source-release-audit.js 和 npm run audit:open-source-release，检查源码、构建产物、Provider bootstrap 和许可证文件。
- [x] 清除本地 out/win-unpacked/resources/video-provider-bootstrap.json 旧体验包残留；本轮审计结果为源码0项凭据、构建产物0项凭据、许可证文件6项。
- [ ] 依赖许可证清单仍需补齐 ComfyUI、第三方节点、H3权重、工作流和运行时版本/来源/再分发边界；当前6项只是仓库可见许可证文件，不代表许可审查完成。
- [ ] 公开构建仍需在打包后执行该审计；体验包注入 Provider Key 的构建入口只能用于内部测试，不能用于公共 Alpha。

### 2026-09-23 OpenH3 品牌资源首轮

- [x] 以 `openh3-mark.svg` 作为唯一品牌源，生成 renderer 登录页 PNG、Linux PNG 和 Windows 多尺寸 ICO。
- [x] Windows electron-builder 的 `resources/app.ico` 引用已补齐；未改 `appId`、协议 scheme、数据目录和更新仓库，保留旧版本升级兼容性。
- [x] 新增 `npm run generate:openh3-icons`，可在换图后重复生成二进制图标资源。
- [ ] macOS `app.icns` 仍需在 macOS 构建机生成并做安装包视觉回归；当前不能宣称全平台图标验收完成。

### 2026-09-23 OpenH3 发布前构建验收

- [x] 已重新执行 `node scripts/generate-openh3-icons.mjs`、发布配置单测（10 passed、1 skipped）、`tsc --noEmit`、`check-i18n.js` 和 `open-source-release-audit.js`；发布审计为 source findings 0、artifact findings 0、license files 6。
- [x] Electron Vite build 通过。Windows x64 fast 构建首次暴露 `@electron/rebuild` v4 不接受 `--platform` 的真实错误，已在 `scripts/rebuildNativeModules.js` 移除该参数并重新验证；原生 `better-sqlite3` prebuild 和二进制检查通过。
- [x] 已生成 OpenH3 未签名体验包 `out/OpenH3-2.2.2-win-x64.exe`（306,594,235 bytes，SHA256=`E65A46FCC4E506ADFBB1AB3161395D48758A0C16E995198C5D89838C2BEE9D44`）。包内 `resources/app.png` 为 OpenH3 图标，`app.asar`、FFmpeg 与 ffprobe 存在；构建产物审计未发现 Provider Key、私有地址或本机路径泄露。
- [ ] 当前仅代表本机自动化构建和包级检查通过，不代表 PC09 或干净机器实机验收；仍需安装/首启、H3 三模式、失败恢复、视觉回归和卸载复验。
- [ ] 包尚未签名，不能描述为正式发布包；macOS ICNS、许可证/权重再分发证明、兼容迁移和公开仓库历史清理仍是公开 Alpha 阻断项。

### 2026-09-23 P0 组件边界盘点

- [x] 已核对自研桌面/媒体/H3 服务、AionCore v0.2.2、ComfyUI 便携运行时、三类内嵌 H3 工作流、自定义节点归档、H3 模型/VAE/文本编码器、FFmpeg/ffprobe、7zr 及 Python/Triton 安装依赖的代码入口和固定来源字段。
- [x] 已确认下载器对模型、节点、运行时和解压器执行固定 URL/revision/大小/SHA256 或 SHA512 校验；失败不会静默替换为未校验文件。
- [ ] 许可证和再分发证明尚未完成：当前仓库可见许可证文件数量不能代表 ComfyUI、第三方节点、H3 权重、工作流、FFmpeg 和运行时均可公开分发。
- [ ] H3 融合/量化权重所含 Turbo LoRA、Mystic LoRA 和转换文件尚未取得独立授权证明；MiniMax 原始模型许可不能自动覆盖这些衍生文件。
- [ ] 仍需补齐组件清单中的版本、来源、许可证原文、NOTICE、再分发范围和公开包处理方式；完成前不把模型或运行时放入公开基础安装包，也不宣称完整开源合规。

当前开源路线下一步：先完成组件许可与权利证明台账，再设计 AionUi 旧身份到 OpenH3 的兼容迁移；保持现有 `appId`、`aionui://`、数据目录和更新仓库不变。H3 基础能力已完成，SLA 实机矩阵属于独立的性能质量支线。

### 2026-09-23 发布审计范围修正

- [x] `scripts/open-source-release-audit.js` 已从仅扫描 Git 已跟踪文件改为扫描“已跟踪 + 未被 `.gitignore` 排除的工作树文件”，覆盖当前尚未提交的 H3/媒体源码。
- [x] 修正后重新执行审计：Source findings 0、Artifact findings 0、License files 6；releasePackagingConfig 为 10 passed、1 skipped，TypeScript 检查通过。
- [ ] 这仍只是凭据/构建产物门禁，不代表模型、ComfyUI、第三方节点、FFmpeg、工作流或运行时的许可证和再分发授权已完成。

### 2026-09-23 许可证台账推进

- [x] 已从最终 Windows 资源目录核对 FFmpeg/ffprobe 的实际资产：`7.1.1-essentials_build-www.gyan.dev`、GPL v3、FFmpeg commit `db69d06eee`，并确认包内包含 `resources/ffmpeg/win32-x64/LICENSE` 与 `README.txt`。
- [x] 已修正发布判断：当前 FFmpeg 二进制是 GPL v3 构建，后续发布资料不得笼统标注为 LGPL；仍需补源码提供方式、编解码器配置和 NOTICE。
- [ ] ComfyUI portable 和三个自定义节点仍需逐 commit 获取许可证/NOTICE 并确认随安装器再分发边界。
- [x] 固定版本许可证已核实：ComfyUI v0.35.0 GPL-3.0；MAINodes commit `f4868b4a08e8a504ce86db54a17961d399ffa2bc` GPL-3.0-or-later；PlagueKind sparse commit `fd26ffb89dee294ca740a59632e5b3423b9a9d2a` MIT；KJNodes commit `d3cfe21625e5170126ce06fbfc1e88108688c3` GPL-3.0。
- [ ] 需保存上述固定 revision 的许可证文本副本和 NOTICE；MAINodes/KJNodes 的 GPL 源码提供及分发边界仍待核对，PlagueKind fork 中继承/引入的代码需追溯来源许可。许可证标签已识别，不代表随包分发已获法律审核通过。
- [ ] H3 INT8、VAE、Qwen3-VL、Turbo/Mystic LoRA 和转换权重仍没有逐文件授权证明；继续采用用户确认后下载或用户自备策略，不将其标记为 OpenH3 Apache-2.0 内容。
- [x] AionCore v0.2.2 的下载 URL/版本已固定，公开上游许可证已定位为 Apache-2.0；当前 bundled 资源目录仍需补齐随包许可证/NOTICE 副本。
- [ ] 7-Zip、Node 运行时及 npm/bun 依赖尚未形成发布版第三方 NOTICE 集合；根目录 Apache-2.0 不覆盖这些组件。

### 2026-09-23 固定版本许可证证据索引

- [x] 已记录固定 revision 的许可证来源：ComfyUI v0.35.0 `https://github.com/Comfy-Org/ComfyUI/blob/v0.35.0/LICENSE`；MAINodes `f4868b4a08e8a504ce86db54a17961d399ffa2bc`；PlagueKind sparse `fd26ffb89dee294ca740a59632e5b3423b9a9d2a`；KJNodes `d3cfe21625e5170126ce06fbfcfe1d88108688c3`。
- [ ] 发布资料仍需保存这些 revision 对应的 LICENSE/NOTICE 原文，并为 GPL 组件准备源码获取方式；当前只有来源索引，不代表发布包已经完成合规资料。
- [x] 发布审计现在将固定组件的许可证资料缺口写入 `.runtime/open-source-release-audit.json` 并单独输出 `License evidence gaps`，与凭据/构建产物 findings 分开统计。
- [x] 已保存四个固定 revision 的 LICENSE 原文到 `resources/third-party-licenses/`，审计报告新增 `licenseEvidencePresent` 列表。
- [ ] GPL 对应源码提供方案、PlagueKind fork 继承代码 NOTICE、7-Zip/Node/npm 依赖清单及 H3 权重逐文件授权仍未完成。

### 2026-09-23 OpenH3 可见品牌迁移第一阶段

- [x] `package.json`、桌面包描述、electron-builder 产品名、Linux 菜单项、托盘提示和内置浏览器用户提示已使用 OpenH3。
- [x] 所有 locale 中的用户可见产品名称已更新为 OpenH3；`generate-i18n-types.js` 和 `check-i18n.js` 已通过。
- [x] 未改动 `appId: com.aionui.app`、`aionui://`、`executableName: AionUi`、`AIONUI_*` 环境变量、旧数据目录和更新仓库，以维持现有安装升级、协议唤起和运行时配置兼容。
- [x] 上游 AionUi 版权/来源说明以及旧身份的内部迁移标识保留，避免把来源归属误写成 OpenH3 或破坏兼容读取。
- [ ] 当前仍需完成组件许可和再分发权利台账；完整身份切换必须另行设计迁移、回滚和旧版本升级测试。
- [ ] 当前 Windows 包仍是未签名体验包，不是正式发布包；PC09/干净机器实机验收、签名和全平台包仍按发布门禁执行。

### 2026-09-23 许可证清单复核

- [x] 根项目继续使用 Apache-2.0，且保留根 `LICENSE` 的 AionUi 上游版权归属；没有把上游版权盲改为 OpenH3。
- [x] 四个私有 workspace package 已补 `license: Apache-2.0`，并增加回归测试；公开仓库尚未确认，因此未伪造 `repository` 字段。
- [x] 运行资产来源已逐项核对：AionCore v0.2.2、ComfyUI portable v0.35.0、MAINodes/PlagueKind/KJNodes 固定 commit、MATLOWAI/GuangyuanSD/Comfy-Org 模型固定 revision 和 SHA256。
- [x] FFmpeg 7.1.1 essentials 的 GPL v3、源码 commit `db69d06eee`、构建配置、LICENSE/README 已随 Windows 资源保留。
- [x] FastH3 Preview 当前只有 model repo/revision，未记录 license metadata；内嵌 workflow 也只有模板来源线索，不能据此宣称可公开再分发。
- [ ] 许可证/NOTICE 和再分发授权台账仍未完成，缺口包括 ComfyUI/三个节点/H3 权重及衍生 LoRA/工作流/7zr/AionCore/Node/字体图标和逐包 npm/bun 依赖。
- [ ] 当前许可结论只能支持“固定来源、按需下载并校验”的 Alpha 策略，不能支持将模型和运行时并入 OpenH3 Apache-2.0 基础包。

### 2026-09-23 Windows Alpha 包最终复验

- [x] `packages/desktop/electron-builder.yml` 已把 `resources/third-party-licenses` 纳入 `extraResources`；避免许可证只存在源码目录而不进入安装包。
- [x] 发布配置回归为 12 passed、1 skipped；TypeScript 检查通过。
- [x] 标准 `npm run build-win:x64` 构建通过；主程序 `AionUi.exe` 的 ProductName 和 FileDescription 均为 OpenH3，旧可执行文件名仅作为升级兼容标识保留。
- [x] 最终包：`out/OpenH3-2.2.2-win-x64.exe`，237,863,449 bytes，SHA256 `D2027732E9F2FAB2C67F55021DAD636B720526DA20236260F3713328590DC290`。
- [x] 包内存在 `app.asar`、OpenH3 图标、AionCore/Node、FFmpeg/ffprobe、FFmpeg GPL LICENSE/README、ComfyUI v0.35.0/三个节点许可证原文和 `NOTICE.OpenH3.txt`；未包含 Provider bootstrap。
- [x] 发布审计最新结果：Source findings 0、Artifact findings 0、License files 16、License evidence gaps 6。
- [ ] 当前包的安装器和主程序均为 `NotSigned`；没有证书时只能作为未签名 Alpha 体验包，不能宣称已解决 Windows 安全软件拦截。
- [ ] 未完成项保持不变：PC09/干净机器实机验收、H3 三模式和失败恢复、GPL 对应源码提供、7-Zip/Node/npm/bun NOTICE、H3 权重及衍生文件授权、macOS ICNS、身份兼容迁移。


### 2026-09-23 个人/团队名义 Alpha 发布准备

- [x] 暂不绑定公司主体、组织仓库、商标或域名；当前只准备技术预览版发布资料。
- [x] Windows 安装包会随包携带已核对的 ComfyUI/节点许可证原文；模型权重、衍生 LoRA 和 Provider Key 不写入源码或基础安装包。
- [x] 已新增 `resources/third-party-licenses/NOTICE.OpenH3.txt`，列出固定运行时、节点、FFmpeg、AionCore 和模型/工作流的发布边界；它是技术清单，不是未取得权利的授权声明。
- [x] 首次启动继续采用按需下载、固定哈希校验和用户确认条款；对话 Provider 由用户自行配置。
- [ ] 仍需在发布页面明确 Alpha、未签名、支持范围、已知限制和反馈入口；未完成前不要称为正式稳定版。
- [ ] 仍需补 GPL 对应源码提供方式、7-Zip/Node/npm/bun NOTICE 和 H3 权重逐文件授权；这些不因暂不绑定公司身份而消失。
- [x] 已整理 README Alpha 入口、`NOTICE.OpenH3.txt` 和 `SOURCE-OFFER.md`；当前只完成本地推送前检查，未向远端推送。
- [ ] 当前 Git remote 仍指向上游 AionUi 仓库；确认新的 OpenH3 GitHub 仓库地址后再配置 remote 和执行 push。

### 2026-09-24 H3 聊天状态展示收口

- [x] 移除“超过 1 分钟未收到新进度，暂时无法判断是否卡住”和取消行为长提示；长节点计算只保留当前任务状态和耗时。
- [x] 连续 `aionui_h3_job_status` 调用在工具步骤摘要中合并为单条视频任务记录，并显示更新次数；内部兼容 ID 不再作为用户可见节点名称。
- [x] 保留任务卡中的最新节点进度、生成耗时、取消生成和最终视频结果；新增 DOM 回归测试覆盖重复状态折叠与旧名称隐藏。

### 2026-09-24 Windows Alpha 包刷新

- [x] 已重新构建 `out/OpenH3-2.2.2-win-x64.exe`，306,612,247 bytes，SHA256=`C4145E75C20075DCAA43F60CE9420BD92386E7F3690E3EE8D8648D1721D11152`。
- [x] 安装包内 `resources/app.asar`、`resources/app.png` 和 `resources/third-party-licenses/NOTICE.OpenH3.txt` 均存在；`open-source-release-audit.js` 结果为 Source findings 0、Artifact findings 0。
- [x] 本包包含 H3 聊天状态展示修复和对应 DOM 测试；重复状态调用折叠，用户界面不再显示内部 `aionui_*` 节点名或过时卡住提示。
- [ ] 仍为未签名 Alpha 体验包，不是正式发布包；许可证证据缺口 6 项、GPL 源码提供、H3/LoRA/工作流逐文件授权、干净机器验收和 Windows 签名仍需单独闭环。

### 2026-09-24 GitHub 仓库公开前清理

- [x] 已新增 `openh3` remote 指向 `https://github.com/pigq/OpenH3.git`，原 `origin` 上游地址保留；本轮没有执行 push。
- [x] 已把根 README 改为 OpenH3 Alpha 项目说明，公开入口不再指向上游下载、发行版或社区活动；保留必要的 AionUi 来源归属。
- [x] 已将 `.runtime/` 和临时审计运行目录加入 `.gitignore`，避免本机缓存、模型状态和审计 JSON 进入公开提交。
- [ ] 首次公开提交仍需人工逐项审查当前大量 modified/untracked 文件；不得使用未经筛选的 `git add .`。
- [x] 首次提交审查已发现本地 FFmpeg 可执行文件约 174 MB，已加入 `.gitignore`；许可证和 README 会进入源码仓库，二进制应作为单独构建/发布资源处理，避免误提交大文件。
- [ ] 新仓库 `main` 已有独立 `LICENSE` 初始提交；首次推送前仍需保留该许可证并合并本地源码历史，不能直接强制覆盖远端。

### 2026-09-24 公共仓库内容清理

- [x] 删除不参与 OpenH3 运行和构建的上游协作目录 `.aionui/`、`.gemini/` 和 `.claude/commands/`。
- [x] 删除未再被 OpenH3 README 引用、且仍包含旧 AionUi 营销内容的旧多语言 README；保留整理后的中文入口。
- [x] 保留 `tests/`、`.claude/skills/`、源码、构建脚本和许可证文件；测试目录是开源复现验证所需内容，`.claude/skills/` 仍被项目开发规范引用。
