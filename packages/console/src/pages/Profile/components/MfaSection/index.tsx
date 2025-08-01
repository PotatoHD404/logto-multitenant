import { MfaFactor } from '@logto/schemas';
import type { AdminConsoleKey } from '@logto/phrases';
import { useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import FormCard from '@/components/FormCard';
import MfaFactorName from '@/components/MfaFactorName';
import Button from '@/ds-components/Button';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import CardContent from '../CardContent';
import NotSet from '../NotSet';
import styles from './index.module.scss';

function MfaSection() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { mfaVerifications, error, isLoading, deleteMfaVerification } = useCurrentUserMfa();
  const { show: showConfirm } = useConfirmModal();

  const handleDelete = useCallback(
    async (mfaVerification: { id: string; type: MfaFactor; name?: string; agent?: string }) => {
      const [result] = await showConfirm({
        ModalContent: () => (
          <Trans
            t={t}
            i18nKey="profile.set_up_mfa.delete_factor_description"
            components={{
              name: <MfaFactorName {...mfaVerification} />,
            }}
          />
        ),
        confirmButtonText: 'profile.set_up_mfa.delete_factor_confirm',
      });

      if (!result) {
        return;
      }

      await deleteMfaVerification(mfaVerification.id);
    },
    [deleteMfaVerification, showConfirm, t]
  );

  const handleSetupMfa = useCallback((factor: MfaFactor) => {
    navigate(`setup-mfa/${factor.toLowerCase()}`);
  }, [navigate]);

  if (isLoading) {
    return (
      <FormCard title="profile.set_up_mfa.title">
        <div className={styles.loading}>
          {t('general.loading')}
        </div>
      </FormCard>
    );
  }

  if (error) {
    return (
      <FormCard title="profile.set_up_mfa.title">
        <div className={styles.error}>
          {error?.body?.message ?? error?.message ?? t('general.unknown_error')}
        </div>
      </FormCard>
    );
  }

  // All available MFA factors
  const allFactors = [
    { type: MfaFactor.TOTP },
    { type: MfaFactor.WebAuthn },
    { type: MfaFactor.BackupCode },
  ];

  // Create unified data for all MFA factors
  const mfaFactorsData = allFactors.map((factor) => {
    const existingVerification = mfaVerifications?.find(v => v.type === factor.type);
    const isConfigured = Boolean(existingVerification);

    return {
      key: factor.type,
      label: (factor.type === MfaFactor.TOTP 
        ? 'profile.set_up_mfa.totp_name' 
        : factor.type === MfaFactor.WebAuthn 
          ? 'profile.set_up_mfa.webauthn_name'
          : 'profile.set_up_mfa.backup_code_name') as AdminConsoleKey,
      value: existingVerification?.createdAt || null,
      renderer: (value: string | null) => {
        if (value) {
          return (
            <div className={styles.factorStatus}>
              <div className={styles.statusBadge}>
                {t('profile.set_up_mfa.configured')}
              </div>
              <div className={styles.factorDate}>
                {`${t('profile.set_up_mfa.created_at').replace('{{time}}', new Date(value).toLocaleDateString())}`}
              </div>
            </div>
          );
        }
        return <NotSet />;
      },
      action: isConfigured && existingVerification
        ? {
            name: 'general.delete' as any,
            handler: async () => handleDelete(existingVerification),
          }
        : {
            name: 'profile.set_up_mfa.setup' as any,
            handler: async () => handleSetupMfa(factor.type),
          },
    };
  });

  return (
    <FormCard title="profile.set_up_mfa.title">
      <CardContent
        title="profile.set_up_mfa.mfa_factors"
        data={mfaFactorsData}
      />
    </FormCard>
  );
}

export default MfaSection; 