# Development Guide

## Prerequisites

- **Node.js** 22–24 (`>=22 <25`)
- **bun** — Package manager & runtime ([install](https://bun.sh))
- **Rust + Cargo** — Required to build OpenH3 Core; `core/rust-toolchain.toml` pins its toolchain ([install](https://rustup.rs))
- **Python** 3.11+ (for native module compilation)
- **FFmpeg and ffprobe** on `PATH` — Required for image and video validation tests (`sudo apt-get install ffmpeg` on Ubuntu, `brew install ffmpeg` on macOS, or `choco install ffmpeg` on Windows).
- **prek** — PR code checker (`npm install -g @j178/prek`)

On Windows, install the Rust MSVC toolchain. If Rust compilation fails because native build tools are missing, install **Microsoft C++ Build Tools** from the Visual Studio installer, then reopen your terminal.

Windows x64 installers also require the separate `ffmpeg.exe` and `ffprobe.exe` files in `resources/ffmpeg/win32-x64/`. Extract them from the distributor's [7.1.1 essentials archive](https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip) and verify the hashes recorded in [SOURCE-OFFER.md](../../resources/third-party-licenses/SOURCE-OFFER.md). These large binaries are ignored by Git; installing media tools on `PATH` does not populate the packaging directory.

## Repository Layout

OpenH3 is maintained in one product repository, mirrored at `pigq/OpenH3` and `BHUHD/OpenH3`. The desktop client and Rust Core now live in this checkout: `packages/desktop` contains the Electron client and `core/` contains the backend runtime, database, Skill runtime, MCP, extensions and channels.

The old split checkout is no longer required. Existing installed binaries and data remain compatible: the canonical binary is `openh3-core`, while `aioncore` remains available as a legacy binary name for older scripts and installations.

## Quick Start

### 1. Clone OpenH3

```bash
git clone https://github.com/pigq/OpenH3.git
```

### 2. Build and Install OpenH3 Core

Run these commands from the OpenH3 repository root.

#### macOS / Linux

```bash
cd OpenH3
cd core
cargo install --path crates/openh3-app --locked
cd ..

# Make Cargo-installed binaries visible to this shell if needed.
export PATH="$HOME/.cargo/bin:$PATH"

# Verify that OpenH3 will be able to find the backend.
which openh3-core
openh3-core --help
```

If `which openh3-core` prints nothing, add `export PATH="$HOME/.cargo/bin:$PATH"` to your shell profile (`~/.zshrc`, `~/.bashrc`, or your shell's equivalent), open a new terminal, and verify again. The legacy `aioncore` binary remains available for existing scripts.

#### Windows PowerShell

```powershell
cd OpenH3
cd core
cargo install --path crates/openh3-app --locked
if ($LASTEXITCODE -ne 0) { throw 'Backend install failed' }
cd ..

# Make Cargo-installed binaries visible to this PowerShell session if needed.
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

# Verify that OpenH3 will be able to find the backend.
where.exe openh3-core
openh3-core --help
```

If `where.exe openh3-core` prints nothing, make sure `%USERPROFILE%\.cargo\bin` is in your user `Path`, open a new PowerShell window, and verify again. The legacy `aioncore.exe` name remains supported.

### 3. Start OpenH3

Run these commands from the `OpenH3` repository in a terminal where `openh3-core` is discoverable.

```bash
cd OpenH3

# Install dependencies
bun install

# Start the Electron desktop app in development mode
bun run start
```

During startup, OpenH3 launches `openh3-core` automatically and passes the backend port to the renderer. You do not need to start OpenH3 Core in a separate terminal.

## Updating the Local Backend

When you update OpenH3 Core, rebuild it from the same checkout and restart OpenH3:

```bash
cd core
cargo install --path crates/openh3-app --locked --force
cd ..
bun run start
```

Use `--force` when rebuilding local changes with the same OpenH3 Core package version; otherwise Cargo may keep the already installed binary.

### Package a Local Windows Backend Bundle

From the OpenH3 checkout, build the release binary and prepare its managed Node resources into the ignored OpenH3 runtime directory:

```powershell
bun run core:build
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
$bundle = New-Item -ItemType Directory -Force .runtime/backend-bundle
Copy-Item core/target/release/openh3-core.exe $bundle.FullName -Force
& core/target/release/openh3-core.exe --data-dir .runtime/backend-prepare prepare-managed-resources --bundle-out "$($bundle.FullName)/managed-resources"
if ($LASTEXITCODE -ne 0) { throw 'Managed resource preparation failed' }
$env:AIONUI_BACKEND_LOCAL_BUNDLE_DIR = $bundle.FullName
npm run build-win:x64
```

Packaging builds `core/` from the current checkout by default. `bun run core:build:local-bundle` explicitly prepares that local bundle. Cross-architecture packaging requires a prebuilt bundle through `OPENH3_BACKEND_LOCAL_BUNDLE_DIR`. To select a historical release, set `OPENH3_CORE_SOURCE=release` and `OPENH3_BACKEND_VERSION` explicitly.

Linux CI builds the same checkout separately with the Core release compatibility toolchain: x64 on Ubuntu 22.04 and ARM64 using the pinned cross image in `core/Cross.toml`. Both binaries pass the existing GLIBC ceiling check before desktop and Web CLI jobs consume them. Native local Linux builds inherit the host's GLIBC requirements.

When an explicit local bundle is supplied, the builder validates it and stops on invalid input; it does not silently substitute an upstream download. Keep the bundle outside generated packaging output, or use the exact output directory in place. Overlapping parent/child source and output directories are rejected.

## Backend Startup Troubleshooting

### `Cannot find "openh3-core" binary`

OpenH3 cannot find the backend from the `PATH` inherited by `bun run start`.

Check from the same terminal where you start OpenH3:

```bash
# macOS / Linux
which openh3-core

# Windows PowerShell
where.exe openh3-core
```

If the command fails, add Cargo's binary directory to `PATH` and start OpenH3 from a new terminal.

### `openh3-core` Works in a Terminal but OpenH3 Still Cannot Find It

Make sure you start `bun run start` from the same terminal environment that can run `openh3-core --help`. IDE terminals and GUI-launched shells can inherit a different `PATH`; restart the IDE or launch it from a terminal after updating `PATH`.

### Backend Changes Do Not Show Up

Quit OpenH3, reinstall OpenH3 Core by running `cargo install --path crates/openh3-app --locked --force` inside `core/`, then start OpenH3 again. Running Cargo inside `core/` selects its pinned Rust toolchain. The Electron app owns the backend subprocess during development, so a running OpenH3 instance will not pick up a newly installed binary until it restarts.

### Windows Rust Build Errors

Use the Rust MSVC toolchain and install Microsoft C++ Build Tools. After installing or changing toolchains, open a new PowerShell window and rerun the OpenH3 Core install command.

## Scripts Reference

### Development

| Command                     | Description                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun start`                 | Start Electron app in development mode (desktop)                                                               |
| `bun run start:multi`       | Start a second Electron instance alongside an existing one (see [Multi-Instance](#multi-instance-development)) |
| `bun run cli`               | Alias for `bun start`                                                                                          |
| `bun run webui`             | Start in WebUI mode (browser-based, no Electron window)                                                        |
| `bun run webui:remote`      | Start in WebUI mode with remote access enabled                                                                 |
| `bun run webui:prod`        | Start WebUI in production mode                                                                                 |
| `bun run webui:prod:remote` | Start WebUI in production mode with remote access                                                              |
| `bun run resetpass`         | Reset user password via CLI                                                                                    |

### Build & Distribution

| Command                   | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `bun run package`         | Build all processes (main, preload, renderer) to `out/` |
| `bun run make`            | Alias for `bun run package`                             |
| `bun run dist`            | Build and package distributable for current platform    |
| `bun run dist:mac`        | Build distributable for macOS                           |
| `bun run dist:win`        | Build distributable for Windows                         |
| `bun run dist:linux`      | Build distributable for Linux                           |
| `bun run build-mac`       | Build macOS distributable for both arm64 and x64        |
| `bun run build-mac:arm64` | Build macOS distributable for Apple Silicon only        |
| `bun run build-mac:x64`   | Build macOS distributable for Intel only                |
| `bun run build-win`       | Build Windows distributable                             |
| `bun run build-win:arm64` | Build Windows distributable for ARM64                   |
| `bun run build-win:x64`   | Build Windows distributable for x64                     |
| `bun run build-deb`       | Build Linux (.deb) distributable                        |
| `bun run build`           | Alias for `bun run build-mac`                           |

### Optional WebUI

Use the WebUI commands above. See [deployment status](../guides/deploy-server.md); the old standalone Docker build is not maintained.

### Code Quality

| Command                | Description                               |
| ---------------------- | ----------------------------------------- |
| `bun run lint`         | Check for lint issues (oxlint, read-only) |
| `bun run lint:fix`     | Auto-fix lint issues                      |
| `bun run format`       | Auto-format code (oxfmt)                  |
| `bun run format:check` | Check formatting without modifying files  |
| `bun run i18n:types`   | Generate TypeScript types for i18n keys   |

### Testing

| Command                    | Description                       |
| -------------------------- | --------------------------------- |
| `bun run test`             | Run all unit tests (vitest)       |
| `bun run test:watch`       | Run tests in watch mode           |
| `bun run test:coverage`    | Run tests with coverage report    |
| `bun run test:integration` | Run integration tests             |
| `bun run test:e2e`         | Run end-to-end tests (Playwright) |

### Debug

| Command              | Description                                   |
| -------------------- | --------------------------------------------- |
| `bun run debug:perf` | Start app with performance monitoring enabled |

## Multi-Instance Development

When you have two clones of the repository (e.g. `OpenH3` and `OpenH3-refactor`) and need to run both simultaneously, the second instance can be started with:

```bash
bun run start:multi
```

This sets `AIONUI_MULTI_INSTANCE=1`, which:

- Skips the Electron single-instance lock
- Uses a separate userData directory (`AionUi-Dev-2`) to avoid database and config conflicts
- Isolates data/config symlink paths (`~/.aionui-dev-2`, `~/.aionui-config-dev-2`)
- Vite renderer, CDP, and WebUI proxy ports auto-increment to avoid collisions

> **Note:** The multi-instance WebUI defaults to port 25810 (instead of 25809). When accessing WebUI in a browser, use an **incognito/private window** for the second instance — both instances share the `localhost` cookie jar, and their JWT secrets differ, causing authentication failures if the same browser session is reused.

## Code Checks (prek)

The project uses [prek](https://github.com/j178/prek) (a Rust implementation of pre-commit) for code checks, configured in `.pre-commit-config.yaml`:

```bash
# Install prek
npm install -g @j178/prek

# Install git hooks (optional, auto-check before commit)
prek install

# Run checks on staged files
prek run

# Run checks on changes vs main (same as CI)
prek run --from-ref origin/main --to-ref HEAD
```

## Build System

OpenH3 uses **electron-vite** for fast bundling:

- **Main process**: bundled with Vite (ESM)
- **Renderer process**: bundled with Vite (React + TypeScript)
- **Preload scripts**: bundled with Vite

The build output goes to `out/` directory:

- `out/main/` - Main process code
- `out/renderer/` - Renderer process code
- `out/preload/` - Preload scripts

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast bundler (via electron-vite)
- **UnoCSS** - Atomic CSS engine
- **better-sqlite3** - Local database
- **vitest** - Testing framework
