import fs from 'node:fs/promises';
import { accountMediaFetch, hasAccountDefault } from './accountMediaChannel';
import path from 'node:path';
import { imageBytesToDataUrl } from '@/common/chat/document/creation/imagesApi';
import { saveGeneratedImage } from '@/common/chat/imageGenCore';
import type { CloudVideoInput, CloudVideoJob } from '@/common/chat/document/creation/cloudVideo';
import type { TemplateSnapshot } from '@/common/contentCatalog/snapshot';

const env = (name: string) => process.env['OPENH3_' + name] ?? process.env['AIONUI_' + name];
const workspace = () => process.env.OPENH3_MEDIA_WORKSPACE || process.cwd();
export function accountCreationSelected(kind: 'image' | 'video') {
  return (
    env('CREATION_KIND') === kind &&
    env('CREATION_SOURCE') === 'cloud' &&
    env('CREATION_MODEL')?.startsWith('account-media:') === true
  );
}
export function canCheckAccountDefault(kind: 'image' | 'video') {
  return (
    !env('CREATION_REQUEST_ID')?.trim() &&
    process.env.OPENH3_MEDIA_DEFAULTS_DISABLED !== '1' &&
    !env('CREATION_KIND')?.trim() &&
    !env('CREATION_SOURCE')?.trim() &&
    !!env('CONVERSATION_ID')?.trim() &&
    hasAccountDefault(kind)
  );
}
async function request(kind: 'image' | 'video', payload: Record<string, unknown>) {
  const conversationId = env('CONVERSATION_ID');
  if (!conversationId) throw new Error('CLOUD_MEDIA_RUNTIME_REQUIRED');
  const requestId = env('CREATION_REQUEST_ID')?.trim() || undefined;
  const response = await accountMediaFetch(
    '/api/cloud-video/account-' + kind,
    {
      'content-type': 'application/json',
      'x-openh3-runtime-token': env('RUNTIME_TOKEN') ?? '',
      'x-openh3-user-id': env('USER_ID') ?? '',
    },
    JSON.stringify({ ...payload, requestId, conversationId, required: !!requestId }),
    AbortSignal.timeout(310000)
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(
      typeof error.error === 'string' && /^[A-Z0-9_]+$/.test(error.error)
        ? error.error
        : `CLOUD_MEDIA_HTTP_${response.status}`
    );
  }
  return response;
}

function size(width?: number, height?: number) {
  if (!width && !height) return undefined;
  if (!width || !height) throw new Error('CLOUD_MEDIA_SIZE_PAIR_REQUIRED');
  return `${width}x${height}`;
}

export async function accountImage(
  prompt: string,
  imageUris?: string[],
  width?: number,
  height?: number,
  templateSnapshot?: TemplateSnapshot
) {
  const response = await request('image', {
    input: { prompt },
    width,
    height,
    hasImageReferences: !!imageUris?.length,
  });
  if (response.status === 204) return undefined;
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > 32 * 1024 * 1024) throw new Error('CLOUD_MEDIA_IMAGE_TOO_LARGE');
  const dataUrl = imageBytesToDataUrl(data, response.headers.get('content-type') ?? undefined);
  const file = await saveGeneratedImage(
    dataUrl,
    workspace(),
    templateSnapshot
      ? {
          prompt,
          providerId: 'cloud_account',
          model: env('CREATION_MODEL') ?? '',
          templateSnapshot,
        }
      : undefined
  );
  return { content: [{ type: 'text' as const, text: `Generated image saved to: ${file}` }] };
}

async function firstFrame(file: string) {
  const root = await fs.realpath(workspace());
  const real = await fs.realpath(path.resolve(root, file));
  const relative = path.relative(root, real);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('CLOUD_MEDIA_REFERENCE_OUTSIDE_WORKSPACE');
  if ((await fs.stat(real)).size > 8 * 1024 * 1024) throw new Error('CLOUD_MEDIA_REFERENCE_TOO_LARGE');
  const bytes = await fs.readFile(real);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('CLOUD_MEDIA_REFERENCE_TOO_LARGE');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(imageBytesToDataUrl(bytes));
  if (!match) throw new Error('CLOUD_MEDIA_REFERENCE_FORMAT');
  return { mime_type: match[1], data: match[2] };
}
export async function accountVideo(input: CloudVideoInput, submissionId: string): Promise<CloudVideoJob> {
  if ((input.imagePaths?.length ?? 0) > 1)
    throw new Error('CLOUD_MEDIA_VIDEO_INPUT_UNSUPPORTED: send at most one workspace image as the first frame.');
  if (input.seed !== undefined || input.aspectRatio !== undefined)
    throw new Error(
      'CLOUD_MEDIA_VIDEO_INPUT_UNSUPPORTED: omit seed and supply width and height together for a requested size.'
    );
  const reference = input.imagePaths?.[0] ? await firstFrame(input.imagePaths[0]) : undefined;
  const response = await request('video', {
    submissionId,
    input: { prompt: input.prompt, size: size(input.width, input.height), seconds: input.duration, reference },
  });
  return response.json() as Promise<CloudVideoJob>;
}
