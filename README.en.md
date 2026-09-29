# OpenH3

[中文说明](readme.md)

[![CI](https://github.com/pigq/OpenH3/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/pigq/OpenH3/actions/workflows/pr-checks.yml) [![License](https://img.shields.io/github/license/pigq/OpenH3)](LICENSE) [![Status](https://img.shields.io/badge/status-alpha-orange)](https://github.com/pigq/OpenH3/releases)

> **A conversational creative engine for local AI.**

**From creative intent to generated results, let an agent orchestrate local models at every step.**

OpenH3 brings local model setup, agent conversations, task execution, and result previews into one desktop workspace. Describe your goal in natural language and let the agent call configured models and tools. The current focus is H3 / ComfyUI video workflows, with video and image context and general-purpose tool calls.

OpenH3 prioritizes local model execution, with providers and models configured by you. If you select a remote provider, prompts and media context needed for the task may be sent to that service. Local model inference does not mean the agent operates entirely offline.

![OpenH3 video generation demo: from reference image to an in-app result preview](docs/assets/openh3-demo.gif)

A real workflow: provide a reference image and a natural-language description, let OpenH3 run the local video workflow, follow its progress, and preview the result in the conversation.

| Reference material | In-app result preview |
| --- | --- |
| ![OpenH3 reference image](docs/assets/openh3-reference.png) | ![OpenH3 result preview](docs/assets/openh3-result-preview.png) |

## Core capabilities

- **Goal-driven creation**: describe editing, generation, analysis, or processing goals in natural language and let the agent break them into executable steps.
- **Video and image context**: reference local media and result files so the agent can work from the actual material.
- **Local H3 / ComfyUI**: prepare a local runtime and use H3 workflows and ComfyUI nodes for video generation and processing.
- **Visible task execution**: inspect nodes, progress, elapsed time, and results; long-running tasks can be cancelled and repeated internal status calls are collapsed automatically.
- **Result previews**: view generated videos, images, and related files directly in the desktop conversation.
- **Agent tool calls**: extend the workspace with more video tools and workflows over time.

## Example prompts

```text
Remove the person from this video, replace the background with this image, and export a preview.

Generate a 5-second shot from this image while keeping the subject consistent.

Review this video's visuals, subtitles, and audio, then list the issues to fix.
```

OpenH3 turns the request into an observable execution flow and uses the configured H3 / ComfyUI runtime when local models are required.

## Quick start

### Download a preview package

| Platform | Current status | Best for |
| --- | --- | --- |
| Windows 10/11 x64 | Source available; public installer pending | Run or build from source today |
| macOS / Linux | Source development; platform validation pending | Developers helping with validation |

No public installer has been uploaded yet. Use the source instructions below. Future [Releases](https://github.com/pigq/OpenH3/releases) will include packages, checksums, and installation notes. Existing local Windows Alpha builds are unsigned.

After the first launch:

1. Configure your own provider and model credentials.
2. Enable local H3 / ComfyUI when needed, and provide models, LoRAs, and workflows that you are authorized to use.
3. Start a conversation, attach a video or image, and describe the task.

See [`docs/getting-started/`](docs/getting-started/) for system requirements and the first-task walkthrough.

### Run from source

Follow the [development guide](docs/contributing/development.md) to prepare dependencies and the agent backend, then run these commands from the repository root:

```bash
bun install
bun run dev
```

Build an unsigned Windows x64 preview package:

```bash
npm run build-win:x64:fast
```

Build output is written to `out/`. It is for Alpha evaluation and testing, not a signed production release.

## Project status

OpenH3 is currently in Alpha, focused on validating the core local video agent experience and reproducible open-source builds. Users provide or verify the rights for:

- Provider API keys;
- H3 weights, LoRAs, converted models, and workflows;
- Optional GPUs, drivers, and local inference runtimes.

Credentials and model files are not included in source code, tests, installers, or public builds. Before distributing an installer, verify the license obligations of the components actually shipped. Model redistribution evidence applies to files actually redistributed. Signing improves publisher identity and installation trust; it is not a prerequisite for publishing source. Alpha maturity and signature status are independent. See [release requirements](docs/openh3/PRODUCT.md#known-release-gaps).

## System requirements

- Windows 10/11 x64, or a macOS/Linux development environment that can run Bun/Node.js;
- Video generation workflows usually require a discrete GPU; VRAM and disk requirements depend on the selected H3 model;
- Provider API keys, H3 weights, LoRAs, converted files, and workflows are supplied by the user and must be authorized;
- Read [`docs/getting-started/system-requirements.md`](docs/getting-started/system-requirements.md) before running a workflow.

## Repository layout

```text
packages/desktop/                 Electron desktop application
packages/desktop/src/common/      Shared models, APIs, and conversation data
packages/desktop/src/process/     Main process, media jobs, and H3 runtime
packages/desktop/src/renderer/    React UI, conversations, previews, and settings
scripts/                          Build, audit, and H3 setup utilities
tests/                            Unit, DOM, runtime, and end-to-end tests
resources/                        Icons, licenses, and build resources
docs/                             User guides, architecture, contribution, and release notes
```

## Development checks

```bash
node scripts/check-i18n.js
node scripts/open-source-release-audit.js
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

See [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for development conventions. Product scope, verification records, and release gates are documented in [`docs/openh3/`](docs/openh3/).

## Open source and third-party components

OpenH3 application changes are distributed under Apache-2.0 while retaining AionUi upstream copyright, licenses, and required attribution. Third-party components and corresponding-source boundaries are documented in [`resources/third-party-licenses/NOTICE.OpenH3.txt`](resources/third-party-licenses/NOTICE.OpenH3.txt) and [`resources/third-party-licenses/SOURCE-OFFER.md`](resources/third-party-licenses/SOURCE-OFFER.md).

Model weights, LoRAs, converted files, and workflows are not automatically covered by Apache-2.0. Confirm the source and redistribution license for each file before distributing it.

## Documentation and community

- [Getting started](docs/getting-started/README.md)
- [Showcase](docs/showcase/README.md)
- [Contributing](CONTRIBUTING.md)
- [Support and troubleshooting](SUPPORT.md)
- [Security reports](SECURITY.md)

## Links

- Repository: [github.com/pigq/OpenH3](https://github.com/pigq/OpenH3)
- Issues: [GitHub Issues](https://github.com/pigq/OpenH3/issues)
- Releases: [GitHub Releases](https://github.com/pigq/OpenH3/releases)

## Credits

OpenH3 is based on [AionUi](https://github.com/iOfficeAI/AionUi). Upstream copyright, licenses, and applicable modification notices remain in this repository; OpenH3-specific product changes are maintained by the OpenH3 project.
