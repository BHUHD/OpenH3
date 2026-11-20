import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifiedLoopbackFetch } from './accountMediaChannel';
import type { RemoteVideoJob } from '@/common/chat/document/creation/cloudVideo';
import { accountMediaId } from '@/common/chat/document/creation/accountMedia';

export const mediaKind = z.enum(['image', 'video']);
export const mediaTarget = z
  .object({
    accountId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
  })
  .strict();
export type MediaTarget = z.infer<typeof mediaTarget>;
export type MediaKind = z.infer<typeof mediaKind>;
export type BoundMediaTarget = MediaTarget & { binding: string };
export type MediaRuntime = { conversationId: string; userId: string; token: string };
export type MediaCore = { port: number; capability: string };
export const frameSchema = z
  .object({
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    data: z
      .string()
      .min(4)
      .max(Math.ceil((8 * 1024 * 1024) / 3) * 4),
  })
  .strict();
export const generationSchema = z
  .object({
    prompt: z.string().trim().min(1).max(32000),
    size: z
      .string()
      .regex(/^[1-9]\d{0,3}x[1-9]\d{0,3}$/)
      .refine((v) => v.split('x').every((n) => Number(n) <= 4096))
      .optional(),
    seconds: z.number().int().positive().max(3600).optional(),
    reference: frameSchema.optional(),
  })
  .strict();
export type AccountGeneration = z.infer<typeof generationSchema>;
const receipt = z.object({
  job_id: z.string().min(1),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed']),
});

async function result(response: Response): Promise<unknown> {
  const value = (await response.json()) as { success?: boolean; data?: unknown };
  if (value.success !== true) throw new Error('CLOUD_MEDIA_RESPONSE_INVALID');
  return value.data;
}

/** Native media operations only. This process never receives a gateway key or the account-control capability. */
export class AccountMediaBroker {
  constructor(
    private readonly context: () => MediaCore | undefined,
    private readonly fetcher?: typeof fetch
  ) {}

  private config(): MediaCore {
    const ctx = this.context();
    if (!ctx) throw new Error('CLOUD_MEDIA_CORE_UNAVAILABLE');
    return ctx;
  }

