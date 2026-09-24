import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  status: vi.fn(),
  setup: vi.fn(),
  setupPlan: vi.fn(),
  setupHardware: vi.fn(),
  install: vi.fn(),
  pauseSetup: vi.fn(),
  startRuntime: vi.fn(),
  setupCapabilities: vi.fn(),
  create: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const messages = zh.h3Setup as Record<string, string>;
      return (messages[key.split('.').at(-1)!] ?? key).replace(/{{(\w+)}}/g, (_, name: string) =>
        String(values[name] ?? '')
      );
    },
  }),
}));
import zh from '@/renderer/services/i18n/locales/zh-CN/settings.json';
vi.mock('@/common/chat/document/h3JobApi', () => ({ h3JobApi: api }));
vi.mock('@/common', () => ({ ipcBridge: { dialog: { showOpen: { invoke: vi.fn() } } } }));
import H3EnvironmentContent from '@/renderer/components/settings/SettingsModal/contents/H3EnvironmentContent';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({
    ready: false,
    install: { bundleRoot: 'bundle', missingAssets: [], missingCustomNodes: [] },
  });
  api.setup.mockResolvedValue({ phase: 'idle' });
  api.setupHardware.mockResolvedValue({
    status: 'baseline-match',
    gpuNames: ['RTX 5080'],
    memoryGiB: 128,
    driver: '591.44',
    reasons: [],
  });
  api.setupPlan.mockResolvedValue({
    freeBytes: 100,
    requiredBytes: 80,
    downloadBytes: 60,
    reserveBytes: 20,
    enough: true,
  });
  api.install.mockResolvedValue({ phase: 'downloading', download: true });
  api.startRuntime.mockResolvedValue({ connected: true, generationVerified: false });
  api.setupCapabilities.mockResolvedValue({
    nodesAvailable: true,
    modelsAvailable: true,
    missingModels: [],
    modes: [],
  });
  api.create.mockResolvedValue({ id: 'smoke', status: 'queued', progress: 0, artifacts: [] });
});
it('starts explicitly, checks models, then submits a bounded real generation job', async () => {
  render(<H3EnvironmentContent />);
  await waitFor(() => expect(screen.getByRole('button', { name: '启动运行时' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: '启动运行时' }));
  await waitFor(() => expect(api.startRuntime).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText('高级检查与修复'));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成测试视频' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: '生成测试视频' }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 4, megapixels: 0.2, mode: 't2v' })
    )
  );
});
it('requires explicit consent before requesting network installation', async () => {
  render(<H3EnvironmentContent />);
  await screen.findByText(/预算需求/);
  expect(screen.getByRole('button', { name: '下载并安装' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '下载并安装' }));
  await waitFor(() => expect(api.install).toHaveBeenCalledWith({ download: true, acceptModelTerms: true }));
});
it('blocks download when disk budget is insufficient', async () => {
  api.setupPlan.mockResolvedValue({
    freeBytes: 1,
    requiredBytes: 80,
    downloadBytes: 60,
    reserveBytes: 20,
    enough: false,
  });
  render(<H3EnvironmentContent />);
  await screen.findByText(/磁盘空间不足/);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: '下载并安装' })).toBeDisabled();
});
it('shows per-file progress and pauses a running download', async () => {
  api.setup.mockResolvedValue({
    phase: 'downloading',
    bundleRoot: 'bundle',
    filename: 'model',
    bytes: 3,
    totalBytes: 6,
  });
  api.pauseSetup.mockResolvedValue({ phase: 'paused', download: true });
  render(<H3EnvironmentContent />);
  await screen.findByLabelText('当前文件下载进度');
  await waitFor(() => expect(screen.getByRole('button', { name: '暂停下载' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: '暂停下载' }));
  await waitFor(() => expect(api.pauseSetup).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: '继续下载并安装' });
});

it('automatically starts an installed environment and reports readiness only after model checks', async () => {
  api.status.mockResolvedValue({
    ready: false,
    readiness: 'ready',
    install: { bundleRoot: 'bundle', missingAssets: [], missingCustomNodes: [] },
  });
  const ready = vi.fn();
  render(<H3EnvironmentContent automatic onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(api.startRuntime).toHaveBeenCalledOnce();
  expect(api.setupCapabilities).toHaveBeenCalledOnce();
  expect(api.create).not.toHaveBeenCalled();
});
it('does not loop startup or report ready when a model check fails', async () => {
  api.status.mockResolvedValue({
    ready: false,
    readiness: 'ready',
    install: { bundleRoot: 'bundle', missingAssets: [], missingCustomNodes: [] },
  });
  api.setupCapabilities.mockResolvedValue({
    nodesAvailable: true,
    modelsAvailable: false,
    missingModels: ['missing'],
    modes: [],
  });
  const ready = vi.fn();
  render(<H3EnvironmentContent automatic onReady={ready} />);
  await screen.findByRole('alert');
  expect(ready).not.toHaveBeenCalled();
  expect(api.startRuntime).toHaveBeenCalledOnce();
});
it('automatically continues an installed download through startup', async () => {
  api.setup.mockResolvedValue({ phase: 'installed', bundleRoot: 'bundle' });
  const ready = vi.fn();
  render(<H3EnvironmentContent automatic onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(api.install).not.toHaveBeenCalled();
});
it('does not automatically start unsupported hardware', async () => {
  api.status.mockResolvedValue({
    ready: false,
    readiness: 'ready',
    install: { bundleRoot: 'bundle', missingAssets: [], missingCustomNodes: [] },
  });
  api.setupHardware.mockResolvedValue({ status: 'blocked', gpuNames: ['GTX 1080'], memoryGiB: 32, reasons: [] });
  render(<H3EnvironmentContent automatic />);
  await screen.findByText('当前硬件不符合此安装配方');
  expect(api.startRuntime).not.toHaveBeenCalled();
  expect(api.install).not.toHaveBeenCalled();
});

it('shows automatic retry with preserved progress instead of asking the user to restart', async () => {
  api.setup.mockResolvedValue({
    phase: 'downloading',
    bundleRoot: 'bundle',
    filename: 'model',
    bytes: 20,
    totalBytes: 100,
    retryAttempt: 2,
    retryDelayMs: 2000,
  });
  render(<H3EnvironmentContent />);
  await screen.findByText('网络暂时中断，2秒后自动进行第2次尝试，已保留下载进度。');
  expect(api.install).not.toHaveBeenCalled();
});

it('keeps model consent and installation action together below hardware details', async () => {
  render(<H3EnvironmentContent />);
  const footer = screen.getByTestId('h3-setup-footer');
  await screen.findByText(/预算需求/);
  expect(footer.contains(screen.getByRole('checkbox'))).toBe(true);
  expect(footer.contains(screen.getByRole('button', { name: '下载并安装' }))).toBe(true);
  expect(
    screen.getByTestId('h3-setup-hardware').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});
