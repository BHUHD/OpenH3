/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { CloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount';

type LoginModalProps = {
  visible: boolean;
  onClose: () => void;
  /** When true the footer shows a skip button; hidden once connected. */
  showSkip?: boolean;
};

/** Modal wrapper for the cloud account login/register flow.
 * Triggered from the sidebar account entry and on first launch.
 */
const LoginModal: React.FC<LoginModalProps> = ({ visible, onClose, showSkip = true }) => {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Land on the first form field rather than the first tab button.
  const focusFirstField = () => {
    bodyRef.current?.querySelector('input')?.focus();
  };
  return (
    <Modal
      title={t('settings.cloudAccount.loginModalTitle')}
      visible={visible}
      onCancel={onClose}
      afterOpen={focusFirstField}
      footer={
        showSkip ? (
          <Button type='text' onClick={onClose}>
            {t('settings.cloudAccount.skipLogin')}
          </Button>
        ) : null
      }
      style={{ maxWidth: 480 }}
      unmountOnExit
      focusLock
      autoFocus={false}
      escToExit
    >
      <div ref={bodyRef}>
        <CloudAccount variant='modal' />
      </div>
    </Modal>
  );
};

export default LoginModal;
