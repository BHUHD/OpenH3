# OpenH3

[English](README.en.md)

[![CI](https://github.com/pigq/OpenH3/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/pigq/OpenH3/actions/workflows/pr-checks.yml) [![License](https://img.shields.io/github/license/pigq/OpenH3)](LICENSE) [![Release](https://img.shields.io/github/v/release/pigq/OpenH3?include_prereleases)](https://github.com/pigq/OpenH3/releases)

> **开箱即用的本地视频 Agent，让视频创作像软件开发一样可对话、可执行、可追踪。**

OpenH3 是一个面向视频创作者、研究者和开发者的本地桌面 Agent 工作台。你只需要用自然语言描述目标，OpenH3 就能理解视频和图片上下文，调用合适的工具，连接本地 H3 / ComfyUI，执行生成、处理和分析，并在对话中展示进度与结果。

OpenH3 优先在本机运行：素材、任务和本地推理过程由你的电脑掌控。安装桌面应用后即可开始使用，Provider、模型和可选的 H3 权重由用户按需配置。

![OpenH3 视频生成演示：从参考图到应用内结果预览](docs/assets/openh3-demo.gif)

一次真实任务：提供参考图和自然语言描述，OpenH3 调用本地视频工作流，显示生成进度，并在对话中预览结果。

| 参考素材 | 应用内结果预览 |
| --- | --- |
| ![OpenH3 参考图](docs/assets/openh3-reference.png) | ![OpenH3 结果预览](docs/assets/openh3-result-preview.png) |

## 核心能力

- **目标驱动的创作流程**：用自然语言描述剪辑、生成、分析和处理目标，Agent 负责拆解步骤并执行。
- **视频与图片上下文**：直接引用本地视频、图片和结果文件，让 Agent 基于真实素材工作。
- **本地 H3 / ComfyUI**：在本地准备运行环境，调用 H3 工作流和 ComfyUI 节点完成视频生成与处理。
- **可见的任务过程**：查看当前节点、进度、耗时和结果；长任务支持取消，重复的内部状态调用会自动折叠。
- **结果预览**：在对话和桌面应用中查看生成的视频、图片及相关文件。
- **Agent 工具调用**：保留通用 Agent 的工具调用能力，可逐步扩展更多视频工具和工作流。

## 你可以这样使用

```text
把这个视频中的人物抠出来，换成一张新的背景图，并导出一个预览视频。

根据这张图片生成一个 5 秒的镜头，保持主体外观一致。

检查这个视频的画面、字幕和音频，列出需要修改的问题。
```

OpenH3 会把任务拆成可观察的执行过程；需要本地模型时，会使用已配置的 H3 / ComfyUI 环境。

## 快速开始

### 下载体验包

| 平台 | 当前状态 | 适合人群 |
| --- | --- | --- |
| Windows 10/11 x64 | Alpha 未签名体验包 | 想直接体验桌面应用的用户 |
| macOS / Linux | 从源码运行 | 开发者和贡献者 |

从 [Releases](https://github.com/pigq/OpenH3/releases) 下载 Windows x64 体验包并安装。公开仓库后的首个安装包会标注为 Alpha；当前包未签名，Windows 可能显示来源提示，不代表正式生产发布。

首次启动后：

1. 配置你自己的 Provider 和模型凭据。
2. 按需启用本地 H3 / ComfyUI，并准备拥有合法使用权的模型、LoRA 和工作流。
3. 新建对话，拖入视频或图片，直接描述任务。

系统要求和首次任务说明见 [`docs/getting-started/`](docs/getting-started/)。

### 从源码运行

```bash
bun install
bun run dev
```

构建 Windows x64 未签名体验包：

```bash
npm run build-win:x64:fast
```

产物位于 `out/`，仅用于 Alpha 体验和测试，不代表正式签名发布包。

## 项目状态

OpenH3 当前处于 Alpha 阶段，重点是验证本地视频 Agent 的核心体验和开源版本的可复现性。以下内容需要用户自行准备或确认授权：

- Provider API Key；
- H3 权重、LoRA、转换后的模型和工作流；
- 可选的 GPU、驱动和本地推理环境。

这些凭据和模型文件不会写入源码、测试、安装包或公开构建。当前 Windows 包为未签名技术预览版。公开安装包前须核实实际随包组件的许可证义务；模型再分发授权仅针对实际分发的文件。签名属于发行者身份与安装信任改进，不是公开源码的前提。Alpha 表示产品成熟度，与是否签名独立。详见[发布范围与要求](docs/openh3/PRODUCT.md#known-release-gaps)。

## 系统要求

- Windows 10/11 x64，或可运行 Bun/Node.js 的 macOS/Linux 开发环境；
- 视频生成工作流通常需要独立 GPU，显存和磁盘空间取决于所选 H3 模型；
- Provider API Key、H3 权重、LoRA、转换文件和工作流由用户自行准备并确认授权；
- 运行前请先阅读 [`docs/getting-started/system-requirements.md`](docs/getting-started/system-requirements.md)。

## 目录结构

```text
packages/desktop/                 Electron 桌面应用
packages/desktop/src/common/      共享模型、API 和对话数据
packages/desktop/src/process/     主进程、媒体任务和 H3 运行时
packages/desktop/src/renderer/    React 界面、对话、预览和设置
scripts/                          构建、审计和 H3 准备脚本
tests/                            单元、DOM、运行时和端到端测试
resources/                        图标、许可证和构建资源
docs/                             用户指南、架构、贡献和发布资料
```

## 开发检查

```bash
node scripts/check-i18n.js
node scripts/open-source-release-audit.js
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

开发规范见 [`AGENTS.md`](AGENTS.md) 和 [`CONTRIBUTING.md`](CONTRIBUTING.md)。OpenH3 产品范围、验证记录和发布门禁见 [`docs/openh3/`](docs/openh3/)。

## 开源与第三方组件

OpenH3 的应用修改部分采用 Apache-2.0，同时保留 AionUi 上游版权、许可证和必要的来源说明。第三方组件和对应源码范围见 [`resources/third-party-licenses/NOTICE.OpenH3.txt`](resources/third-party-licenses/NOTICE.OpenH3.txt) 与 [`resources/third-party-licenses/SOURCE-OFFER.md`](resources/third-party-licenses/SOURCE-OFFER.md)。

模型权重、LoRA、转换文件和工作流不自动获得 Apache-2.0 授权；重新分发前必须单独确认每个文件的来源和授权。

## 文档与社区

- [首次运行指南](docs/getting-started/README.md)
- [演示案例](docs/showcase/README.md)
- [贡献指南](CONTRIBUTING.md)
- [支持与问题排查](SUPPORT.md)
- [安全问题报告](SECURITY.md)

## 链接

- 仓库：[github.com/pigq/OpenH3](https://github.com/pigq/OpenH3)
- 问题反馈：[Issues](https://github.com/pigq/OpenH3/issues)
- 发布版本：[Releases](https://github.com/pigq/OpenH3/releases)

## 致谢

OpenH3 基于 [AionUi](https://github.com/iOfficeAI/AionUi) 开发。上游版权、许可证和适用的修改声明保留在本仓库中；OpenH3 特有的产品改动由 OpenH3 项目维护。
