import { registerProductTool } from './toolAliases';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for image generation.
 * Runs as a standalone stdio process spawned by the MCP client.
 * Reads provider config from environment variables.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from './constants';
import { executeImageGeneration } from '@/common/chat/imageGenCore';
import type { TProviderWithModel } from '@/common/config/storage';
import {
  comfyGenerationInputSchema,
  type ComfyGenerationInput,
  type ComfyGenerationJob,
  type ComfyProfile,
} from '@/common/chat/document/creation/comfy';
import path from 'node:path';
import type { TemplateSnapshot } from '@/common/contentCatalog/snapshot';

type CreationSelection = {
  profileId?: string;
  family?: string;
  intent: string;
  source?: 'local' | 'cloud';
  kind?: 'image' | 'video';
  templateSnapshot?: TemplateSnapshot;
};

async function comfyRequest(endpoint: string, body?: unknown): Promise<unknown> {
  const response = await fetch(
    `http://127.0.0.1:${Number(process.env.OPENH3_MEDIA_PORT ?? process.env.AIONUI_MEDIA_PORT ?? 33002)}${endpoint}`,
    {
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45_000),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `MEDIA_SERVICE_HTTP_${response.status}`);
  return data;
}

function envValue(canonical: string, legacy: string): string | undefined {
  return process.env[canonical] ?? process.env[legacy];
}

async function localImageGeneration(
  prompt: string,
  imageUris: string[] | undefined,
  dimensions: Pick<ComfyGenerationInput, 'width' | 'height'>,
  requestId: string,
  profiles: ComfyProfile[],
  selection: CreationSelection
) {
  if (!selection.profileId) throw new Error('COMFY_SELECTED_PROFILE_REQUIRED');
  const profile = profiles.find((candidate) => candidate.id === selection.profileId);
  if (!profile || profile.kind !== 'image') throw new Error('CREATION_IMAGE_NOT_SELECTED');
  return submitLocalImage(profile.id, { requestId }, localImageInput(prompt, imageUris, dimensions));
}

