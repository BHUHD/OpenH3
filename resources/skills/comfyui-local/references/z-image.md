# Z-Image generation

Use Z-Image profiles for local image generation supported by their registered workflows. The base and Turbo models have different sampling/training characteristics; select and pin a complete route rather than treating Turbo as a speed flag on any Z-Image checkpoint.

## Component selection

Discover official local templates `image_z_image_turbo` and `image_z_image` from `Comfy-Org/workflow_templates`. Inspect the chosen template at a fixed repository revision, including subgraphs and model metadata. Resolve and pin diffusion weights, the appropriate Qwen text encoder, VAE, core/custom-node revisions, and exact sampler settings together.

The traceable Turbo baseline in [candidates.json](candidates.json) records its template commit/hash, complete three-component repository revisions/bytes/SHA-256, and required node classes. It is discovery-only: authored core-version metadata is not a minimum supported version or a hardware compatibility result.

Its `apiBaselineId` selects `z-image-turbo-bf16-api-discovery` in [workflows.json](workflows.json). This ten-node API graph expands the official UI subgraph using the pinned converter and source-derived schemas. It retains the official 8-step `res_multistep`/`simple`, CFG 1, shift 3, Lumina2 text-loader type, and matching BF16 diffusion/Qwen encoder/VAE set. Copy the graph/hash, semantic bindings/defaults, and core pin into a cold plan after assessing this computer; resolve the candidate's exact three component destinations and runtime separately. No local ComfyUI installation is needed to read or prepare this graph.

Bindings expose prompt, seed, width, height, batch size, and output prefix. The shipped defaults are 1024×1024/batch 1; the suggested smoke input uses 512×512/batch 1. Neither is a measured memory budget or validated output on this computer. Only record a `memoryPolicy` after evidence supports the chosen limits and the same component set. This graph has no negative-prompt or offload binding.

The inspected official Turbo template references `z_image_turbo_bf16.safetensors`, `qwen_3_4b.safetensors`, and `ae.safetensors` in `models/diffusion_models`, `models/text_encoders`, and `models/vae`. These filenames help discovery; verify the current pinned source and hashes before any download. `ae.safetensors` is a generic filename used by other graphs, so its name alone does not prove the VAE is the matching file.

Treat FP8/scaled-FP8, GGUF, and other community quantizations as separate candidates with documented loader/node/runtime requirements. Confirm real accelerator and kernel support; successful dtype allocation or file loading alone does not prove the graph runs. Record diffusion precision independently from encoder/VAE precision and placement.

Choose a compatible balanced route using available memory, RAM/offload, target resolution, batch, and measured or sourced peak-memory estimates. Prefer an installed verified profile. Do not force a lower precision from a GPU's VRAM capacity alone. Turbo's distilled sampler/guidance/step settings come from its matching workflow; more steps or base-model guidance may reduce quality instead of improving it.

ControlNet/union, inpainting, LoRA, or upscale variants require their own matched graph and extra components. A plain text-to-image profile does not gain image-edit capability merely because the user attached an image. Inspect capability and input schemas before accepting that request.

## Register and reuse

Bind prompt, seed, dimensions, output prefix, and optional negative prompt only where the API graph exposes them. Resolve UI subgraphs into a valid API workflow using this environment's object schemas; an unresolved subgraph identifier is not an executable node class.

Run one modest image sample to validate the full text encoder → diffusion → VAE → output chain. Check dimensions, decoding, coherent content, nonblank output, and elapsed/peak-memory evidence. Record the exact component/workflow fingerprint and tested scale; larger canvases and batches require separate memory planning.

Normal generation calls `openh3_comfy_generate` using the selected registered profile and the user's prompt/dimensions. Keep its model identity and sampling defaults. Do not call a hosted `api_*` template, switch to Qwen, or install an alternative quantization as a retry without an explicit user choice. Diagnose bad images against loader identity, matching VAE, precision and sampler settings before changing checkpoints.

Sources: [pinned official Z-Image Turbo template](https://github.com/Comfy-Org/workflow_templates/blob/020a271ba4cf341096f70dfb6f4fe85bd5df2f5e/templates/image_z_image_turbo.json), [Comfy-Org Turbo components](https://huggingface.co/Comfy-Org/z_image_turbo), [Z-Image project](https://github.com/Tongyi-MAI/Z-Image). Workflow derivation and license are recorded in [sources.md](sources.md).
