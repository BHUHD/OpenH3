# Dependency patches

`7zip-bin@5.2.0.patch` is applied by Bun through `patchedDependencies` in the root `package.json`; it is part of reproducible dependency installation, not generated output.

The patch adds a macOS compatibility wrapper that uses system `zip` when creating archives with symlinks. Other platforms retain the bundled executable path. Keep the patch and lockfile together until the workaround is removed or replaced and the affected packaging flow has been verified.

Do not delete this directory independently of `package.json` and `bun.lock`. The tracked patch is retained unchanged in this documentation cleanup.
