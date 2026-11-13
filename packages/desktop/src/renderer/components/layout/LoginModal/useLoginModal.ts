/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';

const SKIP_KEY = 'login-modal-skipped';

/** Returns open/close state for the login modal.
 * First-launch: opens once automatically if the user is not connected and has
 * not previously dismissed it. Subsequent opens are always manual.
 * Auto-closes when the session transitions to connected (login success).
 */
export function useLoginModal() {
  const [open, setOpen] = useState(false);
  const cloud = useOptionalCloudAccount();
  const connected = cloud?.session?.state === 'connected';
  const available = Boolean(cloud?.available);

  // First-launch auto-popup: open once if not connected and not previously skipped.
  useEffect(() => {
    if (!available || connected) return;
    try {
      if (localStorage.getItem(SKIP_KEY)) return;
    } catch {
      return;
    }
    setOpen(true);
  }, [available, connected]);

  // Auto-close on successful login: when session transitions to connected.
  useEffect(() => {
    if (connected) setOpen(false);
  }, [connected]);

  const handleClose = () => {
    setOpen(false);
    try {
      localStorage.setItem(SKIP_KEY, '1');
    } catch {
      // ignore
    }
  };

  const openManual = () => setOpen(true);

  return { open, openManual, handleClose, connected };
}
