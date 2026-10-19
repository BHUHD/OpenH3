# Development Guide

## Prerequisites

- **Node.js** 22–24 (`>=22 <25`)
- **bun** — Package manager & runtime ([install](https://bun.sh))
- **Rust stable + Cargo** — Required to build OpenH3 Core ([install](https://rustup.rs))
- **Python** 3.11+ (for native module compilation)
- **FFmpeg and ffprobe** on `PATH` — Required for image and video validation tests (`sudo apt-get install ffmpeg` on Ubuntu, `brew install ffmpeg` on macOS, or `choco install ffmpeg` on Windows).
- **prek** — PR code checker (`npm install -g @j178/prek`)

On Windows, install the Rust MSVC toolchain. If Rust compilation fails because native build tools are missing, install **Microsoft C++ Build Tools** from the Visual Studio installer, then reopen your terminal.

## Repository Layout

OpenH3 is maintained in one product repository, mirrored at `pigq/OpenH3` and `BHUHD/OpenH3`. The complete OpenH3 Core changes are stored in [`patches/openh3-core.patch`](../../patches/openh3-core.patch), against the fixed upstream commit recorded in the [patch notes](../../patches/README.md#openh3-core-source).

Building the backend uses an upstream source checkout as a build dependency:

- **OpenH3 Core source** (`https://github.com/iOfficeAI/AionCore.git`) builds the local backend binaries: `openh3-core` (canonical) and `aioncore` (legacy compatibility).
- **OpenH3** (`https://github.com/BHUHD/OpenH3.git`) starts the Electron desktop app and launches the backend binary automatically.

Keep the repositories side by side when possible:

```text
workspace/
|-- OpenH3-Core/
`-- OpenH3/
```

The desktop development server resolves OpenH3 Core from the `PATH` inherited by `bun run start`. Install the backend first, verify `openh3-core` is discoverable in the same terminal, then start OpenH3.

## Quick Start

### 1. Clone OpenH3 and Prepare the Backend Source

```bash
git clone https://github.com/BHUHD/OpenH3.git
git clone https://github.com/iOfficeAI/AionCore.git OpenH3-Core
git -C OpenH3-Core checkout --detach 503a87199eb978790ca77675b39c84b241535bf3
git -C OpenH3-Core apply --check ../OpenH3/patches/openh3-core.patch
git -C OpenH3-Core apply ../OpenH3/patches/openh3-core.patch
```

Use OpenH3 `main` for development. Apply the tracked patch to its exact base, rather than checking out an unmodified release tag. `openh3CoreVersion` is the canonical package field; `aioncoreVersion` remains as a legacy fallback for older build scripts. Keep the patched checkout intact when updating OpenH3, and apply a newer patch only to a fresh checkout of its recorded base.

### 2. Build and Install OpenH3 Core

Run these commands from the backend source repository.

#### macOS / Linux

```bash
cd OpenH3-Core
cargo clean
cargo install --path crates/openh3-app --locked

# Make Cargo-installed binaries visible to this shell if needed.
export PATH="$HOME/.cargo/bin:$PATH"

# Verify that OpenH3 will be able to find the backend.
which openh3-core
openh3-core --help
```

If `which openh3-core` prints nothing, add `export PATH="$HOME/.cargo/bin:$PATH"` to your shell profile (`~/.zshrc`, `~/.bashrc`, or your shell's equivalent), open a new terminal, and verify again. The legacy `aioncore` binary remains available for existing scripts.

#### Windows PowerShell

```powershell
cd OpenH3-Core
cargo clean
cargo install --path crates/openh3-app --locked

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

When you update OpenH3, check whether its backend patch or base changed. Prepare a fresh backend checkout with the commands above if needed, reinstall the backend binary, and restart OpenH3:

```bash
cd ../OpenH3-Core
cargo install --path crates/openh3-app --locked --force

cd ../OpenH3
bun run start
```

Use `--force` when rebuilding local changes with the same OpenH3 Core package version; otherwise Cargo may keep the already installed binary.

### Package the Patched Windows Backend

From the patched backend checkout, build the release binary and prepare its managed Node resources into the ignored OpenH3 runtime directory:

```powershell
cargo build --release -p openh3-app --locked
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
$bundle = New-Item -ItemType Directory -Force ../OpenH3/.runtime/backend-bundle
Copy-Item target/release/openh3-core.exe $bundle.FullName -Force
& target/release/openh3-core.exe --data-dir ../OpenH3/.runtime/backend-prepare prepare-managed-resources --bundle-out "$($bundle.FullName)/managed-resources"
if ($LASTEXITCODE -ne 0) { throw 'Managed resource preparation failed' }
$env:AIONUI_BACKEND_LOCAL_BUNDLE_DIR = $bundle.FullName
cd ../OpenH3
npm run build-win:x64
```

The explicit local bundle is required for a package containing these backend fixes. The builder validates it and stops on invalid input; it does not silently substitute an upstream download. Keep the bundle outside generated packaging output, or use the exact output directory in place. Overlapping parent/child source and output directories are rejected.

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

Quit OpenH3, reinstall OpenH3 Core with `cargo install --path crates/openh3-app --locked --force`, then start OpenH3 again. The Electron app owns the backend subprocess during development, so a running OpenH3 instance will not pick up a newly installed binary until it restarts.

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
