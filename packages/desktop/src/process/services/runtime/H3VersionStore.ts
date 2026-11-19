import fs from 'node:fs';
import path from 'node:path';
import type { H3Job, H3Version } from '@/common/chat/document/h3Job';

export class H3VersionStore {
  private readonly versions = new Map<string, H3Version>();
  constructor(private readonly filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    if (fs.existsSync(filename)) {
      for (const value of JSON.parse(fs.readFileSync(filename, 'utf8')) as H3Version[]) {
        this.versions.set(value.id, {
          ...value,
          // Older stores only had `selected`; treat their selected row as an
          // accepted root and every other row as a reviewable candidate.
          review: value.review ?? (value.selected ? 'accepted' : 'candidate'),
        });
      }
    }
  }
  list(): H3Version[] {
    return [...this.versions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private selectedVersion(): H3Version | undefined {
    return [...this.versions.values()].find((version) => version.selected);
  }

  submissionContext(sourceVersionId?: string): Pick<H3Job, 'parentVersionId' | 'autoSelectAtRevision'> {
    const current = this.selectedVersion();
    const selectedId = current?.id ?? null;
    const parentVersionId = sourceVersionId ?? selectedId;
    return {
      parentVersionId,
      ...(parentVersionId === selectedId ? { autoSelectAtRevision: current?.selectionRevision ?? null } : {}),
    };
  }

  /** Reviewable output survives a changed selection or a missing pre-upgrade submission snapshot. */
  publishCompletedJob(job: H3Job): void {
    const artifactPath = job.artifacts[0]?.resourcePath;
    if (job.status !== 'succeeded' || !artifactPath) return;
    if ([...this.versions.values()].some((version) => version.jobId === job.id)) return;

    const current = this.selectedVersion();
    const version: H3Version = {
      id: crypto.randomUUID(),
      parentId: job.parentVersionId ?? null,
      label: `H3 ${this.versions.size + 1}`,
      jobId: job.id,
      createdAt: new Date().toISOString(),
      selected: false,
      review: 'candidate',
      artifactPath,
    };
    this.versions.set(version.id, version);
    if (
      job.parentVersionId === (current?.id ?? null) &&
      job.autoSelectAtRevision === (current?.selectionRevision ?? null)
    )
      this.setSelection(version, current);
    this.flush();
  }

  create(version: H3Version): H3Version {
    this.versions.set(version.id, {
      ...version,
      review: version.review ?? (version.selected ? 'accepted' : 'candidate'),
    });
    this.flush();
    return this.versions.get(version.id)!;
  }

  /** Return the requested candidates in stable creation order for comparison. */
  compare(ids: string[]): H3Version[] {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 4) throw new Error('H3_VERSION_COMPARE_INVALID');
    const selected = unique.map((id) => {
      const version = this.versions.get(id);
      if (!version) throw new Error('H3_VERSION_NOT_FOUND');
      if (version.review === 'rejected') throw new Error('H3_VERSION_REJECTED');
      return version;
    });
    return selected.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Accept a candidate only if the caller still observes the same source version. */
  accept(id: string, expectedSelectedId?: string | null): H3Version[] {
    const target = this.versions.get(id);
    if (!target) throw new Error('H3_VERSION_NOT_FOUND');
    if (target.review === 'rejected') throw new Error('H3_VERSION_REJECTED');
    const current = this.selectedVersion();
    if (expectedSelectedId !== undefined && expectedSelectedId !== (current?.id ?? null))
      throw new Error('H3_VERSION_CONFLICT');
    if (current?.id === target.id) return this.list();
    this.setSelection(target, current);
    this.flush();
    return this.list();
  }

  private setSelection(target: H3Version, current?: H3Version): void {
    if (current) this.versions.set(current.id, { ...current, selected: false, review: 'candidate' });
    this.versions.set(target.id, {
      ...target,
      selected: true,
      review: 'accepted',
      previousSelectedId: current?.id,
      selectionRevision: crypto.randomUUID(),
    });
  }

  /** Backward-compatible name used by the original UI/API. */
  select(id: string, expectedSelectedId?: string | null): H3Version[] {
    return this.accept(id, expectedSelectedId);
  }

  reject(id: string): H3Version[] {
    const target = this.versions.get(id);
    if (!target) throw new Error('H3_VERSION_NOT_FOUND');
    if (target.selected) throw new Error('H3_VERSION_SELECTED_CANNOT_REJECT');
    this.versions.set(id, { ...target, review: 'rejected', previousSelectedId: undefined });
    this.flush();
    return this.list();
  }

  /** Undo a rejection, or undo the most recent accepted candidate when no id is given. */
  undo(id?: string): H3Version[] {
    if (id) {
      const target = this.versions.get(id);
      if (!target) throw new Error('H3_VERSION_NOT_FOUND');
      if (target.review !== 'rejected') throw new Error('H3_VERSION_NOT_REJECTED');
      this.versions.set(id, { ...target, review: 'candidate' });
      this.flush();
      return this.list();
    }
    const current = [...this.versions.values()].find((value) => value.selected && value.previousSelectedId);
    if (!current?.previousSelectedId) throw new Error('H3_VERSION_NOTHING_TO_UNDO');
    const previous = this.versions.get(current.previousSelectedId);
    if (!previous) throw new Error('H3_VERSION_CONFLICT');
    this.versions.set(current.id, {
      ...current,
      selected: false,
      review: 'candidate',
      previousSelectedId: undefined,
    });
    this.versions.set(previous.id, {
      ...previous,
      selected: true,
      review: 'accepted',
      selectionRevision: crypto.randomUUID(),
    });
    this.flush();
    return this.list();
  }
  private flush(): void {
    const temp = `${this.filename}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.list(), null, 2), 'utf8');
    fs.renameSync(temp, this.filename);
  }
}
