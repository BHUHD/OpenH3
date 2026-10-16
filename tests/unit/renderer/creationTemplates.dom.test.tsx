import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import CreationTemplates from '@/renderer/pages/guid/components/CreationTemplates';
import guid from '@/renderer/services/i18n/locales/zh-CN/guid.json';
import { useCreationModels } from '@/renderer/pages/guid/Creation/useCreationModels';

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({
    data: [{ id: 'gemini-images', name: 'Gemini', platform: 'gemini', base_url: '', models: ['gemini-2.5-flash'] }],
  }),
}));

const renderTemplates = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { guid } } } });
  const onUseTemplate = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <CreationTemplates onUseTemplate={onUseTemplate} />
    </I18nextProvider>
  );
  return { ...view, onUseTemplate };
};

describe('CreationTemplates', () => {
  it('offers the same supplemented cloud image models as the existing tool settings', () => {
    const hook = renderHook(() => useCreationModels(false));
    act(() => hook.result.current.setSelection({ kind: 'image', source: 'cloud', modelIds: {} }));
    expect(hook.result.current.models).toContainEqual(
      expect.objectContaining({
        id: 'gemini-images::gemini-2.5-flash-image-preview',
        available: true,
      })
    );
    act(() => hook.result.current.setSelection({ kind: 'video', source: 'local', modelIds: {} }));
    hook.unmount();
  });
  it('shows image examples and playable videos with local posters without preloading every clip', async () => {
    const { container } = await renderTemplates();

    expect(screen.getAllByRole('article')).toHaveLength(12);
    expect(screen.getAllByRole('img')).toHaveLength(8);
    const videos = Array.from(container.querySelectorAll('video'));
    expect(videos).toHaveLength(4);
    for (const video of videos) {
      expect(screen.getByRole('button', { name: `播放 ${video.getAttribute('aria-label')}` })).toBeInTheDocument();
      expect(video.preload).toBe('none');
      expect(video.getAttribute('poster')).toMatch(/\.webp/);
      expect(video.getAttribute('src')).toMatch(/\.mp4/);
      expect(video.getAttribute('src')).not.toMatch(/^https?:/);
    }
  });

  it('filters images and videos and restores all templates', async () => {
    await renderTemplates();
    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '视频' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '图片' }));
    expect(screen.getAllByRole('article')).toHaveLength(8);

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getAllByRole('article')).toHaveLength(12);
  });

  it('fills the complete image or video prompt when using the corresponding template', async () => {
    const { onUseTemplate } = await renderTemplates();
    const firstImage = screen.getAllByRole('article')[0];
    fireEvent.click(within(firstImage).getByRole('button', { name: '做同款' }));
    expect(onUseTemplate).toHaveBeenLastCalledWith(
      guid.templates.poster.prompt,
      expect.objectContaining({ kind: 'image' })
    );

    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    const firstVideo = screen.getAllByRole('article')[0];
    fireEvent.click(within(firstVideo).getByRole('button', { name: '做同款' }));
    expect(onUseTemplate.mock.calls.at(-1)?.[0]).toContain('6 秒');
    expect(onUseTemplate.mock.calls.at(-1)?.[0]).toContain('视频');
  });

  it('keeps the template usable when its image preview fails', async () => {
    const { onUseTemplate } = await renderTemplates();
    const card = screen.getAllByRole('article')[0];
    fireEvent.error(within(card).getByRole('img'));
    expect(within(card).getByText('预览暂不可用')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: '做同款' }));
    expect(onUseTemplate).toHaveBeenCalledWith(
      guid.templates.poster.prompt,
      expect.objectContaining({ kind: 'image' })
    );
  });

  it('keeps the video prompt available after a playback error', async () => {
    const { onUseTemplate, container } = await renderTemplates();
    fireEvent.click(screen.getByRole('button', { name: '视频' }));
    fireEvent.error(container.querySelector('video')!);
    const card = screen.getAllByRole('article')[0];
    expect(within(card).getByText('预览暂不可用')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: '做同款' }));
    expect(onUseTemplate).toHaveBeenCalledWith(guid.templates.coast.prompt, expect.objectContaining({ kind: 'video' }));
  });
});
