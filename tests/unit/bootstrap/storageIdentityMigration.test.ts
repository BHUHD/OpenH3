import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ root: '', denyCopy: false }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    copyFileSync: (...args: Parameters<typeof actual.copyFileSync>) => {
      if (context.denyCopy) throw new Error('fixture: legacy file locked');
      return actual.copyFileSync(...args);
    },
  };
});
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: { interceptor: vi.fn() },
  EnvStorage: { interceptor: vi.fn() },
}));
vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({ paths: { getLogsDir: () => path.join(context.root, 'logs') } }),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ application: { systemInfo: { provider: vi.fn() } } }));
vi.mock('@/process/utils/utils', () => ({
  getConfigPath: () => path.join(context.root, 'config'),
  getDataPath: () => path.join(context.root, 'data'),
  getTempPath: () => path.join(context.root, 'temp'),
  getLegacyTempPath: () => path.join(context.root, 'legacy-temp'),
  hasElectronAppPath: () => false,
  ensureDirectory: (dir: string) => fs.mkdirSync(dir, { recursive: true }),
  copyDirectoryRecursively: (from: string, to: string) => fs.promises.cp(from, to, { recursive: true }),
  verifyDirectoryFiles: () => Promise.resolve(true),
}));
vi.mock('@/process/services/database/runLegacyDatabaseMigrations', () => ({
  runLegacyDatabaseMigrations: () => Promise.resolve({ skipped: true, handoffRepair: { repairedColumns: [] } }),
}));

function seed(relative: string, data: unknown): string {
  const file = path.join(context.root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
  fs.writeFileSync(file, encoded);
  return encoded;
}

beforeEach(() => {
  vi.resetModules();
  context.root = fs.mkdtempSync(path.join(os.tmpdir(), 'openh3-storage-upgrade-'));
  context.denyCopy = false;
});
afterEach(() => fs.rmSync(context.root, { recursive: true, force: true }));

describe('OpenH3 profile upgrade', () => {
  it('reads a legacy custom cache directory, copies exact bytes, and retains the originals', async () => {
    const cacheDir = path.join(context.root, 'custom-cache');
    seed('config/.aionui-env', { 'aionui.dir': { cacheDir, workDir: 'D:/existing-work' } });
    const original = seed('custom-cache/aionui-config.txt', {
      language: 'zh-CN',
      'migration.providersMigrated_v1': true,
    });
    const store = await import('@/process/utils/initStorage');
    await store.default();
    expect(store.getSystemDir().cacheDir).toBe(cacheDir);
    expect(await store.ProcessConfig.get('language')).toBe('zh-CN');
    expect(await store.ProcessConfig.get('migration.providersMigrated_v1')).toBe(true);
    expect(fs.readFileSync(path.join(cacheDir, 'openh3-config.txt'), 'utf8')).toBe(original);
    expect(fs.readFileSync(path.join(cacheDir, 'aionui-config.txt'), 'utf8')).toBe(original);
  });

  it('resolves paths after the old temp profile has been copied at startup', async () => {
    const cacheDir = path.join(context.root, 'config');
    seed('legacy-temp/.aionui-env', { 'aionui.dir': { cacheDir, workDir: 'D:/old-projects' } });
    seed('legacy-temp/aionui-config.txt', { language: 'zh-TW' });
    const store = await import('@/process/utils/initStorage');
    await store.default();
    expect(store.getSystemDir().workDir).toBe('D:/old-projects');
    expect(await store.ProcessConfig.get('language')).toBe('zh-TW');
    expect(fs.existsSync(path.join(cacheDir, 'openh3-config.txt'))).toBe(true);
  });

  it('prefers canonical configuration when both versions exist and is repeatable', async () => {
    seed('config/aionui-config.txt', { language: 'old' });
    const canonical = seed('config/openh3-config.txt', { language: 'zh-CN' });
    for (let attempt = 0; attempt < 2; attempt++) {
      vi.resetModules();
      const store = await import('@/process/utils/initStorage');
      await store.default();
      expect(await store.ProcessConfig.get('language')).toBe('zh-CN');
      expect(fs.readFileSync(path.join(context.root, 'config/openh3-config.txt'), 'utf8')).toBe(canonical);
    }
  });

  it('falls back to legacy storage when copying is unavailable', async () => {
    seed('config/aionui-config.txt', { language: 'zh-CN' });
    context.denyCopy = true;
    const store = await import('@/process/utils/initStorage');
    await store.default();
    expect(await store.ProcessConfig.get('language')).toBe('zh-CN');
    expect(fs.existsSync(path.join(context.root, 'config/openh3-config.txt'))).toBe(false);
  });

  it('reads old messages even when a canonical history directory already exists', async () => {
    const messages = [{ id: 'message-1', type: 'text', content: '旧会话' }];
    const original = seed('config/aionui-chat-history/conversation-1.txt', messages);
    seed('config/openh3-chat-history/conversation-2.txt', []);
    seed('config/aionui-chat.txt', { 'conversation-1': { id: 'conversation-1', name: '旧会话' } });
    const store = await import('@/process/utils/initStorage');
    await store.default();
    expect(await store.ProcessChatMessage.get('conversation-1')).toEqual(messages);
    expect((await store.ProcessChat.get('conversation-1')).name).toBe('旧会话');
    expect(fs.readFileSync(path.join(context.root, 'config/openh3-chat-history/conversation-1.txt'), 'utf8')).toBe(
      original
    );
    expect(fs.readFileSync(path.join(context.root, 'config/aionui-chat-history/conversation-1.txt'), 'utf8')).toBe(
      original
    );
  });
});
