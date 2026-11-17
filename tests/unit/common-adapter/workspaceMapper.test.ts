/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  fromBackendDirectoryEntries,
  fromBackendWorkspaceFlatFiles,
  type RawWorkspaceFlatFile,
} from '@/common/adapter/workspaceMapper';

describe('workspaceMapper', () => {
  it('maps directory paths and kinds, including nested entries', () => {
    const [directory] = fromBackendDirectoryEntries([
      {
        name: '原片逐帧图片',
        full_path: 'C:/交付/原片逐帧图片',
        relative_path: '原片逐帧图片',
        is_dir: true,
        is_file: false,
        children: [
          {
            name: 'frame_001.jpg',
            full_path: 'C:/交付/原片逐帧图片/frame_001.jpg',
            relative_path: '原片逐帧图片/frame_001.jpg',
            is_dir: false,
            is_file: true,
          },
        ],
      },
    ]);
    expect(directory.fullPath).toBe('C:/交付/原片逐帧图片');
    expect(directory.isDir).toBe(true);
    expect(directory.children?.[0]).toEqual({
      name: 'frame_001.jpg',
      fullPath: 'C:/交付/原片逐帧图片/frame_001.jpg',
      relativePath: '原片逐帧图片/frame_001.jpg',
      isDir: false,
      isFile: true,
    });
  });
  it('maps workspace flat files from backend snake_case to frontend camelCase', () => {
    const raw: RawWorkspaceFlatFile[] = [
      {
        name: 'main.ts',
        full_path: '/workspace/src/main.ts',
        relative_path: 'src/main.ts',
      },
    ];

    expect(fromBackendWorkspaceFlatFiles(raw)).toEqual([
      {
        name: 'main.ts',
        fullPath: '/workspace/src/main.ts',
        relativePath: 'src/main.ts',
      },
    ]);
  });

  it('does not leak snake_case path fields', () => {
    const [file] = fromBackendWorkspaceFlatFiles([
      {
        name: 'README.md',
        full_path: '/workspace/README.md',
        relative_path: 'README.md',
      },
    ]);

    expect(file).toBeDefined();
    expect((file as Record<string, unknown>).full_path).toBeUndefined();
    expect((file as Record<string, unknown>).relative_path).toBeUndefined();
    expect(file?.fullPath).toBe('/workspace/README.md');
    expect(file?.relativePath).toBe('README.md');
  });
});
