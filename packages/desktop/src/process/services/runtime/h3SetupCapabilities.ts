import workflows from './h3EmbeddedWorkflows.json';
import { MATLOWAI_MODEL_ASSETS } from './h3OfflineBundle';
export function inspectSetupCapabilities(registry: Record<string, unknown>) {
  const modes = Object.entries(workflows).map(([filename, base64]) => {
    const graph = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, { class_type: string }>;
    const missingNodes = [...new Set(Object.values(graph).map(node => node.class_type))].filter(name => !Object.hasOwn(registry, name));
    return { mode: filename.includes('05_') ? 'ref2va' : filename.includes('04_') ? 'fl2v' : 't2v', missingNodes, nodesAvailable: missingNodes.length === 0 };
  });
  const missingModels = MATLOWAI_MODEL_ASSETS.map(asset => {
    const loader = asset.relativePath.includes('diffusion_models/') ? 'UNETLoader' : asset.relativePath.includes('text_encoders/') ? 'CLIPLoader' : 'VAELoader';
    const field = loader === 'UNETLoader' ? 'unet_name' : loader === 'CLIPLoader' ? 'clip_name' : 'vae_name';
    const metadata = registry[loader] as { input?: { required?: Record<string, unknown[]> } } | undefined;
    const definition = metadata?.input?.required?.[field];
    const choices = Array.isArray(definition?.[0]) ? definition[0] : (definition?.[1] as { options?: unknown[] } | undefined)?.options;
    const filename = asset.relativePath.split('/').at(-1)!;
    return Array.isArray(choices) && choices.includes(filename) ? undefined : filename;
  }).filter((name): name is string => Boolean(name));
  return { modes, nodesAvailable: modes.every(mode => mode.nodesAvailable), missingModels, modelsAvailable: missingModels.length === 0, generationVerified: false as const };
}
