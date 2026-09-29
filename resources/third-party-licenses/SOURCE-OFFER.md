# Corresponding Source and Distribution Scope

OpenH3's public source repository contains the OpenH3 application source and
the fixed-version license texts listed in `NOTICE.OpenH3.txt`.

For a binary distribution that conveys GPL-covered components, the release
must provide corresponding source for the exact versions used by that binary.
The current Windows packaging configuration includes the separate Gyan
`ffmpeg.exe` / `ffprobe.exe` tools. Their complete corresponding-source
delivery has not yet been verified. No reduced-functionality packaging
variant is being substituted. Electron's separate `ffmpeg.dll` is part of
Electron and covered by Electron's bundled third-party notices.

The table below records component source locations; it is not a
claim that a complete matching source bundle has been published for the
earlier local preview installer. If a future OpenH3 release redistributes
these components, its release must provide the corresponding materials.

| Component | Fixed source | Action if redistributed by OpenH3 |
| --- | --- | --- |
| ComfyUI v0.35.0 | https://github.com/Comfy-Org/ComfyUI/tree/v0.35.0 | Publish matching source archive or stable source URL |
| ComfyUI-MAINodes | https://github.com/matlowai/ComfyUI-MAINodes/tree/f4868b4a08e8a504ce86db54a17961d399ffa2bc | Publish matching source and modification notice |
| ComfyUI-KJNodes | https://github.com/kijai/ComfyUI-KJNodes/tree/d3cfe21625e5170126ce06fbfcfe1d88108688c3 | Publish matching source and modification notice |
| FFmpeg 7.1.1 | https://github.com/FFmpeg/FFmpeg/tree/db69d06eee | Publish source/configuration offer for the exact build |

## Bundled FFmpeg binary evidence

The Windows preview package contains the static `ffmpeg.exe` and
`ffprobe.exe` from the Gyan Doshi `7.1.1-essentials_build-www.gyan.dev`
distribution. The files are GPLv3 builds (`--enable-gpl --enable-version3`) and
are not OpenH3 binaries:

| File | SHA-256 |
| --- | --- |
| `resources/ffmpeg/win32-x64/ffmpeg.exe` | `B90225987BDD042CCA09A1EFB5E34E9848F2D1DBF5FBCD388753A44145522997` |
| `resources/ffmpeg/win32-x64/ffprobe.exe` | `05E8FA639450F8191635192871AE37A3EC3E4638FA12F3B7D49C6522BA16A8ED` |

The immutable FFmpeg source snapshot identified by the distributor is
[`FFmpeg/FFmpeg@db69d06eee`](https://github.com/FFmpeg/FFmpeg/tree/db69d06eee).
The corresponding source archive is available at
<https://github.com/FFmpeg/FFmpeg/archive/db69d06eee.tar.gz> and has SHA-256
`F25B095FDCD6024566C831B000079011D014D028F049764AE73D35507F1F23B6`.
The build configuration and distributor README are recorded next to the
OpenH3 copy under `resources/ffmpeg/win32-x64/`.

This snapshot is evidence and a source pointer; it is **not claimed to be a
complete corresponding-source offer** for the Gyan binary. The static build
enables many external libraries (including x264/x265, libvpx, libass, libaom,
and others) whose exact source revisions, patches, and distributor build
scripts are not included in this repository. A public release that ships
these binaries needs a verified means of equivalent access to their complete
matching source and required build materials. Do not describe the current
preview installer as GPL-source-complete. This is a source-delivery task, not
a decision to remove FFmpeg or require users to install it separately.

## Network source delivery

GPLv3 section 6(d) permits equivalent source access on another server,
including an upstream server, with clear directions alongside the binary
download. It does not require every source file to be committed to OpenH3 or
embedded in the installer. OpenH3 must still ensure that the complete
corresponding source remains available for the required period. See the
bundled FFmpeg `LICENSE`, section 6(d), and the
[GNU GPLv3 text](https://www.gnu.org/licenses/gpl-3.0.html#section6).

For the existing Gyan 7.1.1 build, the verified source access is currently
limited to the FFmpeg core snapshot above. The distributor's
[release page](https://github.com/GyanD/codexffmpeg/releases/tag/7.1.1)
identifies that snapshot. Its automatic GitHub "Source code" archives contain
the `codexffmpeg` support repository (only a README at the 7.1.1 tag), not the
FFmpeg implementation or its dependency sources. The shipped distributor
README lists external-library versions, but that list alone does not verify
all required source, patches, or build-material download locations.

Release closure requires verifying those remaining locations or obtaining
the matching materials from the distributor, then placing the complete
source directions beside the OpenH3 installer download. The records here
do not assert that upstream lacks those materials; they state which evidence
OpenH3 has verified so far.

This document is an engineering release checklist, not a legal opinion.
