import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FileActions } from '@/renderer/components/files/FileActions';
import { SelectionActions } from '@/renderer/components/files/SelectionActions';
import { ContextActions } from '@/renderer/components/files/ContextActions';
import DocumentFrame from '@/renderer/pages/conversation/Preview/components/documents/DocumentFrame';

const h = vi.hoisted(() => ({ metadata: vi.fn(), copy: vi.fn(), open: vi.fn(), folder: vi.fn(), reveal: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getContentMetadata: { invoke: h.metadata }, openSystem: { invoke: h.open } },
    shell: { openFolderWith: { invoke: h.folder }, showItemInFolder: { invoke: h.reveal } },
  },
}));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: h.copy }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  vi.clearAllMocks();
  h.metadata.mockResolvedValue({ name: '预算.docx' });
});

describe('file and selection context actions', () => {
  it('repositions at the viewport edge when file metadata adds an action', () => {
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, 190, this.querySelectorAll('[role="menuitem"]').length * 34 + 8);
      });
    try {
      const action = { key: 'copy', label: 'Copy', run: vi.fn() };
      const point = { x: window.innerWidth - 2, y: window.innerHeight - 2 };
      const { rerender } = render(<ContextActions point={point} actions={[action]} onClose={vi.fn()} />);
      const popup = screen.getByRole('menu').parentElement!;
      expect(popup.style.top).toBe(`${window.innerHeight - 42 - 8}px`);
      rerender(
        <ContextActions
          point={point}
          actions={[action, { ...action, key: 'save', label: 'Save as' }]}
          onClose={vi.fn()}
        />
      );
      expect(popup.style.top).toBe(`${window.innerHeight - 76 - 8}px`);
    } finally {
      geometry.mockRestore();
    }
  });
  it('opens files from the same keyboard menu and copies their actual path', async () => {
    const preview = vi.fn();
    render(
      <FileActions file={{ kind: 'local', path: 'C:/交付/预算.docx' }} name='预算.docx' onOpen={preview}>
        <span tabIndex={0}>预算文件</span>
      </FileActions>
    );
    fireEvent.keyDown(screen.getByText('预算文件'), { key: 'F10', shiftKey: true });
    await screen.findByText('preview.saveAs');
    fireEvent.click(screen.getByText('preview.copyPath'));
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith('C:/交付/预算.docx'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('预算文件'), { clientX: 50, clientY: 60 });
    fireEvent.click(screen.getByText('preview.preview'));
    await waitFor(() => expect(preview).toHaveBeenCalledOnce());
  });
  it('opens directories in the file manager and never offers binary download', async () => {
    h.metadata.mockResolvedValue({ isDirectory: true });
    render(
      <FileActions file={{ kind: 'local', path: 'C:/交付/原片逐帧图片' }} name='原片逐帧图片'>
        <span>逐帧图片</span>
      </FileActions>
    );
    fireEvent.contextMenu(screen.getByText('逐帧图片'));
    await waitFor(() =>
      expect(screen.getByText('preview.openInSystemApp').closest('[role="menuitem"]')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    );
    expect(screen.queryByText('preview.downloadFile')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('preview.openInSystemApp'));
    await waitFor(() =>
      expect(h.folder).toHaveBeenCalledWith({ folder_path: 'C:/交付/原片逐帧图片', tool: 'explorer' })
    );
    expect(h.open).not.toHaveBeenCalled();
  });
  it('copies the selected text or a table as tab-separated cells', async () => {
    render(
      <SelectionActions>
        <p>已完成预算</p>
        <table>
          <tbody>
            <tr>
              <td>场地</td>
              <td>5500</td>
            </tr>
            <tr>
              <td>交通</td>
              <td>300</td>
            </tr>
          </tbody>
        </table>
      </SelectionActions>
    );
    fireEvent.contextMenu(screen.getByText('场地'));
    fireEvent.click(screen.getByText('common.copy'));
    await waitFor(() => expect(h.copy).toHaveBeenLastCalledWith('场地'));
    fireEvent.contextMenu(screen.getByText('5500'));
    fireEvent.click(screen.getByText('preview.copyTable'));
    await waitFor(() => expect(h.copy).toHaveBeenLastCalledWith('场地\t5500\n交通\t300'));
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('已完成预算'));
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    fireEvent.contextMenu(screen.getByText('已完成预算'));
    fireEvent.click(screen.getByText('common.copy'));
    await waitFor(() => expect(h.copy).toHaveBeenLastCalledWith('已完成预算'));
    document.getSelection()!.removeAllRanges();
  });
  it('offers the same menu inside a scriptless Office frame', async () => {
    render(<DocumentFrame title='预算预览' className='' html='<p>预算内容</p>' />);
    const frame = screen.getByTitle('预算预览') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = '<table><tr><td>物料</td><td>150</td></tr></table>';
    fireEvent.load(frame);
    fireEvent.contextMenu(frame.contentDocument!.querySelector('td')!, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByText('common.copy'));
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith('物料'));
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
  });
});
