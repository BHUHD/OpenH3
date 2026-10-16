import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreationModels } from '@/renderer/pages/guid/Creation/useCreationModels';

const mocks = vi.hoisted(() => ({ profiles: [] as Array<Record<string, unknown>>, refresh: vi.fn() }));
vi.mock('@/common/chat/document/creation/comfyApi', () => ({ comfyApi: { profiles: vi.fn() } }));
vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({ default: () => ({ modelListWithImage: [] }) }));
vi.mock('swr', () => ({
  default: (key: string) => ({
    data: key === 'creation.comfy-profiles' ? mocks.profiles : undefined,
    mutate: mocks.refresh,
    isLoading: false,
  }),
}));

describe('local ComfyUI profile selection', () => {
  beforeEach(() => {
    mocks.profiles = [];
    localStorage.clear();
  });

  it('lists image profiles with their validation states and an installable family catalog', () => {
    mocks.profiles = [
      {
        id: 'qwen-bf16',
        family: 'qwen-edit',
        name: 'Qwen-Edit BF16',
        kind: 'image',
        state: 'verified',
        version: 'v1',
        quantization: 'bf16',
      },
      {
        id: 'qwen-fp8',
        family: 'qwen-edit',
        name: 'Qwen-Edit FP8',
        kind: 'image',
        state: 'downloaded',
        version: 'v2',
        quantization: 'fp8',
      },
    ];
    const { result } = renderHook(() => useCreationModels(true));
    act(() => result.current.setSelection((previous) => ({ ...previous, kind: 'image', source: 'local' })));
    expect(result.current.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'qwen-bf16',
          family: 'qwen-edit',
          profileId: 'qwen-bf16',
          available: true,
          state: 'verified',
        }),
        expect.objectContaining({ id: 'qwen-fp8', available: false, state: 'downloaded' }),
        expect.objectContaining({ id: 'z-image', family: 'z-image', available: false, state: 'not-installed' }),
      ])
    );
    expect(result.current.models.some((item) => item.state === 'no-workflow')).toBe(false);
  });

  it('preserves the user profile choice when a new version appears and on remount', () => {
    mocks.profiles = [{ id: 'qwen-fp8', family: 'qwen-edit', name: 'Qwen-Edit FP8', kind: 'image', state: 'verified' }];
    const { result, unmount } = renderHook(() => useCreationModels(true));
    act(() =>
      result.current.setSelection((previous) => ({
        ...previous,
        source: 'local',
        kind: 'image',
        modelIds: { 'local-image': 'qwen-fp8' },
      }))
    );
    expect(result.current.model.id).toBe('qwen-fp8');
    unmount();
    mocks.profiles.unshift({
      id: 'qwen-bf16',
      family: 'qwen-edit',
      name: 'Qwen-Edit BF16',
      kind: 'image',
      state: 'verified',
    });
    const remount = renderHook(() => useCreationModels(true));
    expect(remount.result.current.model.id).toBe('qwen-fp8');
    expect(JSON.parse(localStorage.getItem('creation.selection')!)).toMatchObject({
      modelIds: { 'local-image': 'qwen-fp8' },
    });
  });

  it('keeps a selected missing profile unavailable instead of replacing it with another version', () => {
    mocks.profiles = [{ id: 'qwen-new', family: 'qwen-edit', name: 'Qwen-Edit new', kind: 'image', state: 'verified' }];
    localStorage.setItem(
      'creation.selection',
      JSON.stringify({ source: 'local', kind: 'image', modelIds: { 'local-image': 'qwen-previous' } })
    );
    const { result } = renderHook(() => useCreationModels(true));
    expect(result.current.model).toMatchObject({
      id: 'qwen-previous',
      profileId: 'qwen-previous',
      state: 'unavailable',
      available: false,
    });
  });

  it('retains the family of a selected profile after it disappears from inventory', () => {
    mocks.profiles = [{ id: 'z-prior', family: 'z-image', name: 'Z-Image prior', kind: 'image', state: 'verified' }];
    localStorage.setItem(
      'creation.selection',
      JSON.stringify({ source: 'local', kind: 'image', modelIds: { 'local-image': 'z-prior' } })
    );
    const first = renderHook(() => useCreationModels(true));
    expect(first.result.current.model.family).toBe('z-image');
    first.unmount();
    mocks.profiles = [];
    const next = renderHook(() => useCreationModels(true));
    expect(next.result.current.model).toMatchObject({
      profileId: 'z-prior',
      name: 'Z-Image prior',
      family: 'z-image',
      state: 'unavailable',
    });
  });
});
