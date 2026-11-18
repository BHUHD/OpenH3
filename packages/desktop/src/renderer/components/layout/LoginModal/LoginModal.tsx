/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { User } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { CloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount';
import { useOptionalCloudAccount } from '@/renderer/components/settings/SettingsModal/CloudAccount/Provider';
import styles from './LoginModal.module.css';

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
      title={
        <div className={styles.heading}>
          <div className={styles.avatar} aria-hidden='true'>
            <User theme='outline' size={30} strokeWidth={3} fill='currentColor' />
          </div>
          <h2 className={styles.title}>{t(`settings.cloudAccount.${titleKey}`)}</h2>
        </div>
      }
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
      style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}
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
