import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const h3 = vi.hoisted(() => ({
  H3ServiceError: class H3ServiceError extends Error {
    diagnosis?: unknown;
  },
  create: vi.fn(),
  events: vi.fn(() => ({ close: vi.fn() })),
  cancel: vi.fn(),
  versions: vi.fn().mockResolvedValue([]),
  selectVersion: vi.fn(),
  compareVersions: vi.fn(),
  rejectVersion: vi.fn(),
  undoVersion: vi.fn(),
  deriveVersion: vi.fn(),
  status: vi.fn().mockResolvedValue({
    ready: true,
    install: {
      bundleRoot: 'bundle',
      runtimeRoot: 'runtime',
      modelsDirectory: 'models',
      bundleVerified: true,
      runtimePresent: true,
      missingAssets: [],
      missingCustomNodes: [],
    },
    acceleration: {
      mode: 'auto',
      backend: 'dense',
      available: false,
      tritonPresent: false,
      pythonDevPresent: false,
      reason: 'ACCEL_ROOT_NOT_CONFIGURED',
    },
  }),
  resourceUrl: vi.fn((resourcePath: string) => `http://127.0.0.1:33002${resourcePath}`),
}));
vi.mock('@/common/chat/document/h3JobApi', () => ({ h3JobApi: h3, H3ServiceError: h3.H3ServiceError }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import H3GenerationPanel from '@/renderer/pages/conversation/Preview/components/Video/H3GenerationPanel';

describe('H3 generation panel', () => {
  it('submits a generation job and renders its safe artifact resource', async () => {
    h3.create.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      progress: 0,
      artifacts: [],
      resolvedMode: 't2v',
      spec: { prompt: 'city', mode: 'auto', references: [] },
    });
    const { rerender } = render(<H3GenerationPanel />);
    expect(await screen.findByTestId('h3-runtime-status')).toHaveTextContent('preview.video.h3RuntimeReady');
    fireEvent.change(screen.getByRole('textbox', { name: 'preview.video.h3Prompt' }), { target: { value: 'city' } });
    fireEvent.click(screen.getByRole('button', { name: 'preview.video.h3Generate' }));
    await waitFor(() =>
      expect(h3.create).toHaveBeenCalledWith({
        prompt: 'city',
        durationSeconds: 5,
        megapixels: 0.2,
        mode: 'auto',
        references: [],
      })
    );
    expect(screen.getByRole('status')).toHaveTextContent('queued');
    const onJob = h3.events.mock.calls[0][1];
    onJob({
      id: 'job-1',
      status: 'succeeded',
      progress: 1,
      artifacts: [{ resourcePath: '/api/h3/jobs/job-1/artifacts/0', mimeType: 'video/mp4' }],
      resolvedMode: 't2v',
      spec: { prompt: 'city', mode: 'auto', references: [] },
    });
    rerender(<H3GenerationPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('h3-output-video')).toHaveAttribute(
        'src',
        expect.stringContaining('/api/h3/jobs/job-1/artifacts/0')
      )
    );
  });

  it('renders structured preflight diagnosis instead of a raw backend traceback', async () => {
    const failure = new h3.H3ServiceError('H3_WORKFLOW_PREFLIGHT:INVALID_INPUT:node=42');
    failure.diagnosis = { category: 'INVALID_INPUT', action: 'CHECK_WORKFLOW_INPUTS', nodeId: '42', retryable: false };
    h3.create.mockRejectedValue(failure);
    render(<H3GenerationPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: 'preview.video.h3Prompt' }), { target: { value: 'city' } });
    fireEvent.click(screen.getByRole('button', { name: 'preview.video.h3Generate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_INPUT: CHECK_WORKFLOW_INPUTS (node 42)');
    expect(screen.getByRole('alert')).not.toHaveTextContent('traceback');
  });

  it('compares candidates and accepts against the selected source version', async () => {
    const versions = [
      {
        id: 'v1',
        parentId: null,
        label: 'H3 1',
        jobId: 'j1',
        createdAt: '2026-01-01T00:00:00Z',
        selected: true,
        review: 'accepted',
        artifactPath: '/api/h3/jobs/j1/artifacts/0',
      },
      {
        id: 'v2',
        parentId: 'v1',
        label: 'H3 2',
        jobId: 'j2',
        createdAt: '2026-01-01T00:00:01Z',
        selected: false,
        review: 'candidate',
        artifactPath: '/api/h3/jobs/j2/artifacts/0',
      },
    ];
    h3.versions.mockResolvedValue(versions);
    h3.compareVersions.mockResolvedValue([versions[0], versions[1]]);
    h3.selectVersion.mockResolvedValue(versions.map((version) => ({ ...version, selected: version.id === 'v2' })));
    render(<H3GenerationPanel />);
    expect(await screen.findByTestId('h3-versions')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('h3-compare-v1'));
    fireEvent.click(screen.getByTestId('h3-compare-v2'));
    await waitFor(() => expect(h3.compareVersions).toHaveBeenLastCalledWith(['v1', 'v2']));
    fireEvent.click(screen.getByTestId('h3-select-v2'));
    await waitFor(() => expect(h3.selectVersion).toHaveBeenCalledWith('v2', 'v1'));
  });
});
