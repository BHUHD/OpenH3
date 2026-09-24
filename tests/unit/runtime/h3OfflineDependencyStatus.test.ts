import { describe, expect, it } from 'vitest';
import { isMatlowaiBundleComplete, MATLOWAI_OFFLINE_DEPENDENCY_STATUS, MATLOWAI_WORKFLOW_COMPATIBILITY } from '@/process/services/runtime/h3OfflineBundle';
describe('MATLOWAI offline dependency status', () => {
  it('reports the offline bundle complete once runtime archives are pinned', () => {
    expect(MATLOWAI_OFFLINE_DEPENDENCY_STATUS.every((item) => item.status === 'locked')).toBe(true);
    expect(MATLOWAI_OFFLINE_DEPENDENCY_STATUS.find((item) => item.id === 'fused-diffusion-model')?.status).toBe('locked');
    expect(isMatlowaiBundleComplete()).toBe(true);
    expect(MATLOWAI_WORKFLOW_COMPATIBILITY.status).toBe('resolved-source-found');
  });
});
