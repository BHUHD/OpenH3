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

## Repository Map

```text
packages/desktop/                 Electron desktop app (main, preload, renderer)
packages/desktop/src/common/      Shared data models, API clients, and chat documents
packages/desktop/src/process/      Main-process services, media jobs, and H3 runtime
packages/desktop/src/renderer/    React UI, conversation, preview, and settings
packages/shared-scripts/           Shared build helpers
packages/web-cli/                  Optional command-line and WebUI entry points
packages/web-host/                 Optional WebUI host
scripts/                           Build, audit, H3 setup, and release utilities
tests/                             Unit, DOM, runtime, and end-to-end tests
resources/                         Icons, licenses, and build-time resources
docs/                              User guides, architecture, contribution notes, and release status
```

Most contributors only need `packages/desktop/src/`, `tests/`, `scripts/`, and `docs/`. Runtime downloads and generated output stay outside the source tree in `.runtime/` and `out/`; these directories are ignored and should not be committed.

## Licensing and Third-Party Components

The OpenH3 application changes are distributed under Apache-2.0 while retaining upstream AionUi copyright and modification notices. Fixed-version third-party license texts and source boundaries are listed in [`resources/third-party-licenses/NOTICE.OpenH3.txt`](resources/third-party-licenses/NOTICE.OpenH3.txt) and [`resources/third-party-licenses/SOURCE-OFFER.md`](resources/third-party-licenses/SOURCE-OFFER.md).

The current Alpha release does **not** claim that all GPL corresponding-source offers, dependency-level NOTICE files, or model/LoRA/workflow redistribution permissions are complete. Review those documents before redistributing a binary or model asset.

## Project Status

OpenH3 is under active Alpha development. See [`docs/openh3/PRODUCT.md`](docs/openh3/PRODUCT.md), [`docs/openh3/implementation-status.md`](docs/openh3/implementation-status.md), and [`docs/README.md`](docs/README.md) for supported scope, verification evidence, and remaining release gates.

## Original Project Credit

OpenH3 is based on the AionUi project. Upstream copyright, license files, and applicable notices remain in this repository. OpenH3-specific changes are maintained in this repository by the OpenH3 project.

## Links

- Repository: https://github.com/pigq/OpenH3
- Issues: https://github.com/pigq/OpenH3/issues
- Releases: https://github.com/pigq/OpenH3/releases

## Where to Start

- New user: read [`docs/openh3/PRODUCT.md`](docs/openh3/PRODUCT.md) and the Alpha notice above.
- Contributor: read [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/README.md`](docs/README.md), and [`docs/contributing/development.md`](docs/contributing/development.md).
- H3/runtime work: read [`docs/openh3/implementation-status.md`](docs/openh3/implementation-status.md), [`resources/third-party-licenses/NOTICE.OpenH3.txt`](resources/third-party-licenses/NOTICE.OpenH3.txt), and the runtime tests under [`tests/unit/runtime/`](tests/unit/runtime/).