function localImageInput(
  prompt: string,
  imageUris: string[] | undefined,
  dimensions: Pick<ComfyGenerationInput, 'width' | 'height'>
) {
  if (imageUris?.some((uri) => /^https?:\/\//i.test(uri))) throw new Error('COMFY_LOCAL_IMAGE_PATH_REQUIRED');
  return comfyGenerationInputSchema.parse({
    prompt,
    ...dimensions,
    ...(imageUris?.length ? { imagePaths: imageUris.map((uri) => path.resolve(uri)) } : {}),
  });
}

async function submitLocalImage(
  profileId: string,
  scope: { requestId: string } | { conversationId: string },
  input: ComfyGenerationInput
) {
  const job = (await comfyRequest('/api/comfy/jobs', {
    profileId,
    input,
    ...scope,
  })) as ComfyGenerationJob;
  return { content: [{ type: 'text' as const, text: JSON.stringify({ comfyJobId: job.id, job }) }] };
}

// Read provider config from environment variables
function getProviderFromEnv(): TProviderWithModel | null {
  const platform = envValue('OPENH3_IMG_PLATFORM', 'AIONUI_IMG_PLATFORM');
  const base_url = envValue('OPENH3_IMG_BASE_URL', 'AIONUI_IMG_BASE_URL');
  const api_key = envValue('OPENH3_IMG_API_KEY', 'AIONUI_IMG_API_KEY');
  const model = envValue('OPENH3_IMG_MODEL', 'AIONUI_IMG_MODEL');

  if (!platform || !model) {
    return null;
  }

  return {
    id: BUILTIN_IMAGE_GEN_ID,
    name: BUILTIN_IMAGE_GEN_NAME,
    platform,
    base_url: base_url || '',
    api_key: api_key || '',
    use_model: model,
  };
}

async function main() {
  const server = new McpServer({
    name: BUILTIN_IMAGE_GEN_NAME,
    version: '1.0.0',
  });

  const registerImageGenerationTool = (name: string) =>
    registerProductTool(
      server,
      name,
      'Generate or edit an actual image. A bound creation session keeps its selected source and model. Ordinary chats use the configured image provider or automatically choose a compatible installed local image workflow if no cloud image model is configured. Pass all input images and preserve requested dimensions or aspect ratio by specifying width and height for local generation. Preserve exact text in the prompt. For named local models or specific reference roles (identity, style, structure, masks), use openh3_comfy_profiles, openh3_comfy_resolve_workflow and openh3_comfy_generate instead. On no matching workflow, inspect and prepare local routes with the comfyui-local skill under current permissions before treating configuration as a blocker. When a local job is queued, retain comfyJobId, use openh3_comfy_job_status waitMs=30000 until terminal, and deliver the actual result.',
      {
        prompt: z
          .string()
          .describe(
            'The generation description or image-edit instruction. Preserve the requested local model and source image roles.'
          ),
        image_uris: z
          .array(z.string())
          .optional()
          .describe(
            'Optional: Array of paths to existing local image files or HTTP/HTTPS URLs to edit/modify. Examples: ["test.jpg", "https://example.com/img.png"]. For single image, use array format: ["test.jpg"]. Relative paths are resolved against the current working directory.'
          ),
        width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Local image width in pixels. For a 3:4 portrait, for example, pass 768.'),
        height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Local image height in pixels. For a 3:4 portrait at width 768, pass 1024.'),
      },
      async ({ prompt, image_uris, width, height }) => {
        const dimensions = { width, height };
        const requestId = envValue('OPENH3_CREATION_REQUEST_ID', 'AIONUI_CREATION_REQUEST_ID');
        let resolvedCloudSelection = false;
        let templateSnapshot: TemplateSnapshot | undefined;
        if (requestId?.trim()) {
          try {
            const result = (await comfyRequest(`/api/comfy/profiles?${new URLSearchParams({ requestId })}`)) as {
              profiles: ComfyProfile[];
              selection?: CreationSelection;
            };
            const selection = result.selection;
            if (!selection) throw new Error('COMFY_SELECTION_CONTEXT_MISSING');
            if (selection.kind === 'video' || selection.family === 'h3') throw new Error('CREATION_IMAGE_NOT_SELECTED');
            if (selection.intent !== 'generate') throw new Error('CREATION_GENERATION_NOT_SELECTED');
            if (selection.source === 'local' || selection.family || selection.profileId) {
              return await localImageGeneration(prompt, image_uris, dimensions, requestId, result.profiles, selection);
            }
            if (selection.source !== 'cloud') throw new Error('COMFY_SELECTION_CONTEXT_MISSING');
            templateSnapshot = selection.templateSnapshot;
            resolvedCloudSelection = true;
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Local image generation failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
            };
          }
        }
        if (!resolvedCloudSelection && envValue('OPENH3_CREATION_KIND', 'AIONUI_CREATION_KIND') === 'video')
          return {
            isError: true,
            content: [
              { type: 'text' as const, text: 'The user selected video generation. Ask before switching to an image.' },
            ],
          };
        if (!resolvedCloudSelection && envValue('OPENH3_CREATION_SOURCE', 'AIONUI_CREATION_SOURCE') === 'local') {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'CREATION_REQUEST_CONTEXT_MISSING: local generation requires a bound creation session and selected registered ComfyUI profile. Use the comfyui-local skill to prepare or select that profile.',
              },
            ],
          };
        }
        const provider = getProviderFromEnv();
        if (!provider) {
          const conversationId = envValue('OPENH3_CONVERSATION_ID', 'AIONUI_CONVERSATION_ID');
          if (!resolvedCloudSelection && conversationId?.trim()) {
            try {
              const input = localImageInput(prompt, image_uris, dimensions);
              if (!input.imagePaths?.length) input.requirements = { task: 'text-to-image' };
              const scope = { conversationId };
              const route = (await comfyRequest('/api/comfy/workflows/resolve', {
                ...scope,
                autoSelectImage: true,
                input,
              })) as { selectedProfileId?: string };
              if (route.selectedProfileId) return await submitLocalImage(route.selectedProfileId, scope, input);
              throw new Error(
                'COMFY_NO_COMPATIBLE_IMAGE_WORKFLOW: inspect openh3_comfy_profiles and prepare a compatible local route before asking the user to configure a cloud provider.'
              );
            } catch (error) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: `Local image generation failed: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
              };
            }
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Image generation model not configured. Please select an image generation model in Settings > Tools.',
              },
            ],
            isError: true,
          };
        }

        const proxy = envValue('OPENH3_IMG_PROXY', 'AIONUI_IMG_PROXY') || undefined;
        // Trusted workspace root: the MCP server inherits the agent process cwd,
        // which the backend sets to the conversation workspace. Never accept a
        // workspace path from the model (path traversal boundary).
        const workspaceDir = process.cwd();

        const result = await executeImageGeneration(
          { prompt, image_uris, ...(templateSnapshot ? { templateSnapshot } : {}) },
          provider,
          workspaceDir,
          proxy
        );

        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: result.text }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text' as const, text: result.text }],
        };
      }
    );

  registerImageGenerationTool('openh3_image_generation');

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[ImageGenMCP] Fatal error:', error);
  process.exit(1);
});
