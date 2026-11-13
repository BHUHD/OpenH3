/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { CloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount';

type LoginModalProps = {
  visible: boolean;
  onClose: () => void;
  /** When true the footer shows a "skip" button; hides on already-connected state */
  showSkip?: boolean;
};

/** Modal wrapper for the cloud account login/register flow.
 * Triggered from the sidebar account entry and on first launch (option A).
 */
const LoginModal: React.FC<LoginModalProps> = ({ visible, onClose, showSkip = true }) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('settings.cloudAccount.loginModalTitle')}
      visible={visible}
      onCancel={onClose}
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
      escToExit
    >
      <CloudAccount />
    </Modal>
  );
};

export default LoginModal;
