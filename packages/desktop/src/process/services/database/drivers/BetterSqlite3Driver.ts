// src/process/services/database/drivers/BetterSqlite3Driver.ts

import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { getPlatformServices } from '@/common/platform';
import type { ISqliteDriver, IStatement } from './ISqliteDriver';

class BetterSqlite3Statement implements IStatement {
  constructor(private stmt: Database.Statement) {}

  get(...args: unknown[]): unknown {
    return this.stmt.get(...args);
  }

  all(...args: unknown[]): unknown[] {
    return this.stmt.all(...args) as unknown[];
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.stmt.run(...args);
  }
}

export class BetterSqlite3Driver implements ISqliteDriver {
  private db: Database.Database;

  constructor(dbPath: string) {
    const appPath = getPlatformServices().paths.getAppPath();
    // afterPack rebuilds this binary after the ASAR file list has been sealed.
    // Load its physical path directly; bindings cannot discover new ASAR entries.
    const options = appPath?.endsWith('.asar')
      ? {
          nativeBinding: path.join(
            `${appPath}.unpacked`,
            'node_modules',
            'better-sqlite3',
            'build',
            'Release',
            'better_sqlite3.node'
          ),
        }
      : undefined;
    this.db = new BetterSqlite3(dbPath, options);
  }

  prepare(sql: string): IStatement {
    return new BetterSqlite3Statement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(sql: string, options?: { simple?: boolean }): unknown {
    return this.db.pragma(sql, options);
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
