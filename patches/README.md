# Dependency patches

`7zip-bin@5.2.0.patch` is applied by Bun through `patchedDependencies` in the root `package.json`; it is part of reproducible dependency installation, not generated output.

The patch adds a macOS compatibility wrapper that uses system `zip` when creating archives with symlinks. Other platforms retain the bundled executable path. Keep the patch and lockfile together until the workaround is removed or replaced and the affected packaging flow has been verified.

Do not delete this directory independently of `package.json` and `bun.lock`. The tracked patch is retained unchanged in this documentation cleanup.

## OpenH3 Core source

`openh3-core.patch` contains the complete backend changes used by this OpenH3 client, including imported-skill discovery in existing conversations, native Skill execution, configuration helpers, and product presentation. Both OpenH3 mirrors carry this same patch; a separate backend fork is not required to retain these changes.

- Upstream: `https://github.com/iOfficeAI/AionCore.git`
- Base commit: `503a87199eb978790ca77675b39c84b241535bf3`
- Patched Git tree: `d53609d6280ac937b9900c053b00e84f6fcae0e8`
- Upstream root license: Apache-2.0; its Cargo metadata declares MIT. Both upstream notices remain in the source.

Apply the patch to a clean checkout of that exact base before building the backend. See the [development guide](../docs/contributing/development.md) for commands. The unmodified upstream `v0.2.2` release does not contain these OpenH3 fixes.
