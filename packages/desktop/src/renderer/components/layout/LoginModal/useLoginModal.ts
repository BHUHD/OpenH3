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
  // catalogPending is set to true immediately after a successful login and cleared
  // once the catalog fetch completes. Gate the auto-close on it being false so we
  // don't unmount CloudAccount (which triggers cloud.cancel()) while the catalog
  // ticket is still in flight — that would increment the fence epoch and skip the
  // final provider mutation.
  const catalogPending = Boolean(cloud?.catalogPending);
  const canAutoPrompt =
    Boolean(cloud?.available) &&
    cloud?.capabilities?.availability === 'available' &&
    (cloud?.session?.state === 'disconnected' || cloud?.session?.state === 'reauth_required');

  // Wait for a known session and usable service, then prompt once per profile.
  useEffect(() => {
    if (!canAutoPrompt) return;
    try {
      if (localStorage.getItem(SKIP_KEY)) return;
      localStorage.setItem(SKIP_KEY, '1');
    } catch {
      return;
    }
    setOpen(true);
  }, [canAutoPrompt]);

  // Auto-close on successful login: wait until catalogPending is false so the
  // Provider's post-login catalog fetch completes before we unmount CloudAccount.
  // Unmounting early triggers cloud.cancel() → fence epoch increment, which
  // invalidates the catalog ticket and skips the final provider mutation.
  useEffect(() => {
    if (connected && !catalogPending) setOpen(false);
  }, [connected, catalogPending]);

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
