import { z } from 'zod';

const pinnedVersion = z
  .string()
  .min(1)
  .refine((value) => !/^(latest|main|master|HEAD|stable|nightly)$/i.test(value), 'A fixed revision is required');
const absolutePath = z
  .string()
  .min(1)
  .refine((value) => /^(?:[a-z]:[\\/]|\/)/i.test(value), 'An absolute path is required');
const localUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  }, 'A local ComfyUI endpoint is required');
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
export const comfyFamilySchema = z.enum(['h3', 'qwen-edit', 'z-image']);
export type ComfyFamily = z.infer<typeof comfyFamilySchema>;
export type ComfyIntent = 'generate' | 'install' | 'repair' | 'install-other';
export const comfyGenerationInputSchema = z.object({
  prompt: z.string().min(1),
  imagePaths: z.array(absolutePath).max(9).optional(),
  negativePrompt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  seed: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().positive().max(120).optional(),
  batchSize: z.number().int().positive().max(16).optional(),
  offload: z.boolean().optional(),
});
export type ComfyGenerationInput = z.infer<typeof comfyGenerationInputSchema>;
export const comfyProfileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][\w.-]{0,99}$/),
  family: comfyFamilySchema,
  name: z.string().min(1),
  kind: z.enum(['image', 'video']),
  version: pinnedVersion,
  quantization: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  state: z.enum(['downloaded', 'loadable', 'verified', 'invalid']),
  environment: z.object({
    root: absolutePath,
    python: absolutePath,
    baseUrl: localUrl,
    launchArgs: z.array(z.string()).optional(),
  }),
  components: z
    .array(
      z.object({
        role: z.string().min(1),
        name: z.string().min(1),
        path: absolutePath,
        version: pinnedVersion,
        precision: z.string().min(1),
        url: z.string().url().optional(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
        sizeBytes: z.number().int().positive().optional(),
      })
    )
    .min(1),
  nodes: z.array(z.object({ id: z.string().min(1), version: pinnedVersion })).min(1),
  workflowPath: absolutePath,
  workflowSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  bindings: z.record(z.string(), z.array(z.object({ nodeId: z.string().min(1), input: z.string().min(1) })).min(1)),
  defaults: z.record(z.string(), scalar),
  memoryPolicy: z
    .object({
      minWidth: z.number().int().positive().optional(),
      minHeight: z.number().int().positive().optional(),
      dimensionStep: z.number().int().positive().optional(),
      minBatchSize: z.number().int().positive().optional(),
      allowOffload: z.boolean().optional(),
      evidence: z.string().min(1),
    })
    .optional(),
  validation: z
    .object({
      fingerprint: z.string(),
      checkedAt: z.string(),
      promptId: z.string().optional(),
      artifacts: z.array(z.string()).optional(),
      error: z.string().optional(),
      runtime: z
        .object({
          python: z.string(),
          packages: z.record(z.string(), z.string()),
          comfyRevision: z.string().optional(),
          nodeRevisions: z.record(z.string(), z.string()),
          hardware: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type ComfyProfile = z.infer<typeof comfyProfileSchema>;
const graph = z
  .record(z.string(), z.object({ class_type: z.string().min(1), inputs: z.record(z.string(), z.unknown()) }))
  .refine((value) => Object.keys(value).length > 0);
export const comfyInstallPlanSchema = comfyProfileSchema.omit({ state: true, validation: true }).extend({
  targetRoot: absolutePath,
  downloadBytes: z.number().int().nonnegative(),
  requiredBytes: z.number().int().nonnegative(),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  workflow: graph,
  commands: z
    .array(
      z.object({
        executable: z.string().min(1),
        args: z.array(z.string()),
        cwd: absolutePath,
        label: z.string().min(1),
        revision: pinnedVersion,
        stage: z.enum(['prepare', 'finish']).default('prepare'),
      })
    )
    .max(50),
  smokeInput: comfyGenerationInputSchema,
  repair: z.boolean().default(false),
});
export type ComfyInstallPlan = z.infer<typeof comfyInstallPlanSchema>;
export type ComfyOperation = {
  id: string;
  requestId: string;
  conversationId: string;
  state: 'awaiting-consent' | 'authorized' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
  plan: ComfyInstallPlan;
  progress?: string;
  error?: string;
  profileId?: string;
  updatedAt: string;
  snapshotDirectory?: string;
  diagnosticLogPath?: string;
  diagnosis?: ComfyDiagnosis;
};
export type ComfyDiagnosis = { category: string; nodeId?: string; retryable: boolean; action: string };
export type ComfyGenerationJob = {
  id: string;
  profileId: string;
  kind: 'image' | 'video';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  promptId?: string;
  artifacts: Array<{ path: string; mimeType: string }>;
  error?: string;
  diagnosis?: ComfyDiagnosis;
  diagnosticLogPath?: string;
  submissionUncertain?: boolean;
  createdAt: string;
  updatedAt: string;
  adjustments?: Array<{ reason: string; input: ComfyGenerationInput }>;
};
