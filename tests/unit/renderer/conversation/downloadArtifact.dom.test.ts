/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadArtifact,
  fileNameFromPath,
} from '@/renderer/pages/conversation/runtime/GenerationCard/downloadArtifact';

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const create = vi.fn(() => 'blob:artifact');
const revoke = vi.fn();
const clicked: HTMLAnchorElement[] = [];

const stubFetch = (response: Partial<Response>): void => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
};

beforeEach(() => {
  clicked.length = 0;
  create.mockClear();
  revoke.mockClear();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fileNameFromPath', () => {
  it('returns the last segment of Windows and POSIX paths', () => {
    expect(fileNameFromPath(String.raw`D:\out\final image.png`)).toBe('final image.png');
    expect(fileNameFromPath('D:/out/clip.mp4')).toBe('clip.mp4');
    expect(fileNameFromPath('/tmp/out/photo.jpg')).toBe('photo.jpg');
  });

  it('returns the input when it has no separator', () => {
    expect(fileNameFromPath('result.mp4')).toBe('result.mp4');
  });
});

describe('downloadArtifact', () => {
  it('saves the fetched bytes under the given file name and cleans up', async () => {
    stubFetch({ ok: true, status: 200, blob: async () => new Blob(['abc'], { type: 'image/png' }) });
    await downloadArtifact('http://127.0.0.1:33002/a', 'a.png');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:33002/a');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('a.png');
    expect(clicked[0].href).toBe('blob:artifact');
    expect(revoke).toHaveBeenCalledWith('blob:artifact');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('rejects a failed response without saving anything', async () => {
    stubFetch({ ok: false, status: 404 });
    await expect(downloadArtifact('http://127.0.0.1:33002/a', 'a.png')).rejects.toThrow('404');
    expect(clicked).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an empty artifact without saving anything', async () => {
    stubFetch({ ok: true, status: 200, blob: async () => new Blob([]) });
    await expect(downloadArtifact('http://127.0.0.1:33002/a', 'a.png')).rejects.toThrow('empty');
    expect(clicked).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });
});
