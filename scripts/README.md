# Development and release scripts

These scripts support OpenH3 development, runtime preparation and distribution. Run commands from the repository root after following the [development guide](../docs/contributing/development.md).

## Common tasks

| Task                                         | Command                                   |
| -------------------------------------------- | ----------------------------------------- |
| Start the desktop app                        | `bun run dev`                             |
| Compile the app for local E2E tests          | `bun run package`                         |
| Package a Windows installer                  | `bun run dist:win`                        |
| Package for macOS or Linux                   | `bun run dist:mac` / `bun run dist:linux` |
| Check video runtime prerequisites            | `bun run video:doctor`                    |
| Inspect the H3 offline plan                  | `bun run h3:offline-plan`                 |
| Audit source and available release artifacts | `bun run audit:open-source-release`       |
| Regenerate third-party notices               | `bun run licenses:generate`               |
| Run checks and push a commit                 | `just push`                               |

Packaging requires platform-specific build tools and runtime downloads. See the [release guide](../docs/contributing/releases.md) before publishing. Source audits do not certify binaries that were not supplied to the audit.

## Script map

| Area                        | Entry points and purpose                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop packaging           | `build-with-builder.js` coordinates electron-vite, MCP bundling, runtime preparation and electron-builder; `afterPack.js` and `afterSign.js` provide packaging hooks.     |
| Dependencies                | `postinstall.js`, `rebuildNativeModules.js`, `prepareOpenH3Core.js`, `resolveOpenH3CoreVersion.js` and `prepareHubResources.js` prepare native modules and bundled resources. Legacy AionCore-named wrappers remain for older automation. |
| Runtime workers             | `media-service.ts` and `h3-install-worker.ts` are application build entrypoints, not disposable diagnostics.                                                              |
| Web distribution            | `webui.ts`, `resetpass.ts`, `pack-web-cli.js`, `install-web.sh` and `install-ubuntu.sh` support WebUI and server installation.                                            |
| Release verification        | `prepare-release-assets.sh`, `verify-release-assets.sh`, `open-source-release-audit.js` and the license scripts prepare and inspect release materials.                    |
| Installer checks            | `smoke-installer-*`, `smoke-test-*` and `verify-installer-jsonl.ps1` exercise installer and distribution behavior; read their prerequisites before running.               |
| Performance and diagnostics | `benchmark-startup.ts`, `benchmark-acp-startup.ts`, `run-benchmarks.ts`, `dev-bootstrap.mjs` and `packaged-launch.mjs` provide reusable development tools.                |
| Assets and localization     | `generate-openh3-icons.mjs`, `generate-i18n-types.js` and `check-i18n.js` maintain generated application assets and translation types.                                    |

`build-fast-debug-versions.ps1` and `build-fast-debug-worktrees.ps1` support local version-comparison builds. `create-mock-release-artifacts.sh` creates fixtures for release-script validation. Neither produces production release evidence.

Keep reusable tools here. Machine-specific acceptance runs, generated reports and one-off source migrations belong in local ignored working directories; removed tools remain recoverable from Git history.
