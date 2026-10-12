# OpenH3

**用对话驱动本地视频创作。** 让 Agent 协同 H3 / ComfyUI，完成任务执行、进度跟踪和结果预览。

[English](docs/readme/README.en.md) · [下载 Alpha](https://github.com/BHUHD/OpenH3/releases) · [使用文档](docs/README.md) · [问题反馈](https://github.com/BHUHD/OpenH3/issues) · [参与贡献](CONTRIBUTING.md)

[![CI](https://github.com/BHUHD/OpenH3/actions/workflows/build-and-release.yml/badge.svg)](https://github.com/BHUHD/OpenH3/actions/workflows/build-and-release.yml)
[![License](https://img.shields.io/github/license/BHUHD/OpenH3)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange)](https://github.com/BHUHD/OpenH3/releases)

![OpenH3：从参考图到本地视频生成与结果预览](docs/assets/openh3-demo.gif)

提供一张参考图，描述想要的镜头，在对话中查看本地工作流的进度与生成结果。

## 开始使用

1. 从 [GitHub Releases](https://github.com/BHUHD/OpenH3/releases) 下载 Windows x64 安装包，阅读该版本的已知问题和校验说明。
2. 启动应用，按[首次运行指南](docs/getting-started/README.md)配置对话模型和本地 H3 / ComfyUI 环境。
3. 拖入参考图，尝试：“根据这张图片生成一个 5 秒镜头，保持主体外观一致，并在完成后预览结果。”

| 平台              | 当前入口                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| Windows 10/11 x64 | 已发布未签名 Alpha 安装包；当前通过 Releases 手动更新                      |
| macOS / Linux     | [源码开发](docs/contributing/development.md)；平台与视频工作流仍需单独验证 |

Alpha 适合体验和反馈。模型权重不随安装包分发，视频生成需要对应的 GPU、驱动、模型和工作流。先阅读[系统要求](docs/getting-started/system-requirements.md)。

## 能做什么

- **以素材开始对话**：引用本地图片、视频与结果文件。
- **执行本地工作流**：让 Agent 调用已配置的 H3 / ComfyUI 工具。
- **观察长任务**：查看当前节点、耗时与进度，按需取消任务。
- **在应用中预览结果**：查看生成的视频、图片和相关文件。

[查看演示](docs/showcase/README.md) · [支持范围与限制](docs/getting-started/product-scope.md)

### 本地与远程

本地视频推理不等于对话全程离线。使用远程 Provider 或 OpenH3 网关时，提示词及任务所需上下文会发送到该服务。Alpha 2 安装包在没有已有 Provider 配置时使用体验网关，仍需联网；你也可以配置自己的 Provider。源码分支与安装包的默认配置可能不同，以对应版本说明为准。

## 从源码运行

先按[开发环境指南](docs/contributing/development.md)安装 Node.js、Bun 和匹配的 AionCore 后端，再在仓库根目录运行：

```bash
bun install --frozen-lockfile
bun run dev
```

| 目录                              | 内容                           |
| --------------------------------- | ------------------------------ |
| [packages/](packages/README.md)   | 桌面应用与可选 WebUI 模块      |
| [services/](services/README.md)   | 可选的独立网关服务             |
| [docs/](docs/README.md)           | 用户指南、架构与贡献文档       |
| [tests/](tests/README.md)         | 自动化测试与有效测试规格       |
| [scripts/](scripts/)              | 构建、开发和验证工具           |
| [resources/](resources/README.md) | 应用图标、安装资源和第三方材料 |

## 参与项目

欢迎提交可复现的问题、使用案例、文档改进与代码贡献。阅读[贡献指南](CONTRIBUTING.md)和[路线图](docs/contributing/roadmap.md)，从一个范围清楚的小问题开始。

[使用支持](.github/SUPPORT.md) · [安全报告](.github/SECURITY.md) · [行为准则](.github/CODE_OF_CONDUCT.md) · [版本记录](CHANGELOG.md)

项目交流 QQ 群：**790631169**（[二维码](docs/assets/openh3-qq-group.png)）。公开问题请优先在 Issues 记录，方便其他用户检索。

## 开源与致谢

OpenH3 基于 [AionUi](https://github.com/iOfficeAI/AionUi) 开发，保留上游版权和来源说明，应用源码采用 [Apache-2.0](LICENSE)。模型、工作流和第三方组件有各自的授权范围，详见[第三方说明](resources/third-party-licenses/NOTICE.OpenH3.txt)与[源码提供说明](resources/third-party-licenses/SOURCE-OFFER.md)。

官方入口为 [BHUHD/OpenH3](https://github.com/BHUHD/OpenH3)；个人仓库中的相同源码以此处的下载、文档与反馈入口为准。
