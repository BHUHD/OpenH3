import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');

describe('Windows fast build scripts', () => {
  it('provides an x64 fast installer build that lowers compression and skips executable editing', () => {
    const script = packageJson.scripts['build-win:x64:fast'];

    expect(script).toBeTypeOf('string');
    expect(script).toContain('ELECTRON_BUILDER_COMPRESSION_LEVEL=1');
    expect(script).toContain('node scripts/build-with-builder.js x64 --win --x64');
    expect(script).toContain('--config.win.signAndEditExecutable=false');
  });

  it('supports a temporary build-time auto-update version override', () => {
    expect(buildScript).toContain("DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV = 'AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION'");
    expect(buildScript).toContain('applyDebugAutoUpdateVersionOverride(packageJsonPath)');
    expect(buildScript).toContain('const originalPackageJsonText = fs.readFileSync(packageJsonPath,');
    expect(buildScript).toContain('packageJson.version = debugAutoUpdateCurrentVersion');
    expect(buildScript).toContain('fs.writeFileSync(packageJsonPath, originalPackageJsonText)');
    expect(buildScript).toMatch(/finally\s*{[\s\S]*restorePackageVersionOverride\(\);[\s\S]*}/);
  });

  it('retries transient Windows tool download failures even when electron-builder removes win-unpacked', () => {
    expect(buildScript).toContain('function isTransientWindowsToolDownloadFailure');
    expect(buildScript).toMatch(
      /fs\.existsSync\(winExePath\)\s*\|\|\s*isTransientWindowsToolDownloadFailure\(firstError\)/
    );
  });
});

const policySource = buildScript.slice(
  buildScript.indexOf('function windowsSigningPolicy('),
  buildScript.indexOf('function resolveElectronBuilderCommand(')
);
const signingPolicy = runInNewContext(policySource + '; windowsSigningPolicy') as (
  args: string,
  env: Record<string, string>
) => { required: boolean; flags: string };
it('fails closed when a signed release has no credentials or attempts to disable signing', () => {
  expect(() => signingPolicy('--win', { AIONUI_REQUIRE_WINDOWS_SIGNING: '1' })).toThrow(/requires/);
  expect(() => signingPolicy('--win --config.win.signAndEditExecutable=false', { CSC_LINK: 'private.pfx' })).toThrow(
    /cannot disable/
  );
});
it('requires signing for supplied credentials and safely validates certificate selection', () => {
  expect(signingPolicy('--win', { WIN_CSC_LINK: 'private.pfx' })).toMatchObject({
    required: true,
    flags: expect.stringContaining('forceCodeSigning=true'),
  });
  expect(() => signingPolicy('--win', { AIONUI_WINDOWS_CERT_SHA1: 'bad;command' })).toThrow(/thumbprint/);
  expect(signingPolicy('--win', {}).required).toBe(false);
});
