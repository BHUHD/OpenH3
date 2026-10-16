import type { ComfyFamily, ComfyIntent } from '@/common/chat/document/creation/comfy';

export type ComfyDraftIntent = {
  family: ComfyFamily;
  intent: Exclude<ComfyIntent, 'generate'>;
  profileId?: string;
};

let pendingIntent: ComfyDraftIntent | undefined;
export function readComfyDraftIntent() {
  return pendingIntent;
}
export function writeComfyDraftIntent(intent?: ComfyDraftIntent) {
  pendingIntent = intent;
}

export const COMFY_FAMILIES = [
  { family: 'h3', name: 'H3', kind: 'video' },
  { family: 'qwen-edit', name: 'Qwen-Edit', kind: 'image' },
  { family: 'z-image', name: 'Z-Image', kind: 'image' },
] as const;

/** Keep the target in metadata while leaving the installation request editable. */
export function comfyFamilyDetails(family: ComfyFamily) {
  return COMFY_FAMILIES.find((item) => item.family === family)!;
}
