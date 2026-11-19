# OpenH3 Product Context

## Register

product

## Users

Content creators and local-model users work in a desktop Agent conversation to install models, generate images and videos, inspect outputs, and continue editing.

## Product Purpose

Help users reach a verified creative result through Agent reasoning, curated model knowledge, and local or cloud execution tools. Preserve working environments and keep real task status observable.

## Brand Personality

Studio light. The interface is a quiet graphite stage — neutral surfaces, restrained type, no decorative color — so generated images and videos can be the most vivid thing on screen. The one visual signature is the gen-light gradient (warm amber → magenta → daylight blue), reserved exclusively for active generation states and the primary creative entry point. Everything else defers to the work.

Reuse existing Arco components, semantic theme tokens, and the conversation-first layout. Motion is functional: it marks state changes (generation progress, panel open/close, result arrival) and respects prefers-reduced-motion.

## Anti-references

Avoid chat images that fill the message width and push most of a portrait below the viewport. Avoid cropped generation previews, forced landscape frames, decorative nested cards, and installation checklists imposed on generic task progress. Avoid scattering gen-light outside generation and creation contexts — overuse kills the signature.

## Design Principles

- Keep the user's conversation and next action visible around generated media.
- Preserve media aspect ratios and show the whole image in the inline preview.
- Separate a compact conversational preview from deliberate full-size inspection.
- Show real execution evidence and distinguish source tests from independent-device validation.
- Reuse existing component and theme conventions.

## Accessibility and Inclusion

Image previews must be keyboard reachable, retain alternative text, use visible focus, and allow closing enlarged views with Escape. Support narrow windows and the existing light/dark themes without adding decorative motion.
