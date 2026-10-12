# Getting Started / 快速开始

OpenH3 is a local-first video agent. The shortest path to a first result is:

1. Check the [system requirements](system-requirements.md).
2. Download the Windows x64 Alpha installer from [GitHub Releases](https://github.com/BHUHD/OpenH3/releases), or follow [source setup](../contributing/development.md). Read the release-specific known issues and checksums; use Releases for manual updates.
3. Configure a conversation provider. The Alpha 2 installer uses the trial gateway when no provider exists; it needs internet access. You can also supply your own provider credentials. Source builds may differ; read the release notes.
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

For troubleshooting, see [SUPPORT.md](../../.github/SUPPORT.md) and the [operator guides](../guides).
