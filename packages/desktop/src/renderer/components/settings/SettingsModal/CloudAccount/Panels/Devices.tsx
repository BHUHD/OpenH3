import React from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountData } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from '../Provider';
import { ProofForm } from '../ProofForm';
import { Field, Panel, ReadState, useSafeLabel } from './Wallet';
import { useCloudRead } from './useCloudRead';
type Devices = Extract<NonNullable<CloudAccountData>, { items: { current: boolean }[] }>;
const isDevices = (data: CloudAccountData): data is Devices =>
  !!data && 'items' in data && Array.isArray(data.items) && data.items.every((item) => 'current' in item);
export function DevicesPanel() {
  const cloud = useCloudAccount();
  const devices = useCloudRead({ operation: 'devices' }, isDevices);
  const { t } = useTranslation();
  const label = useSafeLabel();
  const target = cloud.deviceTarget;
  return (
    <Panel title='devices'>
      <ReadState loading={devices.loading} failed={devices.failed} hasData={!!devices.data} />
      {devices.data?.items.map((device) => (
        <div key={device.id} className='bg-fill-1 rd-4px p-8px flex flex-col gap-4px'>
          <span>{device.label}</span>
          <Field name='deviceId'>{device.id}</Field>
          <Field name='deviceKind'>
            {t(`settings.cloudAccount.${device.current ? 'currentDevice' : 'otherDevice'}`)}
          </Field>
          <Field name='status'>{label(device.status)}</Field>
          <Field name='createdAt'>{String(device.created_at)}</Field>
          <Field name='lastActiveAt'>{String(device.last_active_at)}</Field>
          <Field name='expiresAt'>{String(device.expires_at)}</Field>
          <Button
            size='small'
            status='danger'
            disabled={device.status !== 'active' || cloud.busy}
            aria-label={`${t('settings.cloudAccount.revoke')} ${device.label}`}
            onClick={() => cloud.chooseDevice(device)}
          >
            {t('settings.cloudAccount.revoke')}
          </Button>
        </div>
      ))}
      <Button size='small' onClick={devices.refresh}>
        {t('settings.cloudAccount.refreshDevices')}
      </Button>
      <Modal
        visible={!!target}
        title={t('settings.cloudAccount.revoke')}
        footer={null}
        onCancel={cloud.cancel}
        unmountOnExit
      >
        {target && (
          <>
            <div className='mb-16px [overflow-wrap:anywhere]'>
              {target.label} · {target.id}
            </div>
            {cloud.challenge && cloud.proofPurpose === 'device_revocation' ? (
              <ProofForm
                key={`${cloud.scope}:${cloud.challenge.challenge_id}`}
                challenge={cloud.challenge}
                purpose='device_revocation'
                busy={cloud.busy}
                retryAt={cloud.retryAt}
                onVerify={cloud.run}
                onCancel={cloud.cancel}
              />
            ) : (
              <div className='flex gap-8px'>
                <Button
                  status='danger'
                  loading={cloud.busy}
                  onClick={() => {
                    void cloud.run({ operation: 'revokeDevice', input: { device_id: target.id } });
                  }}
                >
                  {t('settings.cloudAccount.confirmRevoke')}
                </Button>
                <Button onClick={cloud.cancel}>{t('settings.cloudAccount.cancel')}</Button>
              </div>
            )}
          </>
        )}
      </Modal>
    </Panel>
  );
}
