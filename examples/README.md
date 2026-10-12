# Extension examples

These examples exercise the extension system inherited from AionUi. They are developer references, not prerequisites for generating videos with OpenH3. The `aion-extension.json` filename and AionUi identifiers are part of the existing extension protocol.

| Directory                                                          | Purpose                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [hello-world-extension](hello-world-extension/aion-extension.json) | Start here for agents, assistants, themes, settings and lifecycle hooks.                  |
| [acp-adapter-extension](acp-adapter-extension/aion-extension.json) | Minimal ACP adapter declaration.                                                          |
| [ext-feishu](ext-feishu/aion-extension.json)                       | Feishu channel and WebUI route example.                                                   |
| [ext-wecom-bot](ext-wecom-bot/README.md)                           | WeCom callback and streaming response example.                                            |
| [e2e-full-extension](e2e-full-extension/aion-extension.json)       | Fixture used by the extension E2E suites; intentionally retained for regression coverage. |

From the repository root, run `just dev-ext` to load the examples in development. Channel examples require their own service credentials and callback configuration. For automated checks, see the [E2E guide](../tests/e2e/README.md).

Source entrypoints are declared in each manifest. Generated `dist/` copies and local credentials should not be committed.
