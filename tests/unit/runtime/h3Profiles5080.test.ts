import { describe, expect, it } from 'vitest';
import { H3_FASTH3_5080_EXPERIMENTAL_PROFILE, buildH3InstallPlan } from '@/process/services/runtime/h3Profiles';
describe('RTX 5080 experimental profile', () => {
  it('blocks native Windows', () => expect(buildH3InstallPlan(H3_FASTH3_5080_EXPERIMENTAL_PROFILE, 250_000_000_000, 'win32').reasons).toContain('OS_NOT_SUPPORTED'));
  it('allows WSL2 dry-run', () => expect(buildH3InstallPlan(H3_FASTH3_5080_EXPERIMENTAL_PROFILE, 250_000_000_000, 'wsl2')).toMatchObject({ installAllowed: true, dryRun: true }));
});
