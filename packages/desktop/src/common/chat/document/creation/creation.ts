import type { ISessionMcpServer, TProviderWithModel } from '@/common/config/storage';
import type { ComfyFamily, ComfyIntent, ComfyProfile } from './comfy';

export type CreationKind = 'image' | 'video';
export type CreationSource = 'local' | 'cloud';
export type CreationModelState =
  | 'downloaded'
  | 'loadable'
  | 'verified'
  | 'invalid'
  | 'installed'
  | 'not-installed'
  | 'no-workflow'
  | 'configured'
  | 'not-configured'
  | 'unavailable'
  | 'checking';
export type CreationSelection = {
  kind: CreationKind;
  source: CreationSource;
  modelIds: Partial<Record<`${CreationSource}-${CreationKind}`, string>>;
};
export type CreationModel = {
  id: string;
  name: string;
  kind: CreationKind;
  source: CreationSource;
  state: CreationModelState;
  available: boolean;
  provider?: TProviderWithModel;
  profileId?: string;
  family?: ComfyFamily;
  intent?: ComfyIntent;
};
export type LocalCreationInventory = {
  h3: { installed: boolean; runtimeRunning: boolean; missingWorkflows: string[] };
  models: Array<{ id: string; name: string }>;
  profiles?: ComfyProfile[];
};
export type CreationRequest = Pick<
  CreationModel,
  'id' | 'name' | 'kind' | 'source' | 'state' | 'profileId' | 'family' | 'intent'
>;

/** Attach explicit user choices to the first turn without exposing credentials. */
export function creationMessage(input: string, summary: string): string {
  return `${input}\n\n${summary}`;
}

/** Copy only session transports; never update global model or MCP settings. */
export function creationSessionServers(
  servers: ISessionMcpServer[],
  request: CreationRequest,
  provider?: TProviderWithModel,
  requestId?: string
): ISessionMcpServer[] {
  return servers.map((server) => {
    if (!['aionui-video-media', 'aionui-image-generation'].includes(server.name) || server.transport.type !== 'stdio')
      return server;
    const env = {
      ...server.transport.env,
      AIONUI_CREATION_KIND: request.kind,
      AIONUI_CREATION_SOURCE: request.source,
      AIONUI_CREATION_MODEL: request.id,
      AIONUI_CREATION_INTENT: request.intent ?? 'generate',
      ...(request.family ? { AIONUI_CREATION_FAMILY: request.family } : {}),
      ...(request.profileId ? { AIONUI_CREATION_PROFILE: request.profileId } : {}),
      ...(requestId ? { AIONUI_CREATION_REQUEST_ID: requestId } : {}),
    };
    return {
      ...server,
      transport: {
        ...server.transport,
        env:
          server.name === 'aionui-image-generation' && provider
            ? {
                ...env,
                AIONUI_IMG_PROVIDER_ID: provider.id,
                AIONUI_IMG_PLATFORM: provider.platform,
                AIONUI_IMG_BASE_URL: provider.base_url,
                AIONUI_IMG_API_KEY: provider.api_key,
                AIONUI_IMG_MODEL: provider.use_model ?? '',
              }
            : env,
      },
    };
  });
}
