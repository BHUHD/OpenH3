# Packages

| Package | Responsibility |
| --- | --- |
| `desktop/` | Electron application: main process, preload bridge, renderer, media and H3 runtime |
| `shared-scripts/` | Build and packaging helpers shared by workspace packages |
| `web-cli/` | Optional command-line and WebUI entry points |
| `web-host/` | Optional WebUI server host |

New video/H3 behavior normally belongs in `packages/desktop/`; keep reusable types in its `src/common/` boundary and keep OS/process work in `src/process/`.
