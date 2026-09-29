# OpenH3 Product

## Release Position

OpenH3 is currently a technical preview Alpha. This repository does not yet bind a company identity, organization URL, trademark, or homepage. A future public repository may add the company homepage without changing the runtime compatibility identifiers.

## Users and Purpose

Video creators use a general-purpose agent to understand, generate and process media. Conversation is the primary workflow; video and image interactions provide concrete references. H3 installation is a separate capability and hardware validation does not block desktop development.

## Alpha Expectations

- The Windows package is unsigned and intended for evaluation, not formal production release.
- H3 models, runtime archives, and optional acceleration dependencies are downloaded on demand after hash verification and license acknowledgement; they are not covered by the OpenH3 Apache-2.0 source license.
- Conversation providers are BYOK: users configure their own provider credentials. No provider API key is included in source code, tests, or public builds.
- Local H3 support is validated against the documented PC09 profile. Other GPUs, operating systems, and model revisions require separate validation.
- Existing `com.aionui.app`, `aionui://`, `AIONUI_*`, and data-directory identifiers remain as legacy compatibility identifiers until a migration plan is approved.

## Known Release Gaps

Release requirements depend on what is distributed:

- Source publication: review the files and history being published, preserve applicable licenses and attribution, and exclude credentials and unauthorized assets. Windows signing and PC09 testing are not prerequisites for publishing source.
- Binary distribution (including Alpha): satisfy the licenses of the components actually shipped. Bundled GPL binaries need an appropriate corresponding-source delivery mechanism; applicable dependency license and notice obligations still apply to previews. Build-only tools do not automatically need to be included in the installer notice inventory.
- Model redistribution: per-file redistribution evidence is required for model, LoRA, converted, or workflow files that OpenH3 actually redistributes, including embedded workflows. User-supplied models do not require OpenH3 to obtain redistribution permission for absent files. Download integrations still need their own terms review.
- Quality validation: verify installation, first launch, and a representative task outside the development setup before claiming broad support. PC09 is one test target, not a mandatory machine. Dense/SLA comparisons apply to acceleration claims.
- Windows signing: recommended for publisher identity and installation trust, but not a universal prerequisite for an unsigned GitHub release. Signature status and Alpha/Beta/stable maturity are independent. Signing does not guarantee that SmartScreen will show no prompt.

Current evidence remains incomplete for the existing bundled binary. Keep the Alpha designation until stability is established; do not use it as an exemption from dependency license obligations.

## Design Principles

Preserve the existing AionUi Arco components, semantic colors, typography and keyboard accessibility. Add task-specific media controls rather than a new editor shell. Keep file references explicit, source media unchanged, and error/capability states honest. No marketing hero, decorative panels or mandatory full timeline. These principles follow the approved plan and existing repository conventions; no new brand is introduced.
