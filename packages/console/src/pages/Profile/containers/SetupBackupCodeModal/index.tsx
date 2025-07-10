import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import { useStaticApi } from '@/hooks/use-api';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';

function SetupBackupCodeModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { mutate } = useCurrentUserMfa();
  const [isLoading, setIsLoading] = useState(false);
  
  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  const onClose = () => {
    navigate('/profile');
  };

  const setupBackupCode = async () => {
    setIsLoading(true);
    try {
      // This would call the backup code setup API
      toast.success('Backup codes setup initiated (not implemented yet)');
      void mutate(); // Refresh MFA verifications
      onClose();
    } catch (error: unknown) {
      console.error('Failed to setup backup codes:', error);
      toast.error('Failed to setup backup codes');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ExperienceLikeModal
      title="mfa.backup_code"
      onClose={onClose}
    >
      <div>Set up backup codes that can be used when your other MFA methods are unavailable.</div>
      <Button
        type="primary"
        size="large"
        title={t('general.setup')}
        isLoading={isLoading}
        onClick={setupBackupCode}
      />
    </ExperienceLikeModal>
  );
}

export default SetupBackupCodeModal; 