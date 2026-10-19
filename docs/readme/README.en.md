# OpenH3

**Create local AI video through conversation.** Let an agent orchestrate H3 / ComfyUI, track execution, and preview the result.

[简体中文](../../README.md) · [Download Alpha](https://github.com/BHUHD/OpenH3/releases) · [Documentation](../README.md) · [Issues](https://github.com/BHUHD/OpenH3/issues) · [Contribute](../../CONTRIBUTING.md)

![A reference image becomes a video inside OpenH3](../assets/openh3-demo.gif)

## Get started

1. Download the Windows x64 installer from [Releases](https://github.com/BHUHD/OpenH3/releases). Read the version-specific checksums and known issues.
2. Follow [Getting started](../getting-started/README.md) to set up a conversation provider and the local H3 / ComfyUI runtime.
3. Attach an image and ask: “Generate a five-second shot from this image, preserve the subject, and preview the result.”

| Platform          | Availability                                                              |
| ----------------- | ------------------------------------------------------------------------- |
| Windows 10/11 x64 | Unsigned Alpha installer; update manually through Releases                |
| macOS / Linux     | Source development; platform and video workflows need separate validation |

Model weights are not bundled. Check the [system requirements](../getting-started/system-requirements.md) before preparing the GPU, drivers, models, and workflow.

## Capabilities

- Reference local images, videos, and generated files in a conversation.
- Run configured H3 / ComfyUI tools through the agent.
- Inspect active nodes, elapsed time, progress, and cancellation.
- Preview generated media in the desktop workspace.

[Showcase](../showcase/README.md) · [Scope and limitations](../getting-started/product-scope.md)

Local inference does not mean the entire conversation is offline. Remote providers and the OpenH3 gateway receive prompts and the context needed for a request. The Alpha 2 installer defaults to the trial gateway when no provider is configured and requires internet access. You can configure your own provider. Source builds and released installers may have different defaults; consult their release notes.

## Develop

Install Node.js, Bun, and the matching OpenH3 Core backend using the [development guide](../contributing/development.md), then run in the repository root:

```bash
bun install --frozen-lockfile
bun run dev
```

See the [package map](../../packages/README.md), [architecture](../architecture/overview.md), [test guide](../../tests/README.md), and [roadmap](../contributing/roadmap.md).

## Community and license

Contribute reproducible bug reports, examples, documentation, or focused code changes. See [Contributing](../../CONTRIBUTING.md), [Support](../../.github/SUPPORT.md), [Security](../../.github/SECURITY.md), and the [Code of conduct](../../.github/CODE_OF_CONDUCT.md).

QQ community: **790631169** ([QR code](../assets/openh3-qq-group.png)). Use public Issues for searchable troubleshooting.

OpenH3 builds on [AionUi](https://github.com/iOfficeAI/AionUi), preserving upstream attribution. Application source uses [Apache-2.0](../../LICENSE); third-party components, models, and workflows have their own terms. Read the [notices](../../resources/third-party-licenses/NOTICE.OpenH3.txt) and [source offer](../../resources/third-party-licenses/SOURCE-OFFER.md).

The official entry point is [BHUHD/OpenH3](https://github.com/BHUHD/OpenH3). Copies in the personal repository use the same documentation and feedback destination.
