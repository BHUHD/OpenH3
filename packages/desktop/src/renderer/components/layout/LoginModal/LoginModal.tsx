/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { CloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import { CloudAccountHeading } from '@/renderer/components/settings/SettingsModal/CloudAccount/Identity';
import styles from '@/renderer/components/settings/SettingsModal/CloudAccount/AccountSurface.module.css';

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
  const cloud = useOptionalCloudAccount();
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleKey = {
    login: 'loginModalTitle',
    register: 'createAccount',
    recovery: 'recovery',
    reset: 'savePassword',
    proof: 'verify',
  }[cloud?.view ?? 'login'];
  // Land on the first form field rather than the first tab button.
  const focusFirstField = () => {
    bodyRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (visible) focusFirstField();
  }, [visible, cloud?.view, cloud?.capabilities]);
  return (
    <Modal
      title={<CloudAccountHeading>{t(`settings.cloudAccount.${titleKey}`)}</CloudAccountHeading>}
      className={styles.modal}
      wrapClassName={styles.wrapper}
      visible={visible}
      onCancel={onClose}
      afterOpen={focusFirstField}
      footer={
        showSkip ? (
          <Button type='text' className={styles.skip} onClick={onClose}>
            {t('settings.cloudAccount.skipLogin')}
          </Button>
        ) : null
      }
      style={{ width: 410, maxWidth: 'calc(100vw - 32px)' }}
      unmountOnExit
      focusLock
      autoFocus={false}
      escToExit
    >
      <div ref={bodyRef} className={styles.body}>
        <CloudAccount variant='modal' />
      </div>
    </Modal>
  );
};

export default LoginModal;
