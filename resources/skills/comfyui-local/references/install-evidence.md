# Install evidence ledger

Use this short ledger while planning or repairing an installation. It keeps the LLM from treating a reachable page, downloaded file, or successful import as proof of a usable profile.

## Record each artifact

For every model, encoder, VAE, LoRA, node repository, Python package, and workflow record:

- artifact class and role in the API graph;
- authoritative repository, immutable revision/path, license, expected bytes, and SHA-256;
- candidate transports and their batch number in `aionui_comfy_environment.sources` (no more than 12 URLs per call);
- per-source reachability, redirect, Range/content-length result, and mirror identity/digest evidence;
- local path, resume receipt, and post-download size/hash result;
- loader/node schema compatibility and the profile/workflow fingerprint.

Keep model-host, Git-host, package-index, and workflow-host results separate. A successful probe is only network evidence; it is not artifact identity evidence.

## State transitions

Use the states `planned`, `downloaded`, `loadable`, and `verified`:

1. `planned` means the component set, workflow graph, sources, and required space are reviewable and user-approved.
2. `downloaded` means the approved bytes are present and their receipt, size, and SHA-256 match.
3. `loadable` means the selected ComfyUI runtime exposes the required node classes, loaders, dtypes, and paths.
4. `verified` means a representative task-specific smoke input completes and the output passes the media checks.

Stop at the first missing transition. If a source is unprobed, a mirror lacks identity evidence, a hash mismatches, a loader is missing, or a smoke run fails, report the exact missing evidence and prepare a bounded next plan. Do not silently change family, quantization, workflow, dimensions, or source.
