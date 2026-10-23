# Model preview media

These files are local renderer assets imported with Vite `?url` imports by `ComfyModelCards.tsx`, so they are included in the application bundle rather than fetched from a network at runtime. The labels distinguish a project's own result from an upstream model sample, and the sample model version is separate from the installed runtime profile version.

## Sources

- `h3-openh3-demo.mp4` and `h3-openh3-demo.webp`: compressed from [`docs/assets/openh3-demo.gif`](../../../../../../../docs/assets/openh3-demo.gif), a maintainer-provided real H3 / ComfyUI reference-to-video demo documented in [`docs/assets/README.md`](../../../../../../../docs/assets/README.md). This demonstrates OpenH3's H3 path; it is not a FastH3-Omni output.
- `fasth3-omni-official.mp4` and `.webp`: official sample supplied by Nuva Lab. Source page: <https://nuvalab.ai/fasth3/>. Original clip: <https://nuvalab.ai/blog/fasth3-omni-open-weights-release/samples/pink-suit-lamb-5s.mp4>; poster is from the same samples directory. It depicts `FastH3-Omni-8-Step-V1`. The card separately displays the actual installed profile version, or “not installed”.
- `qwen-edit-2509-official.webp`: the official Portrait Styles result/comparison image in Qwen's [`Qwen-Image-Edit-2509.md`](https://github.com/QwenLM/Qwen-Image/blob/6b5e1f5cec987d404be5ac6657db3b9aacb56a89/Qwen-Image-Edit-2509.md), pinned to repository revision `6b5e1f5cec987d404be5ac6657db3b9aacb56a89`. Original: <https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen-Image/edit2509/%E5%B9%BB%E7%81%AF%E7%89%871.JPG>. The card identifies the sample as `Qwen-Image-Edit-2509`.
- `z-image-official.webp`: official photorealistic showcase image in Tongyi-MAI's [`Z-Image README`](https://github.com/Tongyi-MAI/Z-Image/blob/26f23eda626ffadda020b04ff79488e1d72004cd/README.md#%EF%B8%8F-showcase), pinned to revision `26f23eda626ffadda020b04ff79488e1d72004cd`. The README identifies the showcase as `Z-Image-Turbo` output. Original: <https://media.githubusercontent.com/media/Tongyi-MAI/Z-Image/26f23eda626ffadda020b04ff79488e1d72004cd/assets/showcase_realistic.png>. The media URL serves the actual Git LFS object; the `raw.githubusercontent.com` URL serves only the LFS pointer.

Qwen and Z-Image source images were resized to 960 pixels wide and encoded as WebP for packaging; no generated/illustrative stock art is used for those two cards.

The three additional image cards use the actual WebP samples shipped with the official Comfy Org templates, copied without modification from revision `447747bf37b7e2f6d5fab3f15288e03bf889b82f` of `Comfy-Org/workflow_templates` (MIT, copyright 2023-present Comfy Org; attribution is retained in `resources/skills/comfyui-local/references/sources.md`). These are upstream samples, not results measured on the user's device:

- `flux-3-image-klein-official.webp`: [distilled FLUX 3 Image Klein template sample](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/447747bf37b7e2f6d5fab3f15288e03bf889b82f/templates/image_flux3_klein_distilled_t2i-1.webp), 74,124 bytes. The card labels the sample as distilled; the installed profile version is shown separately.
- `moss/moss-image-base-official.webp`: [MOSS-Image-Base template sample](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/447747bf37b7e2f6d5fab3f15288e03bf889b82f/templates/image_moss_image_base_t2i-1.webp), 37,870 bytes. This is the Base sample, not the separate SFT preview.
- `moss/moss-image-sft-official.webp`: [MOSS-Image-SFT official comparison sample](https://huggingface.co/OpenMOSS-Team/MOSS-Image-SFT/resolve/main/assets/comparison/sft.webp), 152,796 bytes. This is the SFT sample and is separate from the Base template sample.
- krea2-official.webp: [Krea 2 Turbo template sample](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/447747bf37b7e2f6d5fab3f15288e03bf889b82f/templates/image_krea2_turbo_t2i-1.webp), 42,024 bytes. This does not represent Krea 2 Raw or a verified local style-reference run.

## Packaged file SHA-256

| File                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `fasth3-omni-official.mp4`           | `c24a2d8c8423a4ec4a74c3d783ef28a1a8472515a2386e4e3747e98b3e6821db` |
| `fasth3-omni-official.webp`          | `3ef0100e1bcaa6caa0d36a85ef62d8f3fc0e224c63d1fbd4a481c17accc5b55c` |
| `h3-openh3-demo.mp4`                 | `b57ba8f6584d8b8f3aeb7daaedd050c66325fbd625323f444d95f4bf110b34d0` |
| `h3-openh3-demo.webp`                | `4d6d1360075dec23bcbe6cea4e0f26895be08e956e84277a5684076ab9b310cb` |
| `qwen-edit-2509-official.webp`       | `de89e3b9e7d5b869d6efef677db58b3bc38eefc02658aca6ac0146042aa15d4d` |
| `z-image-official.webp`              | `a5169d363bf90560d56975689e7a0743d233dfbec9822ededf28e79ec1888c1f` |
| `flux-3-image-klein-official.webp`   | `8215ca88476e5e58f09b1b34874bf06daf5e95f9b9ee0453771230c6a98bdebd` |
| `moss/moss-image-base-official.webp` | `939dd377f766ab78bdaf53c2ccb3083da17995494f7680f9171ada89a73528e5` |
| `moss/moss-image-sft-official.webp`  | `de1ba44f48d49e792b16aac26f2d260beefbcb9fbfa72f3ace363ff8a9917f71` |
| `krea2-official.webp`                | `ba214942f8b71a1cc70abb13ea7ffd337ff7a7c2b95cf4f4f1a18413143070f8` |

Original source SHA-256: Qwen `幻灯片1.JPG`, 181,036 bytes, `5fbe7bfc3c81e451ad86999f25f18c64aab1f17871a638e53f3db1aa05a8d925`; Z-Image `showcase_realistic.png`, 6,256,136 bytes, `697e6f6857f619314173508df72a14314cbb43e67475de7494123bb8b4f4eb2c` (matches the upstream Git LFS object ID).
