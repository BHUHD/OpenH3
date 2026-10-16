# Tests

Tests are part of the public source: they document behavior and protect contributions. Run commands from the repository root after [development setup](../docs/contributing/development.md).

| Command                    | Scope                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `bun run test`             | Vitest suite                                                                 |
| `bun run test:coverage`    | Coverage report                                                              |
| `bun run test:integration` | Integration tests; inspect prerequisites in each suite                       |
| `bun run test:e2e`         | Playwright end-to-end tests; requires the configured application environment |

For a focused change, use `bunx vitest run tests/unit/<test-file>.test.ts`. Keep assertions, fixtures and maintained test cases in Git. Files under `e2e/docs/` describe test requirements and implementation mappings; historical agent discussions are not test inputs and are retained in Git history rather than the active tree.

Generated coverage, screenshots, reports, private logs and local credentials must stay ignored. A skipped hardware or packaged-build test is not a successful device validation.

## Directory map

| Directory      | Purpose                                |
| -------------- | -------------------------------------- |
| `unit/`        | Unit, DOM, media and H3 runtime tests  |
| `integration/` | Multi-module integration checks        |
| `e2e/`         | Desktop and WebUI end-to-end scenarios |
| `fixtures/`    | Small deterministic inputs             |
