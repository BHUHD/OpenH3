# Getting Started / 快速开始

OpenH3 is a local-first video agent. The shortest path to a first result is:

1. Check the [system requirements](system-requirements.md).
2. Follow the [source setup instructions](../contributing/development.md). Public installers have not been uploaded yet; future packages will appear in [GitHub Releases](https://github.com/pigq/OpenH3/releases).
3. Configure your own Provider and model credentials.
4. Prepare an authorized H3 / ComfyUI runtime when the workflow needs local generation.
5. Attach a reference image or video and describe one small task in natural language.

## First task

Start with a short, bounded request such as:

```text
根据这张图片生成一个 5 秒镜头，保持主体外观一致，并在完成后预览结果。
```

Follow the task card while it runs. The card shows the active node, elapsed time, progress, cancellation state, and generated result. Repeated internal status calls are grouped so the conversation remains readable.

## Local runtime

OpenH3 does not ship H3 weights, LoRAs, converted model files, or workflows. Add only files you are authorized to use, then configure their local paths in the desktop application. Provider keys stay in local configuration and must never be committed.

For troubleshooting, see [SUPPORT.md](../../SUPPORT.md) and the [operator guides](../guides/).
