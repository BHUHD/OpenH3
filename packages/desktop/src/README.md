# Desktop source layout

| Directory | Boundary |
| --- | --- |
| `common/` | Shared types, API clients, chat documents, and configuration; no DOM-only or main-process-only APIs |
| `preload/` | Narrow IPC bridge exposed to the renderer |
| `process/` | Electron main-process services, database, media jobs, H3 runtime, and built-in MCP servers |
| `renderer/` | React UI, conversation messages, media preview, settings, and i18n |

Cross-process calls must go through `preload/`. H3 downloads and model files belong outside source control in the runtime bundle or user data directory.
