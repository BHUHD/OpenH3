# Security Policy

## Supported versions

OpenH3 is currently an Alpha project. Security fixes are handled on the latest `main` branch and the latest published preview build. Older preview builds may not receive fixes.

The current Windows preview package is unsigned. Verify the SHA256 checksum published with each release before installing it.

## Reporting a vulnerability

Please do not report security vulnerabilities in a public issue, discussion, or pull request.

When GitHub private vulnerability reporting is enabled for this repository, use the [private security advisory form](https://github.com/pigq/OpenH3/security/advisories/new). Until then, contact the repository maintainer privately through [@pigq](https://github.com/pigq)'s GitHub profile and include `OpenH3 security report` in the subject.

Include only the information needed to reproduce the issue:

- A short description and impact.
- The affected version or commit.
- Reproduction steps or a minimal proof of concept.
- Relevant logs with provider keys, tokens, personal data, and local paths removed.

Do not attach API keys, model credentials, private endpoints, or unredacted user data. We will acknowledge a report when practical, investigate it, and coordinate disclosure after a fix or mitigation is available.

## Scope notes

- Do not include provider API keys, H3/ComfyUI credentials, or private workflow assets in reports.
- Model weights, LoRAs, converted checkpoints, and workflows are user-supplied and may have separate licenses.
- Reports about unsafe or unlicensed third-party model assets should identify the asset and its source without redistributing it.
