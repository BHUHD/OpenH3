import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { ComfyGenerationJob } from '@/common/chat/document/creation/comfy';
import ComfyGenerationResult, {
  comfyGenerationTurnResults,
} from '@/renderer/pages/conversation/runtime/Creation/ComfyGenerationResult';

const mocks = vi.hoisted(() => ({ job: vi.fn(), cancelJob: vi.fn(), jobArtifactUrl: vi.fn() }));
vi.mock('@/common/chat/document/creation/comfyApi', () => ({ comfyApi: mocks }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { index: number }) => (values ? `${key}:${values.index}` : key),
  }),
}));

const JOB_ID = '12345678-1234-1234-1234-123456789abc';
const CONVERSATION_ID = 'conv-1';
const SECOND_JOB_ID = '87654321-1234-1234-1234-123456789abc';
const output = (id: string) => ({ type: 'tool_group', content: [{ output: JSON.stringify({ comfyJobId: id }) }] });
const job = (
  overrides: Partial<ComfyGenerationJob> & { diagnosticLogPath?: string } = {}
): ComfyGenerationJob & {
  diagnosticLogPath?: string;
} => ({
  id: JOB_ID,
  profileId: 'qwen-edit-2509',
  kind: 'image',
  status: 'queued',
  progress: 0,
  artifacts: [],
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
  ...overrides,
});

