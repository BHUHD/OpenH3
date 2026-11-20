import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  cloudVideoConnectionSchema,
  cloudVideoInputSchema,
  H3_CLOUD_LORA_PATH,
  type CloudVideoConnectionInput,
  type CloudVideoConnection,
  type CloudVideoInput,
  type CloudVideoJob,
  type PublicVideoConnection,
  type RemoteVideoJob,
  type VideoAdapter,
} from '@/common/chat/document/creation/cloudVideo';
import { buildVideoForm, createVideoAdapter, validateVideoInput } from './videoAdapters';
import type {
  AccountMediaBroker,
  AccountGeneration,
  BoundMediaTarget,
  MediaKind,
  MediaRuntime,
  MediaTarget,
} from './accountMediaBroker';

type JobConnection = { account: BoundMediaTarget } | { connection: CloudVideoConnection };
type RecordJob = { job: CloudVideoJob } & JobConnection;
type AccountScope = { conversationId: string; requestId?: string };
function persistJson(filename: string, value: unknown) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, filename);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 5)
          throw error;
        // A Windows reader may briefly prevent atomic replacement.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
      }
    }
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write or replacement error.
    }
    throw error;
  }
}
function publicJob(record: RecordJob): CloudVideoJob {
  if ('connection' in record) return { ...record.job };
  const { remoteId: _handle, ...job } = record.job;
  return job;
}
type State = {
  connections: CloudVideoConnection[];
  bindings: Record<string, { conversationId: string; connectionId: string; managed?: boolean }>;
  jobs: RecordJob[];
  accountTargets?: Record<string, MediaTarget>;
  accountBindings?: Record<string, MediaTarget & { conversationId: string; kind: MediaKind }>;
};
type Options = {
  root: string;
  adapter?: (connection: CloudVideoConnection) => VideoAdapter;
  accountBroker?: AccountMediaBroker;
  signChallenge?: (challenge: Buffer) => string;
  verifyManagedOutput?: (file: string) => Promise<void>;
};

