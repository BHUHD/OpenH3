# Embedded H3 workflow provenance and license scope

OpenH3 embeds the three unmodified API workflow files listed below in
`packages/desktop/src/process/services/runtime/h3EmbeddedWorkflows.json`, encoded
as Base64. `h3DownloadPlan.ts` supplies these bytes directly during environment
setup. They are distributed with the application, even though the model weights
and ComfyUI runtime are downloaded separately.

## Fixed upstream source

- Repository: [MATLOWAI/minimax-h3-fused-turbo-int8-convrot](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot)
- Revision: `8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3`
- [Upstream README at this revision](https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot/blob/8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3/README.md)
- Verification date: 2026-09-29. Each remote file's SHA256 matched the decoded
  embedded bytes; no workflow content was changed when adding these notices.

| Path in the upstream repository | Bytes | SHA256 |
| --- | ---: | --- |
| `workflows/lowvram/01_reference_4step_sla_lowvram.api.json` | 4139 | `f622f57e30056f45355079203e7d3fc6ea4db60451686293d1eda47c9f471487` |
| `workflows/lowvram/04_i2v_fl2v_4step_sla_lowvram.api.json` | 4327 | `5993d7f12f7cb43cb446d8c71c1a6c56d0c35dfc49cf6998db64979de70f6f4d` |
| `workflows/lowvram/05_ref2va_4step_sla_lowvram.api.json` | 4737 | `c3bf8dc9bb5d8265648f5a49d31c4323a1f132206ddc3a4230c4e5e07bd979c4` |

Resolve each file using
`https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot/resolve/8a8dffaa0cd99c6184833ae0a3b4e9b0089c17b3/`
followed by its path above.

## Preserved upstream legal files

These files were downloaded without editing from the root of the same revision:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| [LICENSE](LICENSE) | 17604 | `59b99642b95ea21630e311198ddbfffbfe05aadba0c2f5d884cbdf4efcc90f44` |
| [LICENSE-APACHE](LICENSE-APACHE) | 11358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| [NOTICE](NOTICE) | 927 | `be45471aeeaa436495761eae8247959a6ef70dd5dfac2ce4b676d35942894edc` |

`LICENSE` is the MiniMax H3 Community License Agreement. The upstream README
specifically attributes `LICENSE-APACHE` to the merged turbo LoRA; preserving
that file does not establish an Apache-2.0 grant for these workflow graphs.
The upstream NOTICE describes the model's ancestry and modifications, and is
preserved as upstream context; it does not mean OpenH3 bundles those weights.
No workflow-specific permissive license was found in the fixed revision.
OpenH3's root Apache-2.0 license does not override these third-party terms.

## Distribution conditions and remaining scope clarification

The upstream agreement includes geographic restrictions (excluding the EU,
UK, Republic of Korea and USA), providing the agreement and NOTICE to recipients,
prominent modification notices for modified files, downstream use restrictions,
and safeguards/reporting requirements. Read the preserved agreement for the
complete terms. This provenance record does not certify compliance with those
conditions or grant worldwide redistribution rights.

The application already asks downloading users to accept model/runtime terms
and confirm they are outside the excluded territories. That confirmation occurs
after installation and does not, by itself, establish the right to distribute
embedded workflow bytes worldwide. A separate workflow license or applicable
authorization from the rights holder should be recorded before asserting that
these files may be distributed globally without the upstream restrictions.

This directory preserves the known source and notices; it is not a statement
that any maintainer lacks an authorization held outside the repository.
