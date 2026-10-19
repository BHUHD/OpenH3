/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const UPDATE_READY_STATE_EVENT = 'openh3-update-ready-state-changed';
export const LEGACY_UPDATE_READY_STATE_EVENT = 'aionui-update-ready-state-changed';

export type UpdateReadyState = {
  ready: boolean;
  version: string;
  filePath?: string;
  preparing?: boolean;
};

let currentUpdateReadyState: UpdateReadyState = {
  ready: false,
  version: '',
};

export const getUpdateReadyState = () => currentUpdateReadyState;

export const setUpdateReadyState = (state: UpdateReadyState) => {
  currentUpdateReadyState = state;
  window.dispatchEvent(new CustomEvent<UpdateReadyState>(UPDATE_READY_STATE_EVENT, { detail: state }));
  window.dispatchEvent(new CustomEvent<UpdateReadyState>(LEGACY_UPDATE_READY_STATE_EVENT, { detail: state }));
};

export const subscribeUpdateReadyState = (listener: (state: UpdateReadyState) => void) => {
  const handledStates = new WeakSet<object>();
  const handler = (evt: Event) => {
    const state = (evt as CustomEvent<UpdateReadyState>).detail;
    if (state && typeof state === 'object') {
      if (handledStates.has(state)) return;
      handledStates.add(state);
    }
    listener(state);
  };
  window.addEventListener(UPDATE_READY_STATE_EVENT, handler);
  window.addEventListener(LEGACY_UPDATE_READY_STATE_EVENT, handler);
  return () => {
    window.removeEventListener(UPDATE_READY_STATE_EVENT, handler);
    window.removeEventListener(LEGACY_UPDATE_READY_STATE_EVENT, handler);
  };
};
