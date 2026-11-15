/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { CreationRequest } from '@/common/chat/document/creation/creation';
import CreationKindBar from '@/renderer/pages/conversation/components/ChatLayout/CreationKindBar';
import enGuid from '@/renderer/services/i18n/locales/en-US/guid.json';
import zhGuid from '@/renderer/services/i18n/locales/zh-CN/guid.json';

const renderBar = (value: CreationRequest | null | undefined, language = 'en-US') => {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    initImmediate: false,
    resources: {
      'en-US': { translation: { guid: enGuid } },
      'zh-CN': { translation: { guid: zhGuid } },
    },
  });
  return render(<CreationKindBar request={value} />, {
    wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>,
  });
};

afterEach(cleanup);

const request = (overrides: Partial<CreationRequest> = {}): CreationRequest => ({
  id: 'qwen-image',
  name: 'Qwen Image',
  kind: 'image',
  source: 'local',
  state: 'installed',
  ...overrides,
});

describe('CreationKindBar', () => {
  it.each([undefined, null])('keeps ordinary conversations free of creation metadata (%s)', (value) => {
    const { container } = renderBar(value);
    expect(container).toBeEmptyDOMElement();
  });

  it('identifies local image creation and shows the full model name in a tooltip', () => {
    renderBar(request({ name: 'Qwen Image <portrait>' }));
    expect(screen.getByTestId('creation-kind-bar')).toHaveTextContent('Image');
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('Qwen Image <portrait>')).toHaveAttribute('title', 'Qwen Image <portrait>');
    expect(screen.queryByText('Video')).not.toBeInTheDocument();
  });

  it('updates kind, source and model when switching creation requests', () => {
    const { rerender } = renderBar(request());
    rerender(<CreationKindBar request={request({ kind: 'video', source: 'cloud', name: 'MiniMax H3' })} />);
    expect(screen.getByTestId('creation-kind-bar')).toHaveTextContent('Video');
    expect(screen.getByText('Cloud')).toBeInTheDocument();
    expect(screen.getByText('MiniMax H3')).toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
    expect(screen.queryByText('Qwen Image')).not.toBeInTheDocument();
  });

  it.each([
    ['image', 'local', '图片', '本地'],
    ['video', 'cloud', '视频', '云端'],
  ] as const)('translates %s creation with the shipped Chinese resources', (kind, source, label, sourceLabel) => {
    renderBar(request({ kind, source }), 'zh-CN');
    expect(screen.getByTestId('creation-kind-bar')).toHaveTextContent(label);
    expect(screen.getByText(sourceLabel)).toBeInTheDocument();
  });
});
