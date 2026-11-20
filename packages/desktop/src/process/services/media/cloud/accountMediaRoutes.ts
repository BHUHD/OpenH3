import type http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { generationSchema, mediaKind, mediaTarget } from './accountMediaBroker';
import type { CloudVideoService } from './CloudVideoService';

const scope = z.object({ requestId: z.string().uuid().optional(), conversationId: z.string().min(1).max(256) });
const bind = mediaTarget.extend({ ...scope.shape, requestId: z.string().uuid(), kind: mediaKind }).strict();
const preference = z.union([
  mediaTarget.extend({ kind: mediaKind }).strict(),
  z.object({ kind: mediaKind, modelId: z.null() }).strict(),
]);
type Json = (response: http.ServerResponse, status: number, data: unknown) => void;

/** Account defaults and immutable creation bindings can only be selected in the desktop UI. */
export async function accountMediaRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  service: CloudVideoService,
  uiAuthorized: boolean,
  json: Json
) {
  if (!path.startsWith('/api/cloud-video/account-')) return false;
  const route = path.slice('/api/cloud-video/account-'.length);
  if (route === 'bind' || route === 'default') {
    if (!uiAuthorized) {
      json(res, 403, { error: 'CLOUD_VIDEO_UI_AUTH_REQUIRED' });
      return true;
    }
    if (req.method === 'GET' && route === 'default') {
      json(res, 200, service.accountDefaults());
      return true;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    const data = await readBody(req, 4096);
    if (route === 'bind') {
      const v = bind.parse(data);
      service.bindAccount(v.kind, { accountId: v.accountId, modelId: v.modelId }, v.requestId, v.conversationId);
    } else {
      const v = preference.parse(data);
      service.setAccountDefault(v.kind, 'accountId' in v ? { accountId: v.accountId, modelId: v.modelId } : null);
    }
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method !== 'POST' || !['image', 'video'].includes(route)) {
    json(res, 404, { error: 'NOT_FOUND' });
    return true;
  }
  const input = scope
    .extend({
      input: generationSchema,
      submissionId: z.string().uuid().optional(),
      required: z.boolean().optional(),
      hasImageReferences: z.boolean().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .strict()
    .parse(await readBody(req, route === 'image' ? 160000 : 12 * 1024 * 1024));
  const runtime = {
    conversationId: input.conversationId,
    userId: typeof req.headers['x-openh3-user-id'] === 'string' ? req.headers['x-openh3-user-id'] : '',
    token: typeof req.headers['x-openh3-runtime-token'] === 'string' ? req.headers['x-openh3-runtime-token'] : '',
  };
  const selection = { requestId: input.requestId, conversationId: input.conversationId };
  if (route === 'image') {
    if (!service.accountSelection('image', selection) && !input.required && !input.requestId) {
      res.writeHead(204).end();
      return true;
    }
    if (input.hasImageReferences || input.input.seconds !== undefined || input.input.reference)
      throw new Error('CLOUD_MEDIA_IMAGE_INPUT_UNSUPPORTED');
    if ((input.width === undefined) !== (input.height === undefined)) throw new Error('CLOUD_MEDIA_SIZE_PAIR_REQUIRED');
    const target = await service.resolveAccount('image', selection, runtime);
    const response = await service.accountBroker.image(target, {
      prompt: input.input.prompt,
      size: input.width && input.height ? `${input.width}x${input.height}` : input.input.size,
    });
    const mime = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.body || !mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime))
      throw new Error('CLOUD_MEDIA_RESPONSE_INVALID');
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), res);
    } catch {
      res.destroy();
    }
  } else {
    if (!input.submissionId) throw new Error('CLOUD_MEDIA_SUBMISSION_ID_REQUIRED');
    const job = await service.submitAccount(selection, runtime, input.submissionId, input.input);
    json(res, 202, job);
  }
  return true;
}

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('CLOUD_MEDIA_INPUT_TOO_LARGE');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