  private fetchCore(ctx: MediaCore, route: string, headers: Headers, signal: AbortSignal, body?: string) {
    if (this.fetcher)
      return this.fetcher(`http://127.0.0.1:${ctx.port}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body,
        signal,
        redirect: 'error',
      });
    return verifiedLoopbackFetch(
      ctx.port,
      '/api/cloud-account/media/challenge?nonce=',
      (nonce, signature, socket) => {
        // Core signs the observed TCP ports. A reply relayed from a different
        // connection or from a restarted listener cannot authorize this one.
        const expected = createHmac('sha256', ctx.capability)
          .update(['openh3:media:core:v1', nonce, socket.remotePort, socket.localPort].join('\0'))
          .digest();
        return signature.length === expected.length && timingSafeEqual(signature, expected);
      },
      route,
      Object.fromEntries(headers),
      body,
      signal
    );
  }

  async verify(runtime: MediaRuntime): Promise<void> {
    if (runtime.userId !== 'system_default_user' || !runtime.token || !runtime.conversationId)
      throw new Error('CLOUD_MEDIA_RUNTIME_REQUIRED');
    const response = await this.fetchCore(
      this.config(),
      '/api/runtime/conversations/verify',
      new Headers({
        'x-openh3-user-id': runtime.userId,
        'x-openh3-conversation-id': runtime.conversationId,
        'x-openh3-runtime-token': runtime.token,
      }),
      AbortSignal.timeout(5000)
    );
    if (response.body) await response.body.cancel();
    if (response.status !== 204) throw new Error('CLOUD_MEDIA_RUNTIME_REQUIRED');
  }

  private async call(path: string, body?: object): Promise<Response> {
    const ctx = this.config();
    const headers = new Headers({ 'x-openh3-cloud-capability': ctx.capability });
    if (body) {
      const bootstrap = await this.fetchCore(ctx, '/health', new Headers(), AbortSignal.timeout(5000));
      const csrf = bootstrap.headers
        .getSetCookie()
        .map((v) => /^aionui-csrf-token=([a-f0-9]{64})(?:;|$)/.exec(v)?.[1])
        .find(Boolean);
      await bootstrap.body?.cancel();
      if (!bootstrap.ok || !csrf) throw new Error('CLOUD_MEDIA_CORE_UNAVAILABLE');
      headers.set('cookie', `aionui-csrf-token=${csrf}`);
      headers.set('x-csrf-token', csrf);
      headers.set('content-type', 'application/json');
    }
    const response = await this.fetchCore(
      ctx,
      '/api/cloud-account/' + path,
      headers,
      AbortSignal.timeout(300000),
      body ? JSON.stringify(body) : undefined
    );
    if (!response.ok) {
      const error: unknown = await response.json().catch((): null => null);
      const e = error as { code?: unknown; error?: { code?: unknown } } | null;
      const code = e?.code ?? e?.error?.code;
      throw Object.assign(
        new Error(
          typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : `CLOUD_MEDIA_HTTP_${response.status}`
        ),
        { status: response.status }
      );
    }
    return response;
  }

  async resolve(
    target: MediaTarget,
    kind: MediaKind,
    conversationId: string,
    requestId?: string
  ): Promise<BoundMediaTarget> {
    const conversation = await this.fetchCore(
      this.config(),
      '/api/conversations/' + encodeURIComponent(conversationId),
      new Headers(),
      AbortSignal.timeout(5000)
    );
    if (!conversation.ok) throw new Error('CLOUD_MEDIA_CONVERSATION_UNAVAILABLE');
    const data = z
      .object({
        id: z.string(),
        extra: z
          .object({
            creation_request: z
              .object({
                requestId: z.string(),
                kind: mediaKind,
                source: z.enum(['local', 'cloud']),
                id: z.string(),
              })
              .nullish(),
          })
          .passthrough(),
      })
      .parse(await result(conversation));
    const creation = data.extra.creation_request;
    if (
      data.id !== conversationId ||
      (requestId
        ? !creation ||
          creation.requestId !== requestId ||
          creation.source !== 'cloud' ||
          creation.kind !== kind ||
          creation.id !== accountMediaId(target.accountId, target.modelId)
        : Boolean(creation))
    )
      throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    const current = await this.session();
    if (current.account_key !== target.accountId) throw new Error('CLOUD_MEDIA_ACCOUNT_CHANGED');
    // Core admits the exact model, modality and references against the live catalog at submission.
    return { ...target, binding: current.binding };
  }
  private async session() {
    return z
      .object({ account_id: z.string(), account_key: z.string().min(1), binding: z.string().min(1) })
      .parse(await result(await this.call('media/session')));
  }
  async assertAccount(target: BoundMediaTarget) {
    const current = await this.session();
    if (current.account_key !== target.accountId || current.binding !== target.binding)
      throw new Error('CLOUD_MEDIA_ACCOUNT_CHANGED');
  }

  image(target: BoundMediaTarget, input: Pick<AccountGeneration, 'prompt' | 'size'>) {
    return this.call('media/image', { ...input, binding: target.binding, model: target.modelId });
  }
  async video(target: BoundMediaTarget, input: AccountGeneration): Promise<RemoteVideoJob> {
    const job = receipt.parse(
      await result(await this.call('media/video', { ...input, binding: target.binding, model: target.modelId }))
    );
    return { id: job.job_id, status: job.status };
  }
  async status(target: BoundMediaTarget, jobId: string): Promise<RemoteVideoJob> {
    const job = receipt.parse(
      await result(await this.call('media/video/status', { binding: target.binding, job_id: jobId }))
    );
    return { id: job.job_id, status: job.status };
  }
  download(target: BoundMediaTarget, jobId: string) {
    return this.call('media/video/content', { binding: target.binding, job_id: jobId });
  }
}
