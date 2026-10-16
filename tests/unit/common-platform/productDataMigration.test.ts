import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDevAppName } from '@/common/platform';
import { migrateLegacyUserDataDirectory } from '@/process/utils/legacyProductMigration';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenH3 product data migration', () => {
  it('does not merge a legacy profile into an existing OpenH3 profile', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openh3-profile-migration-'));
    temporaryDirectories.push(root);
    const oldProfile = path.join(root, 'AionUi');
    const newProfile = path.join(root, 'OpenH3');
    fs.mkdirSync(path.join(oldProfile, 'nested'), { recursive: true });
    fs.mkdirSync(newProfile, { recursive: true });
    fs.writeFileSync(path.join(oldProfile, 'settings.json'), 'old');
    fs.writeFileSync(path.join(oldProfile, 'nested', 'db.sqlite'), 'database');
    fs.writeFileSync(path.join(newProfile, 'settings.json'), 'new');

    const migrated = migrateLegacyUserDataDirectory(oldProfile, newProfile, fs);

    expect(migrated).toBe(false);
    expect(fs.readFileSync(path.join(newProfile, 'settings.json'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(newProfile, 'nested', 'db.sqlite'))).toBe(false);
    expect(fs.existsSync(path.join(oldProfile, 'settings.json'))).toBe(true);
  });

  it('renames the complete legacy profile when no destination exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openh3-profile-rename-'));
    temporaryDirectories.push(root);
    const oldProfile = path.join(root, 'AionUi');
    const newProfile = path.join(root, 'OpenH3');
    fs.mkdirSync(oldProfile);
    fs.writeFileSync(path.join(oldProfile, 'settings.json'), 'user data');

    expect(migrateLegacyUserDataDirectory(oldProfile, newProfile, fs)).toBe(true);
    expect(fs.existsSync(oldProfile)).toBe(false);
    expect(fs.readFileSync(path.join(newProfile, 'settings.json'), 'utf8')).toBe('user data');
  });

  it('uses OpenH3 for development app names while keeping multi-instance isolation', () => {
    const previous = process.env.AIONUI_MULTI_INSTANCE;
    process.env.AIONUI_MULTI_INSTANCE = '1';
    expect(getDevAppName()).toBe('OpenH3-Dev-2');
    if (previous === undefined) delete process.env.AIONUI_MULTI_INSTANCE;
    else process.env.AIONUI_MULTI_INSTANCE = previous;
  });
});
