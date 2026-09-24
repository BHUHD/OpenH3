import fs from 'node:fs';
import path from 'node:path';
import { H3_MATLOWAI_COMFY_INT8_5080_PROFILE } from '../packages/desktop/src/process/services/runtime/h3Profiles';
import { matlowaiCompleteOfflineBundle } from '../packages/desktop/src/process/services/runtime/h3OfflineBundle';

const index = process.argv.indexOf('--output');
const output = path.resolve(index >= 0 ? process.argv[index + 1] : '.runtime/h3-offline-plan.json');
const bundle = matlowaiCompleteOfflineBundle();
const plan = { profile: H3_MATLOWAI_COMFY_INT8_5080_PROFILE, bundle, mode: 'dry-run', generatedAt: new Date().toISOString() };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(plan, null, 2), 'utf8');
console.log(JSON.stringify({ output, profileId: bundle.profileId, modelRevision: bundle.modelRevision, files: bundle.files.length, requiredBytes: bundle.files.filter((file) => file.required).reduce((sum, file) => sum + file.sizeBytes, 0), mode: plan.mode }, null, 2));
