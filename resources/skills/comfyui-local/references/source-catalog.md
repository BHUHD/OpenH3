# Source catalog and mirror policy

This file is a decision aid, not a list of unverified download links. The candidate's upstream repository, immutable revision, filename, license, byte count, and SHA-256 remain the identity record.

## Preferred lookup order

1. **ModelScope (魔搭)** — look for the same repository or an explicitly documented export. Record the ModelScope repository, revision, file path, and the evidence that it is an exact copy of the upstream artifact.
2. **A reputable domestic mirror** — for example `hf-mirror.com` or another Hugging Face mirror that preserves the repository and revision path. Treat the mirror as transport only; compare the downloaded bytes and source metadata with upstream. The host must appear in the built-in trusted-host list or be explicitly approved by the product before probing.
3. **Upstream host** — use the pinned Hugging Face, Git, Python index, or Comfy-Org URL when it is reachable and the first two sources do not provide equivalent evidence.

The LLM must pass the exact candidate URLs to `aionui_comfy_environment.sources` before selecting one. A host page, search result, repository name, or same-size file is not sufficient evidence. Do not send credentials or signed query strings in a report; use a short-lived URL only for the actual approved download and keep the receipt local.

## Host-specific rules

- Model weights, encoders, VAEs, and LoRAs may use ModelScope or a domestic mirror when the fixed revision and SHA-256 match. Keep the upstream identity in the plan even when the selected transport is a mirror.
- Custom nodes and ComfyUI itself are Git or package artifacts. Use a pinned commit or package version from the appropriate host; never replace a Git repository with a model mirror.
- Python wheels must match the selected OS, Python, Torch, CUDA/ROCm, and architecture. A faster package index is not evidence of ABI compatibility.
- Official workflow templates are converted into the fixed API graph shipped in this Skill bundle. Do not download a fresh workflow during generation. Probe and pin a template URL only for a planned bundle update.

## When no mirror is usable

Keep the install request in the reviewable planning state and report the missing evidence. Ask for the smallest decision needed: another approved source, a user-provided verified file, or a later retry. Do not silently downgrade the model, change quantization, use a moving `latest` snapshot, or switch to a cloud workflow.
