import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { openDatabase, database, paths } = vi.hoisted(() => ({
  openDatabase: vi.fn(),
  database: { close: vi.fn() },
  paths: { getAppPath: vi.fn() },
}));

vi.mock('better-sqlite3', () => ({
  default: class {
    constructor(...args: unknown[]) {
      openDatabase(...args);
      return database;
    }
  },
}));

vi.mock('@/common/platform', () => ({ getPlatformServices: () => ({ paths }) }));

import { BetterSqlite3Driver } from '@/process/services/database/drivers/BetterSqlite3Driver';

afterEach(() => vi.clearAllMocks());

describe('SQLite driver in packaged upgrades', () => {
  it('loads the physical native module rebuilt after ASAR creation', () => {
    const appPath = path.join(path.parse(process.cwd()).root, 'OpenH3 升级', 'resources', 'app.asar');
    paths.getAppPath.mockReturnValue(appPath);

    const driver = new BetterSqlite3Driver('aionui.db');

    expect(openDatabase).toHaveBeenCalledWith('aionui.db', {
      nativeBinding: path.join(
        `${appPath}.unpacked`,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node'
      ),
    });
    driver.close();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it.each([process.cwd(), null])('keeps default native module discovery outside ASAR (%s)', (appPath) => {
    paths.getAppPath.mockReturnValue(appPath);

    new BetterSqlite3Driver(':memory:');

    expect(openDatabase.mock.lastCall?.[0]).toBe(':memory:');
    expect(openDatabase.mock.lastCall?.[1]).toBeUndefined();
  });
});
