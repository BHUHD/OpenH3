# 首次运行 / Getting started

[中文首页](../../README.md) · [English overview](../readme/README.en.md)

## 1. 安装应用

先阅读[系统要求](system-requirements.md)。Windows x64 用户从 [Releases](https://github.com/BHUHD/OpenH3/releases) 下载 Alpha 安装包，核对版本说明和 SHA256；当前通过 Releases 手动更新。开发者使用[源码环境指南](../contributing/development.md)。

## 2. 准备对话模型

Alpha 2 安装包在没有已有 Provider 时使用体验网关，需要联网；已有配置不会被覆盖。也可以配置自己的 Provider 和凭据。源码构建与发行包默认配置可能不同，以所用版本的发布说明为准。

先发送一个简短文本问题，确认对话模型可以响应。对话成功不代表本地视频环境已经准备好。

## 3. 准备本地视频环境

在设置中打开 **H3 视频环境**：

1. 查看机器环境与可用磁盘空间，选择环境目录。
2. 阅读页面提供的模型与运行时条款，确认适用条件，再使用“下载并安装”；已有离线文件时使用“校验并安装 / 重试”。
3. 等待下载、校验与解压完成，使用“重新检测”查看模型和节点状态。
4. 使用“生成测试视频”检查实际执行；当前内置测试标示为 4 秒 / 0.2MP。只有看到任务成功及可预览结果，才说明这次测试完成。

安装包不包含模型权重；环境准备会另行下载模型与依赖。界面识别出文件、显示节点齐全，均不等同于真实推理成功。实验硬件应按页面提示单独验证。

## 4. 尝试一个小任务

新建对话，拖入自己的参考图，再输入：

```text
根据这张图片生成一个短镜头，保持主体外观一致，并在完成后预览结果。
```

在任务卡中观察当前节点、耗时和状态。生成完成后打开视频预览，检查画面与时长是否符合实际工作流。任务时长、分辨率和耗时由模型、硬件及所选工作流决定，不能仅靠提示词保证。

## 遇到问题

| 现象               | 先检查                                       |
| ------------------ | -------------------------------------------- |
| 对话无法响应       | Provider 配置、凭据和网络；网关也需要联网    |
| 下载中断或磁盘不足 | 环境目录空间和下载状态，按页面提示继续或重试 |
| 模型或节点缺失     | H3 视频环境中的检测结果和具体缺失项          |
| 文件齐全但生成失败 | 实际错误信息、GPU/驱动与配方支持情况         |
| 需要报告问题       | 应用版本、系统、GPU、任务阶段和脱敏日志      |

不要把 API Key、私人素材或完整个人路径发到公开 Issue。参见[支持入口](../../.github/SUPPORT.md)。

## English quick path

Download the Windows Alpha from Releases, or follow the source development guide. Verify that your conversation provider responds first. In **H3 video environment**, select storage, review the model/runtime terms, install or verify the environment, inspect missing models/nodes, and run the built-in test video. Successful setup detection is not proof of successful inference: confirm that the test completes with a playable result. Then attach a reference image in a conversation and request a short shot. Consult the troubleshooting table and Support link above when a step fails.
