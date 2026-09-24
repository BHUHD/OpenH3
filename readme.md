# OpenH3

OpenH3 is a local-first, general-purpose video Agent for video and image interaction, Agent tool calls, local H3/ComfyUI execution, task progress, and result previews.

> **Alpha notice:** This repository and its Windows installer are an unsigned technical preview. Provider credentials are configured by the user and are not included in source code or builds. H3 weights, LoRAs, converted checkpoints, and workflow assets are downloaded separately or supplied by the user until their redistribution rights are documented.

## What It Includes

- Video and image context in conversations.
- Local H3/ComfyUI setup, fixed-revision downloads, and hash verification.
- Agent tools for media jobs, progress updates, cancellation, and result previews.
- Electron desktop packaging for Windows, macOS, and Linux.

## Quick Start

```bash
bun install
bun run dev
```

For a Windows x64 Alpha installer:

```bash
npm run build-win:x64:fast
```

The installer is written to `out/OpenH3-2.2.2-win-x64.exe`. It is not digitally signed.

## Development Checks

```bash
node scripts/check-i18n.js
node scripts/open-source-release-audit.js
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

## Licensing and Third-Party Components

The OpenH3 application changes are distributed under Apache-2.0 while retaining upstream AionUi copyright and modification notices. Fixed-version third-party license texts and source boundaries are listed in [`resources/third-party-licenses/NOTICE.OpenH3.txt`](resources/third-party-licenses/NOTICE.OpenH3.txt) and [`resources/third-party-licenses/SOURCE-OFFER.md`](resources/third-party-licenses/SOURCE-OFFER.md).

The current Alpha release does **not** claim that all GPL corresponding-source offers, dependency-level NOTICE files, or model/LoRA/workflow redistribution permissions are complete. Review those documents before redistributing a binary or model asset.

## Project Status

OpenH3 is under active Alpha development. See [`docs/PRODUCT.md`](docs/PRODUCT.md), [`docs/stage-plan.md`](docs/stage-plan.md), and [`docs/implementation-status.md`](docs/implementation-status.md) for supported scope, verification evidence, and remaining release gates.

## Original Project Credit

OpenH3 is based on the AionUi project. Upstream copyright, license files, and applicable notices remain in this repository. OpenH3-specific changes are maintained in this repository by the OpenH3 project.

## Links

- Repository: https://github.com/pigq/OpenH3
- Issues: https://github.com/pigq/OpenH3/issues
- Releases: https://github.com/pigq/OpenH3/releases