async function renderResult(id = JOB_ID) {
  const result = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ComfyGenerationResult id={id} conversationId={CONVERSATION_ID} />
    </SWRConfig>
  );
  await act(async () => {});
  return result;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ComfyUI generation result', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.job.mockReset().mockResolvedValue(job());
    mocks.cancelJob.mockReset().mockResolvedValue(job({ status: 'cancelled' }));
    mocks.jobArtifactUrl.mockReset().mockImplementation((id: string, index: number) => `/jobs/${id}/${index}`);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads job IDs from native and ACP outputs and ignores inputs, text, and operation IDs', () => {
    const groups = comfyGenerationTurnResults([
      {
        id: 'native-tool',
        type: 'tool_call',
        position: 'left',
        messages: [
          {
            type: 'tool_call',
            content: {
              args: { comfyJobId: SECOND_JOB_ID },
              result: { content: [{ type: 'text', text: JSON.stringify({ comfyJobId: JOB_ID }) }] },
            },
          },
          { type: 'text', content: JSON.stringify({ comfyJobId: SECOND_JOB_ID }) },
          { type: 'acp_tool_call', content: { output: JSON.stringify({ comfyOperationId: SECOND_JOB_ID }) } },
        ],
      },
      {
        id: 'acp-tool',
        type: 'acp_tool_call',
        position: 'left',
        messages: [
          { type: 'acp_tool_call', content: { output: JSON.stringify({ comfyJobId: SECOND_JOB_ID }) } },
          { type: 'acp_tool_call', content: { output: JSON.stringify({ comfyJobId: '../invalid' }) } },
        ],
      },
      { id: 'assistant-reply', type: 'text', position: 'left' },
    ]);
    expect([...groups.entries()]).toEqual([['assistant-reply', [JOB_ID, SECOND_JOB_ID]]]);
  });

  it('anchors unique generation outputs after each assistant turn', () => {
    const groups = comfyGenerationTurnResults([
      { id: 'tool-1', type: 'tool_group', messages: [output(JOB_ID), output(JOB_ID)] },
      { id: 'reply-1', type: 'text', position: 'left' },
      { id: 'user', type: 'text', position: 'right' },
      { id: 'tool-2', type: 'tool_group', messages: [output(JOB_ID), output(SECOND_JOB_ID)] },
      { id: 'reply-2', type: 'text', position: 'left' },
    ]);
    expect([...groups.entries()]).toEqual([
      ['reply-1', [JOB_ID]],
      ['reply-2', [SECOND_JOB_ID]],
    ]);
  });

  it('renders image and video previews from application artifact URLs', async () => {
    mocks.job.mockResolvedValue(
      job({
        status: 'succeeded',
        progress: 100,
        artifacts: [
          { path: 'D:\\models\\result.png', mimeType: 'image/png' },
          { path: 'D:\\models\\result.mp4', mimeType: 'video/mp4' },
          { path: 'D:\\models\\metadata.json', mimeType: 'application/json' },
        ],
      })
    );
    await renderResult();
    expect(screen.getByRole('img')).toHaveAttribute('src', `/jobs/${JOB_ID}/0`);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'guid.comfy.generation.artifact:1');
    const video = screen.getByLabelText('guid.comfy.generation.artifact:2');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', `/jobs/${JOB_ID}/1`);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(mocks.job).toHaveBeenCalledWith(JOB_ID, CONVERSATION_ID);
    expect(mocks.jobArtifactUrl).toHaveBeenCalledWith(JOB_ID, 0, CONVERSATION_ID);
    expect(mocks.jobArtifactUrl).toHaveBeenCalledWith(JOB_ID, 1, CONVERSATION_ID);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps polling cache and results separate when the same job ID is referenced in another conversation', async () => {
    mocks.job.mockImplementation((_id: string, conversationId: string) =>
      Promise.resolve(job({ status: 'failed', error: conversationId }))
    );
    const cache = new Map();
    const content = (conversationId: string) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <ComfyGenerationResult id={JOB_ID} conversationId={conversationId} />
      </SWRConfig>
    );
    const view = render(content('conv-1'));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('conv-1');
    view.rerender(content('conv-2'));
    await act(async () => {});
    expect(mocks.job).toHaveBeenCalledWith(JOB_ID, 'conv-2');
    expect(screen.getByRole('alert')).toHaveTextContent('conv-2');
  });

  it('shows bounded parameter changes and the actual generation input', async () => {
    mocks.job.mockResolvedValue(
      job({
        status: 'succeeded',
        adjustments: [{ reason: 'GPU memory budget', input: { prompt: 'a flower', width: 768, height: 512 } }],
      })
    );
    await renderResult();
    expect(screen.getByText('guid.comfy.generation.adjusted')).toBeInTheDocument();
    expect(screen.getByText('GPU memory budget')).toBeInTheDocument();
    fireEvent.click(screen.getByText('guid.comfy.generation.actualInput'));
    expect(screen.getByText(/"width": 768/)).toBeInTheDocument();
    expect(screen.getByText(/"height": 512/)).toBeInTheDocument();
  });

  it('shows diagnosis and uncertain submission guidance without offering another submission', async () => {
    mocks.job.mockResolvedValue(
      job({
        status: 'failed',
        submissionUncertain: true,
        diagnosis: { category: 'submission', retryable: false, action: 'Inspect queue', nodeId: '12' },
      })
    );
    await renderResult();
    expect(screen.getByText('guid.comfy.generation.submissionUncertain')).toBeInTheDocument();
    expect(screen.getByText(/Inspect queue/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the diagnostic log path without fetching log contents', async () => {
    mocks.job.mockResolvedValue(job({ diagnosticLogPath: 'D:/ComfyUI/logs/job-1.jsonl' }));
    await renderResult();
    fireEvent.click(screen.getByText('guid.comfy.diagnosticLog'));
    expect(screen.getByText('D:/ComfyUI/logs/job-1.jsonl')).toBeInTheDocument();
    expect(screen.queryByText(/raw log|stack trace/i)).not.toBeInTheDocument();
  });

  it('fetches once per polling interval and stops after success', async () => {
    mocks.job
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job({ status: 'running', progress: 35 }))
      .mockResolvedValue(job({ status: 'succeeded', progress: 100 }));
    await renderResult();
    expect(mocks.job).toHaveBeenCalledTimes(1);
    await advance(1500);
    expect(mocks.job).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('guid.comfy.generation.states.running');
    await advance(1500);
    expect(mocks.job).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status')).toHaveTextContent('guid.comfy.generation.states.succeeded');
    await advance(15_000);
    expect(mocks.job).toHaveBeenCalledTimes(3);
  });

  it.each(['failed', 'cancelled'] as const)('does not poll a %s job', async (status) => {
    mocks.job.mockResolvedValue(job({ status, ...(status === 'failed' ? { error: 'Workflow failed' } : {}) }));
    await renderResult();
    await advance(15_000);
    expect(mocks.job).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(`guid.comfy.generation.states.${status}`);
    if (status === 'failed') expect(screen.getByRole('alert')).toHaveTextContent('Workflow failed');
  });

  it('retries an unavailable initial fetch and clears the failure after recovery', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mocks.job.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValue(job({ status: 'succeeded' }));
    await renderResult();
    expect(screen.getByRole('alert')).toHaveTextContent('guid.comfy.generation.unavailable');
    await advance(4000);
    expect(mocks.job).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('guid.comfy.generation.states.succeeded');
  });

  it('cancels the job on request and stops polling', async () => {
    await renderResult();
    expect(mocks.cancelJob).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'guid.comfy.generation.cancel' }));
    });
    expect(mocks.cancelJob).toHaveBeenCalledWith(JOB_ID, CONVERSATION_ID);
    expect(screen.getByRole('status')).toHaveTextContent('guid.comfy.generation.states.cancelled');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await advance(15_000);
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation errors visible while polling the active job', async () => {
    mocks.cancelJob.mockRejectedValue(new Error('Cancellation failed'));
    await renderResult();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'guid.comfy.generation.cancel' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Cancellation failed');
    await advance(1500);
    expect(mocks.job).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'guid.comfy.generation.cancel' })).not.toBeDisabled();
  });

  it('does not let an in-flight poll overwrite a completed cancellation', async () => {
    let resolvePoll: ((value: ComfyGenerationJob) => void) | undefined;
    mocks.job.mockResolvedValueOnce(job()).mockImplementationOnce(
      () =>
        new Promise<ComfyGenerationJob>((resolve) => {
          resolvePoll = resolve;
        })
    );
    await renderResult();
    await advance(1500);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'guid.comfy.generation.cancel' }));
    });
    await act(async () => {
      resolvePoll?.(job({ status: 'running' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('guid.comfy.generation.states.cancelled');
    await advance(15_000);
    expect(mocks.job).toHaveBeenCalledTimes(2);
  });

  it('stops polling when the card unmounts', async () => {
    const { unmount } = await renderResult();
    unmount();
    await advance(15_000);
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });
});
