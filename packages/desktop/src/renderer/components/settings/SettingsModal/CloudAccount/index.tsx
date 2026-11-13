import React, { useEffect, useState } from 'react';
import { Alert, Button, Spin, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useCloudAccount } from './Provider';
import { AccountForm } from './AccountForm';
import { ProofForm } from './ProofForm';
import { ConnectedPanels } from './Panels';

export const CloudAccount: React.FC<{ variant?: 'page' | 'modal' }> = ({ variant = 'page' }) => {
  const cloud = useCloudAccount();
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => cloud.cancel, [cloud.cancel]);
  const session = cloud.session;
  const unavailable = session?.state === 'disabled' || session?.state === 'unconfigured';
  const error =
    cloud.error === 'CLOUD_RATE_LIMITED'
      ? 'rateLimited'
      : cloud.error === 'CLOUD_POLICY'
        ? 'unsupported'
        : cloud.error === 'CLOUD_VERIFICATION_FAILED'
          ? 'verificationFailed'
          : 'requestFailed';
  return (
    <section className='w-full max-w-720px text-t-primary' aria-label={t('settings.cloudAccount.title')}>
      {variant === 'page' && (
        <Typography.Title heading={5} className='!mt-0'>
          {t('settings.cloudAccount.title')}
        </Typography.Title>
      )}
      {cloud.registered && <Alert type='success' content={t('settings.cloudAccount.registered')} className='mb-16px' />}
      {cloud.notice && (
        <Alert
          type={cloud.notice === 'catalogFailed' || cloud.notice === 'logoutUnconfirmed' ? 'warning' : 'info'}
          content={t(`settings.cloudAccount.${cloud.notice}`)}
          className='mb-16px'
        />
      )}
      {cloud.error && <Alert type='error' content={t(`settings.cloudAccount.${error}`)} className='mb-16px' />}
      {cloud.retryAt > now && (
        <div role='status' className='mb-16px text-t-secondary'>
          {t('settings.cloudAccount.retryAfter', { seconds: Math.ceil((cloud.retryAt - now) / 1000) })}
        </div>
      )}
      {!cloud.available ? (
        <Alert content={t('settings.cloudAccount.localOwnerPending')} />
      ) : unavailable ? (
        <Alert content={t(`settings.cloudAccount.${session.state}`)} />
      ) : session?.state === 'connected' ? (
        <>
          <Typography.Paragraph>{session.account.display_name || session.account.username}</Typography.Paragraph>
          {variant === 'modal' ? (
            <div role='status' className='text-t-secondary'>
              {t('settings.cloudAccount.signingIn')}
            </div>
          ) : (
            <>
              {session.account.email && <Typography.Paragraph>{session.account.email}</Typography.Paragraph>}
              <ConnectedPanels />
              <Button
                onClick={() => {
                  void cloud.run({ operation: 'logout' });
                }}
                loading={cloud.busy}
              >
                {t('settings.cloudAccount.logout')}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          {session?.state === 'reauth_required' && (
            <Alert type='warning' content={t('settings.cloudAccount.reauthRequired')} className='mb-16px' />
          )}
          {cloud.capabilities?.anti_bot === 'unsupported_required' && (
            <Alert type='warning' content={t('settings.cloudAccount.antiBotRequired')} className='mb-16px' />
          )}
          {cloud.capabilities ? (
            <>
              <div className='flex flex-wrap gap-8px mb-16px'>
                {cloud.view !== 'login' && (
                  <Button size='small' type='text' onClick={() => cloud.switchView('login')}>
                    {t('settings.cloudAccount.login')}
                  </Button>
                )}
                {!cloud.registered && cloud.view !== 'register' && (
                  <Button size='small' type='text' onClick={() => cloud.switchView('register')}>
                    {t('settings.cloudAccount.register')}
                  </Button>
                )}
                <Button size='small' type='text' onClick={() => cloud.switchView('recovery')}>
                  {t('settings.cloudAccount.recovery')}
                </Button>
              </div>
              {cloud.view === 'proof' && cloud.challenge ? (
                <ProofForm
                  key={`${cloud.revision}:${cloud.challenge.challenge_id}`}
                  challenge={cloud.challenge}
                  purpose={cloud.proofPurpose ?? 'login'}
                  busy={cloud.busy}
                  retryAt={cloud.retryAt}
                  onVerify={cloud.run}
                  onCancel={cloud.cancel}
                />
              ) : (
                <AccountForm key={cloud.revision} hideCancel={variant === 'modal'} />
              )}
            </>
          ) : (
            <Spin />
          )}
        </>
      )}
      {variant === 'page' && (
        <Button className='mt-16px' size='small' type='text' onClick={cloud.reload}>
          {t('settings.cloudAccount.refresh')}
        </Button>
      )}
    </section>
  );
};
export default CloudAccount;
