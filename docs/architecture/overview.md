# Architecture

OpenH3 is an Electron desktop workspace for agent conversations and local media workflows. The [package map](../../packages/README.md) lists optional WebUI packages.

```text
React renderer → preload IPC bridge → Electron main process
                                       ├─ OpenH3 Core agent backend
                                       ├─ provider and tool requests
                                       └─ media jobs → local H3 / ComfyUI → result files
```

| Boundary      | Source                            | Responsibility                                                                 |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| Renderer      | `packages/desktop/src/renderer/`  | Conversation UI, settings, progress and previews; no direct Node.js APIs       |
| Preload       | `packages/desktop/src/preload.ts` | Controlled IPC access between renderer and main process                        |
| Main process  | `packages/desktop/src/process/`   | OS access, backend lifecycle, tools, media jobs and runtime management         |
| Shared        | `packages/desktop/src/common/`    | Types, configuration and IPC contracts                                         |
| Agent backend | External OpenH3 Core binary       | Backend used by the desktop application; see the development guide             |
| Gateway       | `services/openh3-gateway/`        | Optional separately deployed provider proxy; not required for BYOK development |

Local inference and remote provider requests are separate data paths. A remote provider may receive prompts and media context. Model downloads, provider access, and GPU availability have different failure modes; do not report application startup as proof that generation works.

Legacy `AionUi` executable names, app IDs, protocols and package names remain compatibility identifiers. Changing them requires migration planning; product-facing documentation uses OpenH3.

See [development](../contributing/development.md), [file structure](../contributing/file-structure.md), and [tests](../../tests/README.md).
