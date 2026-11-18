import React, { useEffect, useId, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountRequest } from '@/common/types/platform/cloudAccount';
import { useCloudAccount } from './Provider';

export const AccountForm: React.FC = () => {
  const cloud = useCloudAccount();
  const { t } = useTranslation();
  const formId = useId();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Another host may initiate the shared operation. Its new authority epoch
  // clears every form's ephemeral inputs, including forms hidden by a modal.
  useEffect(() => {
    setPassword('');
    setConfirm('');
    setCode('');
  }, [cloud.run]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const policy = cloud.capabilities;
  const resetExpired = cloud.view === 'reset' && (!cloud.reset || cloud.reset.expires_at * 1000 <= now);
  useEffect(() => {
    if (resetExpired) {
      setPassword('');
      setConfirm('');
    }
  }, [resetExpired]);
  if (!policy) return null;
  const registration = cloud.view === 'register';
  const recovery = cloud.view === 'recovery';
  const reset = cloud.view === 'reset';
  const enabled =
    reset || recovery
      ? policy.password_reset_enabled
      : registration
        ? policy.registration_enabled
        : policy.password_login_enabled;
  const newPassword = registration || reset;
  const verifiedEmail = registration && policy.email_verification_required;
  const expired = reset && (!cloud.reset || cloud.reset.expires_at * 1000 <= now);
  const cooling = cloud.retryAt > now;
  const clearSecrets = () => {
    setPassword('');
    setConfirm('');
    setCode('');
  };
  const submit = () => {
    const length = Array.from(password).length;
    if (
      !enabled ||
      expired ||
      cooling ||
      cloud.busy ||
      (newPassword &&
        (password !== confirm ||
          !policy.password_min_length ||
          !policy.password_max_length ||
          length < policy.password_min_length ||
          length > policy.password_max_length)) ||
      (!recovery && !password) ||
      (registration && !acknowledged) ||
      ((recovery || verifiedEmail) && (!email.trim() || !code)) ||
      (!recovery && !reset && !username.trim())
    ) {
      setInvalid(true);
      return;
    }
    let request: CloudAccountRequest;
    if (reset && cloud.reset)
      request = {
        operation: 'passwordResetComplete',
        input: { challenge_id: cloud.reset.challenge_id, new_password: password },
      };
    else if (recovery) request = { operation: 'passwordReset', input: { email, code } };
    else if (registration)
      request = {
        operation: 'register',
        input: {
          username,
          password,
          email: verifiedEmail ? email : '',
          ...(verifiedEmail ? { verification_code: code } : {}),
        },
      };
    else request = { operation: 'login', input: { username, password } };
    clearSecrets();
    setInvalid(false);
    void cloud.run(request);
  };
  const field = (name: string, value: string, onChange: (value: string) => void, secret = false) => (
    <Form.Item label={<label htmlFor={`${formId}-${name}`}>{t(`settings.cloudAccount.${name}`)}</label>}>
      {secret ? (
        <Input.Password
          id={`${formId}-${name}`}
          value={value}
          onChange={onChange}
          autoComplete='off'
          disabled={cloud.busy}
          maxLength={512}
        />
      ) : (
        <Input
          id={`${formId}-${name}`}
          value={value}
          onChange={onChange}
          autoComplete='off'
          disabled={cloud.busy}
          maxLength={name === 'username' && registration ? 20 : 254}
        />
      )}
    </Form.Item>
  );
  return (
    <Form layout='vertical' onSubmit={submit} data-account-form>
      <div data-account-fields>
        {!enabled && <Alert type='warning' content={t('settings.cloudAccount.unsupported')} className='mb-16px' />}
        {expired && <Alert type='warning' content={t('settings.cloudAccount.expired')} className='mb-16px' />}
        {invalid && <Alert type='error' content={t('settings.cloudAccount.invalid')} className='mb-16px' />}
        {!recovery && !reset && field('username', username, setUsername)}
        {(recovery || verifiedEmail) && (
          <>
            {field('email', email, (value) => {
              setEmail(value);
              setCode('');
              clearSecrets();
            })}
            <Button
              size='small'
              className='mb-16px'
              disabled={!enabled || !email.trim() || cloud.busy || cooling}
              onClick={() => {
                clearSecrets();
                void cloud.run({
                  operation: 'emailCode',
                  input: { email, purpose: registration ? 'registration' : 'password_reset' },
                });
              }}
            >
              {t('settings.cloudAccount.sendCode')}
            </Button>
            {field('emailCode', code, setCode)}
          </>
        )}
        {!recovery && field('password', password, setPassword, true)}
        {cloud.view === 'login' && (
          <div data-account-recovery>
            <Button size='small' type='text' onClick={() => cloud.switchView('recovery')}>
              {t('settings.cloudAccount.recovery')}
            </Button>
          </div>
        )}
        {newPassword && (
          <>
            <div className='text-12px text-t-secondary mb-12px'>
              {t('settings.cloudAccount.passwordLimits', {
                min: policy.password_min_length,
                max: policy.password_max_length,
              })}
            </div>
            {field('confirmPassword', confirm, setConfirm, true)}
          </>
        )}
        {registration && (
          <>
            {!verifiedEmail && (
              <div data-account-registration-note>{t('settings.cloudAccount.registrationEmailNote')}</div>
            )}
            <Checkbox className='mb-16px' checked={acknowledged} onChange={setAcknowledged}>
              {t('settings.cloudAccount.acknowledgement')}
            </Checkbox>
          </>
        )}
      </div>
      <div data-account-actions>
        <Button htmlType='submit' type='primary' loading={cloud.busy} disabled={!enabled || expired || cooling}>
          {t(
            `settings.cloudAccount.${registration ? 'createAccount' : recovery ? 'verifyEmail' : reset ? 'savePassword' : 'login'}`
          )}
        </Button>
      </div>
    </Form>
  );
};
