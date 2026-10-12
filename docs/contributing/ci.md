# Continuous integration

Workflow definitions in [`.github/workflows/`](../../.github/workflows/) are the source of truth.

| Workflow                                                            | Purpose                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pr-checks.yml`                                                     | Code quality, tests, i18n, packaging and release-script checks for code PRs         |
| `pr-checks-docs.yml`                                                | Documentation PR checks; mixed PRs can trigger both workflows                       |
| `build-and-release.yml`                                             | Branch/tag quality checks and configured release pipeline                           |
| `_build-reusable.yml`, `build-manual.yml`                           | Shared build jobs and manual packaging                                              |
| `pack-web-cli.yml`                                                  | Optional Web CLI packaging                                                          |
| `release-distribute.yml`                                            | Optional distribution mirror; requires repository configuration                     |
| `gpt-review.yml`, `gpt-pr-assessment.yml`                           | Optional AI-assisted review; not an automatic prerequisite of the current PR checks |
| `issue-triage.yml`, `discussion-triage.yml`, `pr-e2e-artifacts.yml` | Triage and test-artifact support                                                    |

Release jobs are gated by `PUBLISH_RELEASE` and their event conditions. Do not enable optional publishing or API-backed review without configuring the required credentials and destinations. Keep secrets in repository/environment settings, never in YAML.

Local checks are described in [Contributing](../../CONTRIBUTING.md). Oxfmt is the formatting source of truth (`.oxfmtrc.json`); `.codecov.yml` is the single coverage configuration. Coverage warnings and skipped jobs are not proof that all release checks passed.
