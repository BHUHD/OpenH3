import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { comfyInstallPlanSchema } from '@/common/chat/document/creation/comfy';
import { validateComfyWorkflow, type ComfyRegistry } from '@/process/services/runtime/h3WorkflowPreflight';

type WorkflowBundle = {
  status: string;
  verifiedOnThisMachine: boolean;
  workflows: Array<{
    id: string;
    candidateId: string;
    family: string;
    status: string;
    verifiedOnThisMachine: boolean;
    capabilities: string[];
    requiredNodes: Array<{ id: string; version: string }>;
    requiredClassTypes: string[];
    components: Array<{ role: string; name: string; directory: string; revision: string; sha256: string }>;
    graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    graphSha256: string;
    bindings: Record<string, Array<{ nodeId: string; input: string }>>;
    defaults: Record<string, string | number | boolean>;
    smokeInput: Record<string, string | number | boolean>;
    smokeRequirements: string[];
    conversion: {
      converter: { revision: string; sha256: string };
      originalTemplate: { revision: string; sha256: string };
      convertedApi: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
      convertedApiSha256: string;
      schemaSha256: string;
      sourceDerivedObjectInfo: ComfyRegistry;
      classEvidence: Record<string, { sourcePath: string; sha256: string; inputOrder: Record<string, string[]> }>;
      schemaSources: Array<{ path: string; sha256: string; revision: string; url: string }>;
      structuralValidation: string;
    };
  }>;
};

type CandidateCatalog = {
  sources: { comfyCore: { revision: string }; workflowTemplates: { revision: string }; comfyCli: { revision: string } };
  candidates: Array<{
    id: string;
    family: string;
    status: string;
    verifiedOnThisMachine: boolean;
    apiBaselineId?: string;
    workflow?: { revision: string; sha256: string };
    components: Array<{
      role: string;
      name?: string;
      directory: string;
      revision: string;
      precision: string;
      sha256: string;
      url: string;
      sizeBytes: number;
    }>;
  }>;
};

const bundlePath = path.resolve('resources/skills/comfyui-local/references/workflows.json');
const candidatePath = path.resolve('resources/skills/comfyui-local/references/candidates.json');
const stableHash = (value: unknown) =>
  crypto
    .createHash('sha256')
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest('hex');

