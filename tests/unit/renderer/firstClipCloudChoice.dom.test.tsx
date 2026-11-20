import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicVideoConnection } from '@/common/chat/document/creation/cloudVideo';
import type { CreationOperation } from '@/common/chat/document/creation/operation';
import type { H3GenerationSpec } from '@/common/chat/document/h3Job';

const api = vi.hoisted(() => ({ connections: vi.fn() }));
vi.mock('@/common/chat/document/creation/cloudVideoApi', () => ({ cloudVideoApi: api }));

// Stable translator that exposes interpolation values, so the destination note
// can be asserted to name the endpoint that will receive the prompt.
const translate = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key} ${JSON.stringify(values)}` : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

import FirstClipCloudChoice from '@/renderer/pages/conversation/runtime/Creation/FirstClipCloudChoice';

const KEY = 'conversation.firstClipCloud';

const connection = (overrides: Partial<PublicVideoConnection>): PublicVideoConnection => ({
  id: 'c1',
  name: 'Studio H3',
  protocol: 'vllm-h3',
  baseUrl: 'https://h3.example.com/v1',
  model: 'h3-turbo',
  hasApiKey: true,
  ...overrides,
});

const operation = (spec: Partial<H3GenerationSpec> = {}): CreationOperation => ({
  id: 'op-1',
  requestId: 'req-1',
  conversationId: 'conv-1',
  state: 'awaiting-consent',
  spec: { prompt: 'A rainy street at night', durationSeconds: 5, ...spec },
  updatedAt: '2026-11-19T00:00:00.000Z',
});

describe('FirstClipCloudChoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers only vllm-h3 connections and sends the chosen connection with the endpoint shown', async () => {
    api.connections.mockResolvedValue([
      connection({}),
      connection({ id: 'c2', name: 'OpenAI video', protocol: 'openai-video', baseUrl: 'https://api.example.com/v1' }),
      connection({ id: 'c3', name: 'Backup H3', baseUrl: 'http://10.0.0.2:8091/v1', model: '' }),
    ]);
    const onChoose = vi.fn().mockResolvedValue(undefined);
    render(<FirstClipCloudChoice operation={operation()} onChoose={onChoose} />);

    expect(await screen.findByTestId('first-clip-cloud-choice')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('OpenAI video')).not.toBeInTheDocument();
    // The first compatible connection is preselected and named as the destination.
    expect(screen.getByTestId('first-clip-cloud-destination')).toHaveTextContent('Studio H3');
    expect(screen.getByTestId('first-clip-cloud-destination')).toHaveTextContent('https://h3.example.com/v1');

    fireEvent.click(screen.getByText('Backup H3'));
    expect(screen.getByTestId('first-clip-cloud-destination')).toHaveTextContent('http://10.0.0.2:8091/v1');

    fireEvent.click(screen.getByRole('button', { name: `${KEY}.submit` }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('c3', 'http://10.0.0.2:8091/v1'));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('explains local references and never asks for connections', () => {
    render(
      <FirstClipCloudChoice
        operation={operation({ references: [{ type: 'image', path: 'C:/refs/face.png' }] })}
        onChoose={vi.fn()}
      />
    );
    expect(screen.getByTestId('first-clip-cloud-incompatible')).toHaveTextContent(`${KEY}.incompatibleRefs`);
    expect(screen.getByText(`${KEY}.manualPath`)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.connections).not.toHaveBeenCalled();
  });

  it.each([
    ['explicit megapixels', { megapixels: 0.7 }],
    ['a non text-to-video mode', { mode: 'fl2v' as const }],
  ])('explains local-only settings for %s', (_label, spec) => {
    render(<FirstClipCloudChoice operation={operation(spec)} onChoose={vi.fn()} />);
    expect(screen.getByTestId('first-clip-cloud-incompatible')).toHaveTextContent(`${KEY}.incompatibleSettings`);
    expect(api.connections).not.toHaveBeenCalled();
  });

  it('shows the manual path when no compatible connection is configured', async () => {
    api.connections.mockResolvedValue([connection({ protocol: 'openai-video' })]);
    render(<FirstClipCloudChoice operation={operation()} onChoose={vi.fn()} />);
    expect(await screen.findByText(`${KEY}.noCompatibleConnections`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.manualPath`)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('reports a connection list failure', async () => {
    api.connections.mockRejectedValue(new Error('CLOUD_VIDEO_HTTP_500'));
    render(<FirstClipCloudChoice operation={operation()} onChoose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(`${KEY}.loadError`);
  });

  it('keeps the choice available after a failed submission', async () => {
    api.connections.mockResolvedValue([connection({})]);
    const onChoose = vi.fn().mockRejectedValue(new Error('CLOUD_ENDPOINT_CHANGED'));
    render(<FirstClipCloudChoice operation={operation()} onChoose={onChoose} />);
    const submit = await screen.findByRole('button', { name: `${KEY}.submit` });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(`${KEY}.submitError`);
    expect(screen.getByRole('button', { name: `${KEY}.submit` })).not.toBeDisabled();
  });

  it('cannot submit while the owning card is busy', async () => {
    api.connections.mockResolvedValue([connection({})]);
    const onChoose = vi.fn();
    render(<FirstClipCloudChoice operation={operation()} onChoose={onChoose} disabled />);
    const submit = await screen.findByRole('button', { name: `${KEY}.submit` });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
