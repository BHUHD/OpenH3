# OpenH3 Docs

Documentation is organized by reader intent, not by document type.

| Directory                       | For whom                 | What lives here                                                                                                               |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`guides/`](guides)             | Users & operators        | How to deploy, test, and run the product. Server deployment, WebUI, Hub testing, CDP debugging.                               |
| [`getting-started/`](getting-started) | New users            | Installation, system requirements, first task, and local runtime setup.                                                        |
| [`showcase/`](showcase)         | Evaluators & users      | Reproducible OpenH3 workflows and product demonstrations.                                                                       |
| [`contributing/`](contributing) | Contributors             | Dev environment setup, file-structure conventions, PR automation workflow.                                                    |
| [`architecture/`](architecture) | Engineers & architects   | System architecture overview, subsystem deep-dives (ACP, queue, team mode), and supporting research notes.                    |
| [`specs/`](specs)               | Engineering-driven specs | Feature design docs, requirements, implementation plans (ACP rewrite, extension market, remote agent, wake prompt, PR notes). |
| [`prds/`](prds)                 | Product team             | Formal Product Requirement Documents maintained by the product team. **Do not reorganize without their consent.**             |
| [`readme/`](readme)             | Chinese-speaking users  | The maintained Chinese OpenH3 entry point.                                                                                |

## Quick pointers

- New to the project? Start with [`../README.md`](../README.md), then read [`architecture/overview.md`](architecture/overview.md).
- Setting up a dev environment? See [`contributing/development.md`](contributing/development.md).
- Writing code? The entry point for code-style, linting, formatting, and commit rules is [`AGENTS.md`](../AGENTS.md) at the repo root.
- Deploying a server? [`guides/deploy-server.md`](guides/deploy-server.md).
- Looking for source boundaries? Read [`../packages/README.md`](../packages/README.md), [`../packages/desktop/src/README.md`](../packages/desktop/src/README.md), and [`../tests/README.md`](../tests/README.md).

## OpenH3-specific entry points

The repository still contains upstream-compatible application documentation because OpenH3 preserves the AionUi runtime identity for upgrade compatibility. OpenH3 product scope and release decisions live in these files:

- [`openh3/PRODUCT.md`](openh3/PRODUCT.md): user-facing Alpha scope and limitations.
- [`openh3/implementation-status.md`](openh3/implementation-status.md): verified implementation evidence and remaining gates.
- [`../resources/third-party-licenses/NOTICE.OpenH3.txt`](../resources/third-party-licenses/NOTICE.OpenH3.txt): third-party release boundary.
- [`../scripts/open-source-release-audit.js`](../scripts/open-source-release-audit.js): source and artifact audit.

## Where to put new docs

| Content type                                               | Destination                 |
| ---------------------------------------------------------- | --------------------------- |
| User/ops-facing how-to                                     | `guides/`                   |
| Contributor convention, workflow, or tooling rule          | `contributing/`             |
| System or subsystem design, technical analysis             | `architecture/`             |
| Exploratory research, analysis reports                     | `architecture/research/`    |
| Feature requirements / design drafts driven by engineering | `specs/<feature-name>/`     |
| Formal PRD owned by product team                           | `prds/` (coordinate first)  |
| README translation                                         | `readme/readme_ch.md`       |
