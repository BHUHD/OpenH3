import React, { useEffect, useId, useState } from 'react';
import { Alert, Button, Form, Input, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CloudAccountRequest, CloudVerification } from '@/common/types/platform/cloudAccount';

/** Purpose is supplied by the initiating operation, never editable by the user. */
export const ProofForm: React.FC<{
  challenge: CloudVerification;
  purpose: CloudVerification['purpose'];
  busy: boolean;
  retryAt?: number;
  onVerify: (request: CloudAccountRequest) => Promise<void>;
  onCancel: () => void;
}> = ({ challenge, purpose, busy, retryAt = 0, onVerify, onCancel }) => {
  const { t } = useTranslation();
  const formId = useId();
  const [method, setMethod] = useState<CloudVerification['methods'][number]>(challenge.methods[0]);
  const [proof, setProof] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setProof('');
  }, [onVerify]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = challenge.expires_at * 1000 <= now;
  const cooling = retryAt > now;
  const valid = purpose === challenge.purpose && challenge.methods.includes(method) && !expired;
  useEffect(() => {
    if (!valid) setProof('');
  }, [valid]);
  return (
    <Form
      layout='vertical'
      onSubmit={() => {
        if (!valid || !proof || busy || cooling) return;
        const input =
          method === 'password'
            ? { challenge_id: challenge.challenge_id, method, password: proof }
            : { challenge_id: challenge.challenge_id, method, code: proof };
        setProof('');
        void onVerify({ operation: 'verify', input });
      }}
    >
      <Alert
        type={valid ? 'info' : 'warning'}
        content={t(
          `settings.cloudAccount.${expired ? 'expired' : purpose === challenge.purpose ? purpose : 'unsupported'}`
        )}
        className='mb-16px'
      />
      <Form.Item label={<label htmlFor={`${formId}-method`}>{t('settings.cloudAccount.method')}</label>}>
        <Select
          id={`${formId}-method`}
          value={method}
          onChange={(value) => {
            setMethod(value);
            setProof('');
          }}
          options={challenge.methods.map((value) => ({ value, label: t(`settings.cloudAccount.${value}`) }))}
        />
      </Form.Item>
      <Form.Item
        label={
          <label htmlFor={`${formId}-proof`}>
            {t(method === 'password' ? 'settings.cloudAccount.password' : 'settings.cloudAccount.proofCode')}
          </label>
        }
      >
        <Input.Password
          id={`${formId}-proof`}
          autoComplete='off'
          value={proof}
          onChange={setProof}
          disabled={!valid || busy}
          maxLength={method === 'password' ? 512 : 64}
        />
      </Form.Item>
      <div className='flex gap-8px'>
        <Button htmlType='submit' type='primary' disabled={!valid || !proof || busy || cooling}>
          {t('settings.cloudAccount.verify')}
        </Button>
        <Button onClick={onCancel}>{t('settings.cloudAccount.cancel')}</Button>
      </div>
    </Form>
  );
};
