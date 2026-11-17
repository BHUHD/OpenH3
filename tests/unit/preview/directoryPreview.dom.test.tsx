import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DirectoryPreview from '@/renderer/pages/conversation/Preview/components/documents/DirectoryPreview';
const h = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { fs: { getFilesByDir: { invoke: h.list } } } }));
vi.mock('@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview', () => ({
  useLocalFilePreview: () => h.open,
}));
vi.mock('@/renderer/components/files/FileActions', () => ({
  FileActions: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe('directory preview', () => {
  it.each([
    { root: 'C:/', child: 'C:/frames', nested: 'C:/frames/sub' },
    { root: 'D:\\', child: 'D:\\frames', nested: 'D:\\frames\\sub' },
    { root: '/', child: '/frames', nested: '/frames/sub' },
  ])('returns to the exact root $root without navigating above it', async ({ root, child, nested }) => {
    h.list.mockReset().mockImplementation(async ({ dir }: { dir: string }) => {
      if (dir === root) return [{ name: 'frames', fullPath: child, isDir: true }];
      if (dir === child) return [{ name: 'sub', fullPath: nested, isDir: true }];
      return [];
    });
    render(<DirectoryPreview path={root} />);
    expect(screen.getByRole('button', { name: 'preview.directory.up' })).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: 'frames' }));
    fireEvent.click(await screen.findByRole('button', { name: 'sub' }));
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ dir: nested, root }));

    fireEvent.click(screen.getByRole('button', { name: 'preview.directory.up' }));
    await screen.findByRole('button', { name: 'sub' });
    expect(h.list).toHaveBeenLastCalledWith({ dir: child, root });

    fireEvent.click(screen.getByRole('button', { name: 'preview.directory.up' }));
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ dir: root, root }));
    expect(screen.getByRole('button', { name: 'preview.directory.up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'preview.directory.up' }));
    expect(h.list).toHaveBeenLastCalledWith({ dir: root, root });
  });

  it('shows the root path when it has no basename', async () => {
    h.list.mockReset().mockResolvedValue([]);
    render(<DirectoryPreview path='/' />);
    await screen.findByText('preview.directory.empty');
    expect(screen.getByTitle('/')).toHaveTextContent('/');
  });

  it('pages a large frame folder, opens files and navigates subfolders', async () => {
    h.list.mockImplementation(async ({ dir }: { dir: string }) =>
      dir === 'C:/frames/sub'
        ? []
        : [
            { name: 'sub', fullPath: 'C:/frames/sub', isDir: true },
            ...Array.from({ length: 2491 }, (_, index) => ({
              name: `frame_${String(index).padStart(6, '0')}.jpg`,
              fullPath: `C:/frames/frame_${String(index).padStart(6, '0')}.jpg`,
              isDir: false,
              isFile: true,
              relativePath: '',
            })),
          ]
    );
    const { container } = render(<DirectoryPreview path='C:/frames' />);
    await screen.findByRole('button', { name: 'frame_000000.jpg' });
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('img').length).toBeLessThanOrEqual(60);
    expect(screen.queryByRole('button', { name: 'frame_000100.jpg' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'frame_000000.jpg' }));
    expect(h.open).toHaveBeenCalledWith('C:/frames/frame_000000.jpg');
    fireEvent.change(screen.getByPlaceholderText('preview.directory.search'), { target: { value: '000100' } });
    await screen.findByRole('button', { name: 'frame_000100.jpg' });
    fireEvent.change(screen.getByPlaceholderText('preview.directory.search'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'sub' }));
    await waitFor(() => expect(h.list).toHaveBeenCalledWith({ dir: 'C:/frames/sub', root: 'C:/frames' }));
    fireEvent.click(screen.getByRole('button', { name: 'preview.directory.up' }));
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ dir: 'C:/frames', root: 'C:/frames' }));
  });
});