/** Owns cloud credentials, immutable job connections and durable single-submission identities. */
export class CloudVideoService {
  private state: State;
  private readonly filename: string;
  private readonly active = new Set<string>();
  private readonly playbackKey = randomBytes(32);
  private polling = false;
  private closed = false;
  constructor(private readonly options: Options) {
    fs.mkdirSync(options.root, { recursive: true });
    this.filename = path.join(options.root, 'cloud-video.json');
    this.state = fs.existsSync(this.filename)
      ? (JSON.parse(fs.readFileSync(this.filename, 'utf8')) as State)
      : { connections: [], bindings: {}, jobs: [] };
    for (const { job } of this.state.jobs) {
      if (!job.remoteId && ['queued', 'running'].includes(job.status)) {
        Object.assign(job, { status: 'failed', submissionUncertain: true, error: 'CLOUD_VIDEO_SUBMISSION_UNCERTAIN' });
      }
    }
    this.persist();
  }
  private persist(): void {
    persistJson(this.filename, this.state);
  }
  connections(): PublicVideoConnection[] {
    return this.state.connections.map(({ apiKey, ...connection }) => ({ ...connection, hasApiKey: Boolean(apiKey) }));
  }
  get accountBroker() {
    if (!this.options.accountBroker) throw new Error('CLOUD_MEDIA_CORE_UNAVAILABLE');
    return this.options.accountBroker;
  }
  challenge(challenge: Buffer) {
    if (!this.options.signChallenge) throw new Error('CLOUD_MEDIA_CORE_UNAVAILABLE');
    return this.options.signChallenge(challenge);
  }
  private get preferenceFile() {
    return path.join(this.options.root, 'account-defaults.json');
  }
  private preferences(): Partial<Record<MediaKind, string>> {
    if (!fs.existsSync(this.preferenceFile)) return {};
    return JSON.parse(fs.readFileSync(this.preferenceFile, 'utf8')) as Partial<Record<MediaKind, string>>;
  }
  accountDefaults(): Partial<Record<MediaKind, MediaTarget>> {
    const choices = this.preferences();
    const selected: Partial<Record<MediaKind, MediaTarget>> = {};
    for (const kind of ['image', 'video'] as const) {
      if (choices[kind]) {
        const target = this.state.accountTargets?.[choices[kind]];
        if (!target) throw new Error('CLOUD_MEDIA_DEFAULT_INVALID');
        selected[kind] = target;
      }
    }
    return selected;
  }
  setAccountDefault(kind: MediaKind, target: MediaTarget | null) {
    const selected = this.preferences();
    const prior = selected[kind];
    if (target) {
      const id = randomUUID();
      (this.state.accountTargets ??= {})[id] = { ...target };
      this.persist();
      selected[kind] = id;
    } else delete selected[kind];
    // The reference file is the single preference commit. MCP can read selection
    // presence offline without reading account IDs or existing BYOK credentials.
    persistJson(this.preferenceFile, selected);
    if (prior && this.state.accountTargets) {
      delete this.state.accountTargets[prior];
      this.persist();
    }
  }
  bindAccount(kind: MediaKind, target: MediaTarget, requestId: string, conversationId: string) {
    this.state.accountBindings ??= {};
    const prior = this.state.accountBindings[requestId];
    if (
      this.state.bindings[requestId] ||
      (prior &&
        (prior.conversationId !== conversationId ||
          prior.kind !== kind ||
          prior.accountId !== target.accountId ||
          prior.modelId !== target.modelId))
    )
      throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    this.state.accountBindings[requestId] = { ...target, kind, conversationId };
    this.persist();
  }
  accountSelection(kind: MediaKind, scope: AccountScope): MediaTarget | undefined {
    if (!scope.requestId) return this.accountDefaults()[kind];
    const ref = this.state.accountBindings?.[scope.requestId];
    if (ref && (ref.kind !== kind || ref.conversationId !== scope.conversationId))
      throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    return ref;
  }
  async resolveAccount(kind: MediaKind, scope: AccountScope, runtime: MediaRuntime): Promise<BoundMediaTarget> {
    if (runtime.conversationId !== scope.conversationId) throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    const ref = this.accountSelection(kind, scope);
    if (!ref) throw new Error('CLOUD_MEDIA_NOT_SELECTED');
    await this.accountBroker.verify(runtime);
    const target = await this.accountBroker.resolve(
      { accountId: ref.accountId, modelId: ref.modelId },
      kind,
      scope.conversationId,
      scope.requestId
    );
    if (ref !== this.accountSelection(kind, scope)) throw new Error('CLOUD_MEDIA_SELECTION_CHANGED');
    return target;
  }
  async submitAccount(scope: AccountScope, runtime: MediaRuntime, submissionId: string, input: AccountGeneration) {
    const requestId = scope.requestId ?? scope.conversationId;
    const matches = (r: RecordJob) =>
      'account' in r &&
      r.job.conversationId === scope.conversationId &&
      r.job.requestId === requestId &&
      r.job.submissionId === submissionId;
    const prior = this.state.jobs.find(matches);
    if (prior) {
      await this.accountBroker.verify(runtime);
      if ('account' in prior) await this.accountBroker.assertAccount(prior.account);
      return publicJob(prior);
    }
    const account = await this.resolveAccount('video', scope, runtime);
    const duplicate = this.state.jobs.find(matches);
    if (duplicate) return publicJob(duplicate);
    const [width, height] = input.size?.split('x').map(Number) ?? [];
    return this.startJob(
      {
        requestId,
        submissionId,
        conversationId: scope.conversationId,
        connectionId: 'account-media',
        model: account.modelId,
        width,
        height,
      },
      { account },
      () => this.accountBroker.video(account, input)
    );
  }
  saveConnection(raw: CloudVideoConnectionInput): PublicVideoConnection {
    const input = cloudVideoConnectionSchema.parse(raw);
    const previous = this.state.connections.find((connection) => connection.id === input.id);
    const baseUrl = input.baseUrl.replace(/\/+$/, '');
    const sameEndpoint = previous?.baseUrl === baseUrl && previous.protocol === input.protocol;
    const apiKey = input.apiKey === undefined && sameEndpoint ? previous.apiKey : (input.apiKey?.trim() ?? '');
    if (input.protocol === 'openai-video' && (!apiKey || !input.model))
      throw new Error('CLOUD_VIDEO_MODEL_KEY_REQUIRED');
    const connection: CloudVideoConnection = {
      ...input,
      id: input.id ?? randomUUID(),
      baseUrl,
      apiKey,
      ...(input.protocol === 'vllm-h3' ? { loraPath: input.loraPath ?? H3_CLOUD_LORA_PATH } : {}),
    };
    this.state.connections = [...this.state.connections.filter((item) => item.id !== connection.id), connection];
    this.persist();
    return this.connections().find((item) => item.id === connection.id)!;
  }
  bind(requestId: string, conversationId: string, connectionId: string, managed = false): void {
    if (this.state.accountBindings?.[requestId]) throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    if (!this.state.connections.some((item) => item.id === connectionId))
      throw new Error('CLOUD_VIDEO_CONNECTION_MISSING');
    const prior = this.state.bindings[requestId];
    if (
      prior &&
      (prior.conversationId !== conversationId ||
        prior.connectionId !== connectionId ||
        Boolean(prior.managed) !== managed)
    )
      throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    this.state.bindings[requestId] = { conversationId, connectionId, ...(managed ? { managed } : {}) };
    this.persist();
  }
  async submit(
    requestId: string,
    raw: CloudVideoInput,
    submissionId = requestId,
    expected?: Pick<CloudVideoConnection, 'protocol' | 'baseUrl'>
  ): Promise<CloudVideoJob> {
    const matches = (record: RecordJob): boolean =>
      'connection' in record &&
      record.job.requestId === requestId &&
      (record.job.submissionId ?? record.job.requestId) === submissionId;
    const prior = this.state.jobs.find(matches);
    if (prior) return { ...prior.job };
    const binding = this.state.bindings[requestId];
    if (!binding) throw new Error('CLOUD_VIDEO_BINDING_REQUIRED');
    if (Boolean(binding.managed) !== Boolean(expected)) throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    const connection = this.state.connections.find((item) => item.id === binding.connectionId);
    if (!connection) throw new Error('CLOUD_VIDEO_CONNECTION_MISSING');
    if (expected && (expected.protocol !== connection.protocol || expected.baseUrl !== connection.baseUrl))
      throw new Error('CREATION_CLOUD_CONNECTION_CHANGED');
    const input = cloudVideoInputSchema.parse(raw);
    validateVideoInput(connection, input);
    // Validate every local upload before reserving the submission identity.
    if (!this.options.adapter) await buildVideoForm(connection, input);
    const duplicate = this.state.jobs.find(matches);
    if (duplicate) return { ...duplicate.job };
    const snapshot = { ...connection };
    return this.startJob(
      {
        requestId,
        submissionId,
        conversationId: binding.conversationId,
        connectionId: binding.connectionId,
        model: connection.model || connection.name,
        aspectRatio: input.aspectRatio,
        width: input.width,
        height: input.height,
      },
      { connection: snapshot },
      () => (this.options.adapter ?? createVideoAdapter)(snapshot).submit(input)
    );
  }
  private async startJob(
    identity: Pick<
      CloudVideoJob,
      'requestId' | 'submissionId' | 'conversationId' | 'connectionId' | 'model' | 'width' | 'height' | 'aspectRatio'
    >,
    route: JobConnection,
    submit: () => Promise<RemoteVideoJob>
  ) {
    const job: CloudVideoJob = {
      ...identity,
      id: randomUUID(),
      status: 'queued',
      progress: 0,
      progressKnown: false,
      stage: 'submitting',
      createdAt: new Date().toISOString(),
    };
    const record = { job, ...route };
    this.state.jobs.push(record);
    this.persist();
    this.active.add(job.id);
    try {
      const remote = await submit();
      job.remoteId = remote.id;
      job.status = remote.status === 'failed' ? 'failed' : remote.status === 'queued' ? 'queued' : 'running';
      job.stage = remote.status === 'failed' ? 'failed' : remote.status === 'queued' ? 'queued' : 'generating';
      job.progressKnown = remote.progress !== undefined;
      job.progress = remote.progress ?? 0;
      job.lastCheckedAt = job.updatedAt = new Date().toISOString();
      if (remote.status === 'failed') job.error = 'CLOUD_VIDEO_GENERATION_FAILED';
      this.persist();
    } catch (error) {
      // An HTTP rejection proves no accepted job; a lost response does not.
      const status = (error as { status?: number }).status;
      Object.assign(job, {
        status: 'failed',
        stage: 'failed',
        submissionUncertain: !status || status >= 500,
        error:
          'account' in record && error instanceof Error && /^CLOUD_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : status
              ? `CLOUD_VIDEO_HTTP_${status}`
              : 'CLOUD_VIDEO_SUBMISSION_UNCERTAIN',
      });
      this.persist();
    } finally {
      this.active.delete(job.id);
    }
    return publicJob(record);
  }
  private adapter(record: RecordJob): Pick<VideoAdapter, 'retrieve' | 'download'> {
    if ('account' in record)
      return {
        retrieve: (id) => this.accountBroker.status(record.account, id),
        download: (id) => this.accountBroker.download(record.account, id),
      };
    return (this.options.adapter ?? createVideoAdapter)(record.connection);
  }
  job(id: string, scope: string): CloudVideoJob {
    return publicJob(this.jobRecord(id, scope));
  }
  private jobRecord(id: string, scope: string) {
    const record = this.state.jobs.find((item) => item.job.id === id);
    if (!record) throw new Error('CLOUD_VIDEO_JOB_MISSING');
    if (scope !== record.job.conversationId && scope !== record.job.requestId)
      throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
    return record;
  }
  async authorizeJobRead(
    id: string,
    scope: string,
    uiAuthorized: boolean,
    runtime: MediaRuntime,
    playbackToken?: string
  ) {
    const record = this.jobRecord(id, scope);
    if ('connection' in record) return undefined;
    const token = createHmac('sha256', this.playbackKey)
      .update(JSON.stringify([id, record.job.conversationId, record.account.binding]))
      .digest('hex');
    if (playbackToken !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(playbackToken) || !timingSafeEqual(Buffer.from(playbackToken), Buffer.from(token)))
        throw new Error('CLOUD_MEDIA_PLAYBACK_UNAUTHORIZED');
    } else if (!uiAuthorized) {
      if (!runtime.token) throw new Error('CLOUD_MEDIA_RUNTIME_REQUIRED');
      if (record.job.conversationId !== runtime.conversationId) throw new Error('CLOUD_VIDEO_SCOPE_MISMATCH');
      await this.accountBroker.verify(runtime);
    }
    await this.accountBroker.assertAccount(record.account);
    return uiAuthorized && record.job.status === 'succeeded' ? token : undefined;
  }
  artifact(id: string, scope: string): string {
    if (this.job(id, scope).status !== 'succeeded') throw new Error('CLOUD_VIDEO_NOT_COMPLETE');
    return path.join(this.options.root, `${id}.mp4`);
  }
  private async download(record: RecordJob): Promise<void> {
    record.job.status = 'running';
    record.job.stage = 'downloading';
    record.job.downloadBytes = 0;
    record.job.downloadTotalBytes = undefined;
    record.job.updatedAt = new Date().toISOString();
    this.persist();
    const response = await this.adapter(record).download(record.job.remoteId!);
    if (!response.ok || !response.body) throw new Error('CLOUD_VIDEO_DOWNLOAD_FAILED');
    const total = Number(response.headers.get('content-length'));
    if (Number.isSafeInteger(total) && total > 0) record.job.downloadTotalBytes = total;
    const temp = path.join(this.options.root, `${record.job.id}.part`);
    const target = path.join(this.options.root, `${record.job.id}.mp4`);
    const fd = fs.openSync(temp, 'w');
    let size = 0;
    let header = Buffer.alloc(0);
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        record.job.downloadBytes = size;
        record.job.updatedAt = new Date().toISOString();
        if (size > 1024 * 1024 * 1024) throw new Error('CLOUD_VIDEO_OUTPUT_TOO_LARGE');
        if (header.length < 12) header = Buffer.concat([header, Buffer.from(value)]).subarray(0, 12);
        fs.writeSync(fd, value);
      }
      if (size < 12 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('CLOUD_VIDEO_INVALID_MP4');
    } catch (error) {
      await reader.cancel().catch((): undefined => undefined);
      fs.closeSync(fd);
      fs.rmSync(temp, { force: true });
      throw error;
    }
    fs.closeSync(fd);
    if (this.state.bindings[record.job.requestId]?.managed && this.options.verifyManagedOutput) {
      try {
        await this.options.verifyManagedOutput(temp);
      } catch {
        fs.rmSync(temp, { force: true });
        throw new Error('CLOUD_VIDEO_OUTPUT_VERIFICATION_FAILED');
      }
    }
    fs.renameSync(temp, target);
  }
  async poll(): Promise<void> {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      for (const record of this.state.jobs) {
        const { job } = record;
        if (!job.remoteId || !['queued', 'running'].includes(job.status) || this.active.has(job.id)) continue;
        try {
          const remote = await this.adapter(record).retrieve(job.remoteId);
          if (remote.id !== job.remoteId) throw new Error('CLOUD_VIDEO_REMOTE_ID_MISMATCH');
          job.error = undefined;
          job.progressKnown = remote.progress !== undefined;
          job.progress = remote.progress ?? 0;
          job.lastCheckedAt = job.updatedAt = new Date().toISOString();
          if (remote.status === 'failed') {
            job.status = 'failed';
            job.stage = 'failed';
            job.error = 'CLOUD_VIDEO_GENERATION_FAILED';
          } else if (remote.status === 'completed') {
            await this.download(record);
            job.status = 'succeeded';
            job.stage = 'completed';
            job.progressKnown = true;
            job.progress = 100;
          } else {
            job.status = remote.status === 'queued' ? 'queued' : 'running';
            job.stage = remote.status === 'queued' ? 'queued' : 'generating';
          }
        } catch (error) {
          const status = (error as { status?: number }).status;
          const outputError =
            error instanceof Error &&
            [
              'CLOUD_VIDEO_INVALID_MP4',
              'CLOUD_VIDEO_OUTPUT_TOO_LARGE',
              'CLOUD_VIDEO_OUTPUT_VERIFICATION_FAILED',
            ].includes(error.message)
              ? error.message
              : undefined;
          const expiredGrant =
            'account' in record && status === 409 && error instanceof Error && error.message === 'CLOUD_CONFLICT';
          const permanent = status !== undefined && [400, 401, 403, 404, 422].includes(status);
          if (permanent || outputError || expiredGrant) {
            job.status = 'failed';
            job.stage = 'failed';
          }
          job.error =
            outputError ??
            (expiredGrant
              ? 'CLOUD_CONFLICT'
              : status === 404
                ? 'CLOUD_VIDEO_REMOTE_LOST'
                : permanent
                  ? `CLOUD_VIDEO_HTTP_${status}`
                  : 'CLOUD_VIDEO_CONNECTION_RETRYING');
        }
        this.persist();
      }
    } finally {
      this.polling = false;
    }
  }
  updateIdle(): boolean {
    // Remote work survives a client update; only local requests/downloads need to drain.
    return !this.polling && !this.active.size;
  }
  close(): void {
    this.closed = true;
  }
}
