import { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import { useStaticApi } from '@/hooks/use-api';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';
import { handleError } from '../../utils';

import styles from './index.module.scss';

function SetupWebAuthnModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { mutate: mutateMfaVerifications } = useCurrentUserMfa();
  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const onClose = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const handleSetupWebAuthn = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      // Check if WebAuthn is supported
      if (!navigator.credentials) {
        throw new Error('WebAuthn is not supported in this browser');
      }

      // For now, just show a placeholder message
      toast.success('Security key setup would be implemented here');
      void mutateMfaVerifications();
      onClose();
    } catch (error: unknown) {
      console.error('WebAuthn setup failed:', error);
      void handleError(error, async (_, message) => {
        setError(message);
        return true;
      });
    } finally {
      setIsLoading(false);
    }
  }, [mutateMfaVerifications, onClose]);

  return (
    <ExperienceLikeModal
      title="profile.set_up_mfa.title"
      onClose={onClose}
    >
      <div className={styles.content}>
        <div className={styles.description}>
          Use your security key or biometric authentication for enhanced security.
        </div>
        
        <div className={styles.instructions}>
          <div className={styles.instruction}>
            <div className={styles.step}>1</div>
            <div className={styles.text}>
              Click the "Setup" button to begin the WebAuthn registration process.
            </div>
          </div>
          <div className={styles.instruction}>
            <div className={styles.step}>2</div>
            <div className={styles.text}>
              Follow your browser's prompts to register your security key or biometric authentication.
            </div>
          </div>
          <div className={styles.instruction}>
            <div className={styles.step}>3</div>
            <div className={styles.text}>
              Once registered, you can use your security key for MFA when signing in.
            </div>
          </div>
        </div>

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        <div className={styles.footer}>
          <Button title={t('general.cancel')} onClick={onClose} />
          <Button
            type="primary"
            title="Setup"
            isLoading={isLoading}
            onClick={handleSetupWebAuthn}
          />
        </div>
      </div>
    </ExperienceLikeModal>
  );
}

export default SetupWebAuthnModal; 