describe('packaged ComfyUI API baselines', () => {
  it('contains source-derived, discovery-only graphs with complete schema evidence', async () => {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8')) as WorkflowBundle;
    const catalog = JSON.parse(await fs.readFile(candidatePath, 'utf8')) as CandidateCatalog;
    expect(bundle.status).toBe('discovery-only');
    expect(bundle.verifiedOnThisMachine).toBe(false);
    expect(bundle.workflows.map((workflow) => workflow.family)).toEqual(
      expect.arrayContaining(['z-image', 'qwen-edit'])
    );

    for (const workflow of bundle.workflows) {
      expect(workflow.status).toBe('discovery-only');
      expect(workflow.verifiedOnThisMachine).toBe(false);
      expect(stableHash(workflow.graph)).toBe(workflow.graphSha256);
      expect(stableHash(workflow.conversion.convertedApi)).toBe(workflow.conversion.convertedApiSha256);
      expect(stableHash(workflow.conversion.sourceDerivedObjectInfo)).toBe(workflow.conversion.schemaSha256);

      const classes = [...new Set(Object.values(workflow.graph).map((node) => node.class_type))].toSorted();
      expect(classes).toEqual([...workflow.requiredClassTypes].toSorted());
      expect(Object.keys(workflow.conversion.sourceDerivedObjectInfo).toSorted()).toEqual(
        [
          ...new Set([...classes, ...Object.values(workflow.conversion.convertedApi).map((node) => node.class_type)]),
        ].toSorted()
      );
      for (const classType of Object.keys(workflow.conversion.sourceDerivedObjectInfo)) {
        const evidence = workflow.conversion.classEvidence[classType];
        expect(evidence).toBeDefined();
        expect(evidence.sourcePath).toMatch(/^(?:nodes\.py|comfy(?:_extras|\/))/);
        expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(workflow.conversion.schemaSources).toContainEqual(
          expect.objectContaining({ path: evidence.sourcePath, sha256: evidence.sha256 })
        );
        const schema = workflow.conversion.sourceDerivedObjectInfo[classType];
        for (const section of ['required', 'optional'] as const) {
          expect(Object.keys(schema.input?.[section] ?? {})).toEqual(evidence.inputOrder[section] ?? []);
        }
      }
      for (const source of workflow.conversion.schemaSources) {
        expect(source.revision).toBe(catalog.sources.comfyCore.revision);
        expect(source.url).toContain(`/${source.revision}/${source.path}`);
      }
      expect(workflow.requiredNodes).toContainEqual({
        id: 'comfyui-core',
        version: catalog.sources.comfyCore.revision,
      });
      expect(workflow.conversion.converter.revision).toBe(catalog.sources.comfyCli.revision);
      expect(workflow.conversion.converter.sha256).toMatch(/^[a-f0-9]{64}$/);

      for (const [name, bindingList] of Object.entries(workflow.bindings)) {
        expect(bindingList.length).toBeGreaterThan(0);
        for (const binding of bindingList) {
          const node = workflow.graph[binding.nodeId];
          expect(node).toBeDefined();
          expect(node.inputs).toHaveProperty(binding.input);
          if (Object.hasOwn(workflow.defaults, name)) {
            const value = workflow.defaults[name];
            expect(value).toEqual(node.inputs[binding.input]);
          }
        }
      }

      const loaderValues = Object.values(workflow.graph).flatMap((node) =>
        Object.entries(node.inputs)
          .filter(([key]) => ['unet_name', 'clip_name', 'vae_name', 'lora_name'].includes(key))
          .map(([, value]) => value)
      );
      const componentNames = workflow.components.map((component) => component.name);
      expect([...loaderValues].toSorted()).toEqual([...componentNames].toSorted());
      validateComfyWorkflow(workflow.graph, workflow.conversion.sourceDerivedObjectInfo);
      validateComfyWorkflow(workflow.conversion.convertedApi, workflow.conversion.sourceDerivedObjectInfo);
      for (const node of Object.values(workflow.graph)) {
        const schema = workflow.conversion.sourceDerivedObjectInfo[node.class_type];
        for (const input of Object.keys(node.inputs)) {
          expect({ ...schema.input?.required, ...schema.input?.optional }).toHaveProperty(input);
        }
      }

      const candidate = catalog.candidates.find((item) => item.id === workflow.candidateId);
      expect(candidate).toBeDefined();
      expect(candidate?.apiBaselineId).toBe(workflow.id);
      expect(candidate?.status).toBe('discovery-only');
      expect(candidate?.verifiedOnThisMachine).toBe(false);
      expect(workflow.conversion.originalTemplate.revision).toBe(catalog.sources.workflowTemplates.revision);
      expect(workflow.conversion.originalTemplate).toMatchObject(candidate!.workflow!);
      for (const component of workflow.components) {
        expect(candidate!.components).toContainEqual(expect.objectContaining(component));
      }
    }
  });

  it('keeps family-specific semantics explicit for the shipped baselines', async () => {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8')) as WorkflowBundle;
    const zImage = bundle.workflows.find((workflow) => workflow.family === 'z-image');
    const qwen = bundle.workflows.find((workflow) => workflow.family === 'qwen-edit');
    expect(zImage?.bindings.prompt).toContainEqual({ nodeId: '57:27', input: 'text' });
    expect(zImage?.bindings.width).toContainEqual({ nodeId: '57:13', input: 'width' });
    expect(zImage?.graph['57:3'].inputs).toMatchObject({
      steps: 8,
      cfg: 1,
      sampler_name: 'res_multistep',
      scheduler: 'simple',
    });
    expect(qwen?.bindings.image).toContainEqual({ nodeId: '41', input: 'image' });
    expect(qwen?.graph['41'].inputs.image).toBe('source.png');
    expect(qwen?.graph['170:169'].inputs).toMatchObject({
      steps: 4,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
    });
    expect(qwen?.graph['170:169'].inputs).not.toHaveProperty('width');
    expect(qwen?.graph['170:169'].inputs).not.toHaveProperty('offload');
    expect(qwen?.bindings).not.toHaveProperty('width');
    expect(qwen?.bindings).not.toHaveProperty('height');
    expect(qwen?.bindings).not.toHaveProperty('batchSize');
    expect(qwen?.bindings).not.toHaveProperty('offload');
    expect(qwen?.capabilities).toEqual(['image-edit']);
    expect(qwen?.bindings.image).toHaveLength(1);
    expect(qwen?.smokeRequirements.length).toBeGreaterThan(0);
    expect(qwen?.smokeInput).not.toHaveProperty('imagePaths');

    const original = structuredClone(qwen!.conversion.convertedApi);
    expect(original['170:168'].inputs.value).toBe(false);
    original['170:168'].inputs.value = true;
    const resolveConstant = (value: unknown): unknown => {
      if (!Array.isArray(value)) return value;
      const source = original[value[0] as string];
      if (source.class_type === 'ComfySwitchNode') {
        return resolveConstant(resolveConstant(source.inputs.switch) ? source.inputs.on_true : source.inputs.on_false);
      }
      if (source.class_type.startsWith('Primitive')) return source.inputs.value;
      return value;
    };
    for (const input of ['model', 'steps', 'cfg']) {
      expect(qwen!.graph['170:169'].inputs[input]).toEqual(resolveConstant(original['170:169'].inputs[input]));
    }
    expect(qwen?.graph).not.toHaveProperty('83');
    for (const id of ['170:149', '170:151']) {
      expect(qwen?.graph[id].inputs.image1).toEqual(['170:160', 0]);
      expect(qwen?.graph[id].inputs).not.toHaveProperty('image2');
      expect(qwen?.graph[id].inputs).not.toHaveProperty('image3');
    }
  });

  it('connects every node and component to the output and supports the semantic smoke inputs', async () => {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8')) as WorkflowBundle;
    for (const workflow of bundle.workflows) {
      const visited = new Set<string>();
      const visit = (nodeId: string): void => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        for (const value of Object.values(workflow.graph[nodeId].inputs)) {
          if (Array.isArray(value)) visit(value[0] as string);
        }
      };
      expect(workflow.graph['9'].class_type).toBe('SaveImage');
      visit('9');
      expect([...visited].toSorted()).toEqual(Object.keys(workflow.graph).toSorted());
      const applied = structuredClone(workflow.graph);
      for (const [key, value] of Object.entries({ ...workflow.defaults, ...workflow.smokeInput })) {
        expect(workflow.bindings[key]?.length).toBeGreaterThan(0);
        for (const binding of workflow.bindings[key]) applied[binding.nodeId].inputs[binding.input] = value;
      }
      validateComfyWorkflow(applied, workflow.conversion.sourceDerivedObjectInfo);
    }
  });

  it('can prepare a complete install snapshot without a running ComfyUI schema server', async () => {
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8')) as WorkflowBundle;
    const catalog = JSON.parse(await fs.readFile(candidatePath, 'utf8')) as CandidateCatalog;
    for (const workflow of bundle.workflows) {
      const candidate = catalog.candidates.find((item) => item.id === workflow.candidateId)!;
      const root = path.resolve('candidate-example', workflow.family, 'ComfyUI');
      const downloadBytes = candidate.components.reduce((total, component) => total + component.sizeBytes, 0);
      const result = comfyInstallPlanSchema.safeParse({
        id: workflow.id,
        name: workflow.id,
        family: workflow.family,
        kind: 'image',
        version: workflow.conversion.originalTemplate.revision,
        quantization: candidate.components.find((component) => component.role === 'diffusion')!.precision,
        capabilities: workflow.capabilities,
        environment: {
          root,
          python: path.join(root, '.venv', 'Scripts', 'python.exe'),
          baseUrl: 'http://127.0.0.1:8188',
        },
        targetRoot: path.dirname(root),
        components: candidate.components.map((component) => ({
          role: component.role,
          name: component.name,
          precision: component.precision,
          url: component.url,
          sha256: component.sha256,
          sizeBytes: component.sizeBytes,
          path: path.join(root, 'models', component.directory, component.name!),
          version: component.revision,
        })),
        nodes: workflow.requiredNodes,
        workflow: workflow.graph,
        workflowPath: path.join(root, 'workflows', `${workflow.id}.json`),
        workflowSha256: workflow.graphSha256,
        bindings: workflow.bindings,
        defaults: workflow.defaults,
        downloadBytes,
        requiredBytes: downloadBytes + 10_000_000_000,
        reason: 'Structural example only; runtime commands and hardware evidence must be supplied for a real request.',
        evidence: ['Pinned template and schema-derived API graph; live verification pending.'],
        commands: [],
        smokeInput: {
          ...workflow.smokeInput,
          ...(workflow.family === 'qwen-edit'
            ? { imagePaths: [path.join(path.dirname(root), 'user-source.png')] }
            : {}),
        },
      });
      expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
    }
  });
});
