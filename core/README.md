# OpenH3 Core

`core/` is the Rust backend shipped with OpenH3. It owns the HTTP and WebSocket API, session and Agent runtime, SQLite persistence, Skill runtime, MCP, extensions, channels, teams and task scheduling.

The workspace produces two compatible binaries from `crates/openh3-app`:

- `openh3-core` is the canonical OpenH3 binary.
- `aioncore` remains a legacy compatibility name for existing installations and scripts.

Run these commands from the repository root. Each script runs Cargo inside `core/` so it uses the pinned Rust toolchain:

```powershell
bun run core:fmt:check
bun run core:check
bun run core:test
bun run core:build
```

The desktop client launches the canonical binary automatically when it is packaged or when it is available on `PATH`. Runtime data identifiers and legacy environment variables remain compatible with older OpenH3 installations.
