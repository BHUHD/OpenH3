import fs from 'node:fs';
import path from 'node:path';
import type { H3Version } from '@/common/chat/document/h3Job';

export class H3VersionStore {
  private readonly versions = new Map<string, H3Version>();
  constructor(private readonly filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (fs.existsSync(filename)) {
      for (const value of JSON.parse(fs.readFileSync(filename, 'utf8')) as H3Version[]) this.versions.set(value.id, value);
    }
  }
  list(): H3Version[] { return [...this.versions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  create(version: H3Version): H3Version { this.versions.set(version.id, version); this.flush(); return version; }
  select(id: string): H3Version[] {
    if (!this.versions.has(id)) throw new Error('H3_VERSION_NOT_FOUND');
    const selected = [...this.versions.values()].map((value) => ({ ...value, selected: value.id === id }));
    this.versions.clear(); for (const value of selected) this.versions.set(value.id, value); this.flush(); return selected;
  }
  private flush(): void {
    const temp = `${this.filename}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.list(), null, 2), 'utf8');
    fs.renameSync(temp, this.filename);
  }
}
