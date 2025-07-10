import type { AdminConsoleKey } from '@logto/phrases';
import { MfaFactor } from '@logto/schemas';
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

  const handleSetupMfa = useCallback(
    (factor: MfaFactor) => {
      navigate(`setup-mfa/${factor.toLowerCase()}`);
    },
    [navigate]
  );

  const availableFactors = [
    {
      factor: MfaFactor.TOTP,
      name: t('profile.set_up_mfa.totp_name'),
      description: t('profile.set_up_mfa.totp_description'),
      isEnabled: !mfaVerifications?.some(v => v.type === MfaFactor.TOTP),
    },
    {
      factor: MfaFactor.WebAuthn,
      name: t('profile.set_up_mfa.webauthn_name'),
      description: t('profile.set_up_mfa.webauthn_description'),
      isEnabled: !mfaVerifications?.some(v => v.type === MfaFactor.WebAuthn),
    },
    {
      factor: MfaFactor.BackupCode,
      name: t('profile.set_up_mfa.backup_code_name'),
      description: t('profile.set_up_mfa.backup_code_description'),
      isEnabled: !mfaVerifications?.some(v => v.type === MfaFactor.BackupCode),
    },
  ];

  const hasCurrentFactors = Boolean(mfaVerifications?.length);

  // Handle loading and error states
  if (isLoading) {
    return (
      <FormCard title="profile.set_up_mfa.title">
        <div className={styles.mfaSection}>
          <CardContent
            title="profile.set_up_mfa.current_mfa_factors"
            data={[{
              key: 'loading',
              label: 'general.loading',
              value: true,
              renderer: () => <span>Loading...</span>,
              action: { name: 'general.loading' as const, handler: () => {} },
            }]}
          />
        </div>
      </FormCard>
    );
  }

  if (error) {
    return (
      <FormCard title="profile.set_up_mfa.title">
        <div className={styles.mfaSection}>
          <CardContent
            title="profile.set_up_mfa.current_mfa_factors"
            data={[{
              key: 'error',
              label: 'general.unknown_error',
              value: error?.body?.message ?? error?.message,
              renderer: (value: string) => <span className={styles.error}>{value}</span>,
              action: { name: 'general.retry' as const, handler: () => {} },
            }]}
          />
        </div>
      </FormCard>
    );
  }

  // Create data for current MFA factors using CardContent pattern
  const currentFactorsData = mfaVerifications?.map((verification) => ({
    key: verification.id,
    label: <MfaFactorName {...verification} />,
    value: verification.createdAt,
    renderer: (value: string) => (
      <div className={styles.factorItem}>
        {value && (
          <div className={styles.factorDate}>
            {t('profile.set_up_mfa.created_at', { 
              date: new Date(value).toLocaleDateString() 
            })}
          </div>
        )}
      </div>
    ),
    action: {
      name: 'profile.set_up_mfa.delete_factor' as const,
      handler: () => handleDelete(verification),
    },
  })) || [];

  // Create data for available MFA factors
  const availableFactorsData = availableFactors
    .filter(({ isEnabled }) => isEnabled)
    .map(({ factor, name, description }) => ({
      key: factor,
      label: name as AdminConsoleKey,
      value: description,
      renderer: (value: string) => (
        <div className={styles.factorDescription}>
          {value}
        </div>
      ),
      action: {
        name: 'profile.set' as const,
        handler: () => handleSetupMfa(factor),
      },
    }));

  return (
    <FormCard title="profile.set_up_mfa.title">
      <div className={styles.mfaSection}>
        {/* Current MFA Factors */}
        {hasCurrentFactors ? (
          <CardContent
            title="profile.set_up_mfa.current_mfa_factors"
            data={currentFactorsData}
          />
        ) : (
          <CardContent
            title="profile.set_up_mfa.current_mfa_factors"
            data={[{
              key: 'no-factors',
              label: 'profile.set_up_mfa.no_mfa_factors' as const,
              value: false,
              renderer: () => <NotSet />,
              action: { name: 'general.set_up' as const, handler: () => {} },
            }]}
          />
        )}

        {/* Available MFA Factors to Set Up */}
        {availableFactorsData.length > 0 && (
          <CardContent
            title="profile.set_up_mfa.available_mfa_factors"
            data={availableFactorsData}
          />
        )}
      </div>
    </FormCard>
  );
}

export default MfaSection; 