# Sources and licensing

This bundle contains original OpenH3 operating instructions and official-template-derived API graph baselines in [workflows.json](workflows.json). It packages no ComfyUI software, model weights, upstream skill files, or converter source. Template/component facts and API graphs are discovery data; installation plans must keep the pinned set together and supply actual hardware/runtime evidence. The original research inspected the resources below on 2026-10-14; the additional image snapshot was inspected on 2026-10-22:

Network source selection and resumable transfer rules are maintained separately in [network-and-downloads.md](network-and-downloads.md). ModelScope (魔搭) and domestic mirrors are considered possible transport locations, not authoritative model identities; an install plan must retain the upstream repository/revision and verify the mirror's file identity and SHA-256 before use.

[candidates.json](candidates.json) preserves the inspected source commits, downloaded template-document hashes, and upstream Git-LFS component hashes/bytes at fixed model revisions. Template documentation was fetched for inspection; model weights were not downloaded, kernels were not executed, and the candidates carry no verification claim for this computer. The application legacy H3 candidate preserves existing application source constants as a separate component set.

The API baselines record each original template revision/hash, converter revision/file hash, source-derived schema and its hash, every executed class's fixed source/hash/input order, original converter output/hash, and final graph/hash. Schema facts were extracted from the pinned `INPUT_TYPES`/`define_schema` declarations without importing the ComfyUI runtime or running models; dynamic loader/image enums are planned filenames and upstream examples. The conversion used [the pinned converter function](https://github.com/Comfy-Org/comfy-cli/blob/e05c06fe81e35abbbf57dbb4093468be72d48d16/comfy_cli/workflow_to_api.py). Its GPL-3.0 executable source is not copied into this bundle. The Z-Image graph expands the original subgraph. Qwen's graph explicitly selects and folds the official Turbo switches, specializes to one optional source image, and replaces sample prompt/seed/image defaults; the untouched converted graph and Switch/Primitive schema provenance remain available for comparison. Repository structural checks validate node schemas, links, loader/component identity, bindings, output reachability, and conversion hashes. None of this proves local loader/kernel execution, memory use, or media quality.

- [Comfy-Org/comfy-cli](https://github.com/Comfy-Org/comfy-cli): command behavior, workspace/interpreter selection, structured diagnostics, template/node discovery, and version controls. The upstream code and bundled [`comfy`](https://github.com/Comfy-Org/comfy-cli/blob/main/comfy_cli/skills/comfy/SKILL.md) / [`comfy-debug`](https://github.com/Comfy-Org/comfy-cli/blob/main/comfy_cli/skills/comfy-debug/SKILL.md) skills are GPL-3.0. They are not copied or bundled here. This skill explicitly selects local routing and uses OpenH3's installation consent contract.
- [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/020a271ba4cf341096f70dfb6f4fe85bd5df2f5e): MIT; the derived Z-Image and Qwen API workflow JSON is shipped with the attribution below. Original UI documents are not bundled. Renderer media is attributed separately in `packages/desktop/src/renderer/assets/creation/model-previews/README.md`.
- [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI/tree/e0a32bce84f4603f2b61b16b50f8958e68fd6171): GPL-3.0; factual node-schema metadata/input order/types/defaults/limits and sampler choices establish the planning provenance. No runtime or executable source is bundled.
- [Rimagination/h3lite](https://github.com/Rimagination/h3lite): MIT; H3 component-set and integrity practices, separate baseline/acceleration validation, and native audio verification. Hardware examples are not used as fixed selection rules.
- [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3), [QwenLM/Qwen-Image](https://github.com/QwenLM/Qwen-Image), and [Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image): authoritative family definitions. Model licenses and derivative/quantized weight licenses remain separate from this instruction bundle and must be included in an actual install plan.

OpenH3-authored instructions follow the repository's Apache-2.0 license. The MIT attribution below is retained for the referenced H3 Lite/component-set and official template material:

The 2026-10-22 `imageModels` snapshot derives text-to-image graphs from [Comfy-Org templates at 447747bf](https://github.com/Comfy-Org/workflow_templates/tree/447747bf37b7e2f6d5fab3f15288e03bf889b82f) and source schemas/model defaults from [ComfyUI at 46aad33e](https://github.com/Comfy-Org/ComfyUI/tree/46aad33e4d4c0696582611bf450dd93742fa9090). Its graphs are hand-specialized source-derived baselines, not converter executions or live runtime exports. Prompt enhancement is performed by the existing agent instead of an extra local LLM. The MOSS Base and SFT baselines deliberately use the matching 50-step/CFG-3/SLG-22 reference settings; their diffusion files remain separate. Krea's optional style LoRA is excluded. The earlier converter-provenance paragraph applies to Z-Image/Qwen, not these additional graphs. Each newer graph records its own source hashes and fixed core pin.

Authoritative model sources: [Black Forest Labs FLUX 3 Image Klein](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy) (FLUX Kommunity License; its text encoder/prompt upsampler have separate terms), [OpenMOSS MOSS-Image-Base](https://huggingface.co/OpenMOSS-Team/MOSS-Image-Base), [OpenMOSS MOSS-Image-SFT](https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT), and [native integration guide](https://github.com/OpenMOSS/MOSS-Image/blob/main/comfyui/README.md) (Apache-2.0), [Krea 2 Turbo](https://huggingface.co/krea/Krea-2-Turbo) and [Comfy-Org Krea export](https://huggingface.co/Comfy-Org/Krea-2) (Krea 2 Community License). ModelScope and hf-mirror records in `candidates.json` reflect compared metadata only; large model weights were not downloaded, gated access was not bypassed, and no actual image generation was performed on this computer.

```text
MIT License

Copyright (c) 2026 Rimagination
Copyright (c) 2023-present Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
