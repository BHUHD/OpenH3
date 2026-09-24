# OpenH3

OpenH3 是一个本地优先的通用视频 Agent，支持视频和图像交互、Agent 工具调用、本地 H3/ComfyUI 执行、任务进度和结果预览。

> **Alpha 提示：** 当前仓库和 Windows 安装包均为未签名技术预览。Provider 凭据由用户自行配置，源码和构建产物不包含 API Key。H3 权重、LoRA、转换文件和工作流在完成逐文件再分发授权前，采用按需下载或用户自备方式。

## 快速开始

```bash
bun install
bun run dev
```

构建 Windows x64 Alpha 安装包：

```bash
npm run build-win:x64:fast
```

安装包输出到 `out/OpenH3-2.2.2-win-x64.exe`，当前未进行数字签名。

## 发布和许可

应用修改部分使用 Apache-2.0，同时保留上游 AionUi 的版权和修改说明。第三方许可证和源码边界见 [`resources/third-party-licenses/NOTICE.OpenH3.txt`](../../resources/third-party-licenses/NOTICE.OpenH3.txt) 与 [`resources/third-party-licenses/SOURCE-OFFER.md`](../../resources/third-party-licenses/SOURCE-OFFER.md)。当前 Alpha 不宣称 GPL 对应源码、完整依赖 NOTICE 或模型/工作流授权已经全部闭环。

## 项目状态

当前项目处于 Alpha 开发阶段。请先阅读 [`docs/PRODUCT.md`](../PRODUCT.md)、[`docs/stage-plan.md`](../stage-plan.md) 和 [`docs/implementation-status.md`](../implementation-status.md)。

OpenH3 基于 AionUi 项目开发；上游版权、许可证和适用 NOTICE 继续保留在仓库中。
