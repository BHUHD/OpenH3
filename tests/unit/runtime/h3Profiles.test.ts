import { describe, expect, it } from 'vitest';
import { H3_FASTH3_VSA_PROFILE, buildH3InstallPlan } from '@/process/services/runtime/h3Profiles';

describe('H3 profiles', () => {
  it('creates a dry-run plan only when OS and disk budget fit', () => {
    expect(buildH3InstallPlan(H3_FASTH3_VSA_PROFILE, 200_000_000_000, 'wsl2')).toMatchObject({ installAllowed: true, dryRun: true });
    expect(buildH3InstallPlan(H3_FASTH3_VSA_PROFILE, 200_000_000_000, 'win32').reasons).toContain('OS_NOT_SUPPORTED');
  });
  it('requires the documented license consent flag', () => {
    expect(H3_FASTH3_VSA_PROFILE.requiresLicenseConsent).toBe(true);
  });
});
