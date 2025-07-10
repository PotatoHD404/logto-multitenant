import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import TextInput from '@/ds-components/TextInput';
import useCurrentUser from '@/hooks/use-current-user';
import { useStaticApi } from '@/hooks/use-api';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';

type TotpSecret = {
  secret: string;
  secretQrCode: string;
};

function SetupTotpModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { user } = useCurrentUser();
  const { mutate } = useCurrentUserMfa();
  const [totpSecret, setTotpSecret] = useState<TotpSecret>();
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  const onClose = () => {
    navigate('/profile');
  };

  const generateSecret = async () => {
    if (!user?.id) {
      toast.error('User not found');
      return;
    }
    
    setIsLoading(true);
    try {
      // Use the existing account API endpoint
      const result = await api.post('my-account/mfa-verifications/totp-secret/generate')
        .json<TotpSecret>();
      setTotpSecret(result);
    } catch (error: unknown) {
      console.error('Failed to generate TOTP secret:', error);
      toast.error('Failed to generate TOTP secret');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyAndBind = async () => {
    if (!totpSecret || !verificationCode || !user?.id) {
      return;
    }

    setIsLoading(true);
    try {
      // Use the existing account API endpoint to bind the TOTP
      await api.post('my-account/mfa-verifications', {
        json: { 
          type: 'Totp',
          secret: totpSecret.secret
        }
      });
      
      toast.success('TOTP authentication setup successfully');
      void mutate(); // Refresh MFA verifications
      onClose();
    } catch (error: unknown) {
      console.error('Failed to setup TOTP:', error);
      toast.error('Failed to setup TOTP authentication');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ExperienceLikeModal
      title="general.set_up"
      subtitle="general.continue"
      onClose={onClose}
    >
      {!totpSecret ? (
        <div>
          <p>Click to generate a new TOTP secret:</p>
          <Button
            title="general.continue"
            type="primary"
            isLoading={isLoading}
            onClick={generateSecret}
          />
        </div>
      ) : (
        <div>
          {totpSecret.secretQrCode && (
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <img src={totpSecret.secretQrCode} alt="TOTP QR Code" />
            </div>
          )}
          <p>Secret: {totpSecret.secret}</p>
          <p>Enter the verification code from your authenticator app:</p>
          <TextInput
            value={verificationCode}
            placeholder="000000"
            onChange={(event) => {
              setVerificationCode((event.target as HTMLInputElement).value);
            }}
          />
          <div style={{ marginTop: '16px' }}>
            <Button
              title="general.save"
              type="primary"
              isLoading={isLoading}
              onClick={verifyAndBind}
            />
          </div>
        </div>
      )}
    </ExperienceLikeModal>
  );
}

export default SetupTotpModal; 