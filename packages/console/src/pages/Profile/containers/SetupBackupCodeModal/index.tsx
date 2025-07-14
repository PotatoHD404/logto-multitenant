import { MfaFactor } from '@logto/schemas';
import { useState, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import { useStaticApi } from '@/hooks/use-api';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';
import { handleError } from '../../utils';

import styles from './index.module.scss';

type BackupCodes = {
  type: 'BackupCode';
  codes: string[];
};

function SetupBackupCodeModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { show: showModal } = useConfirmModal();
  const { mutate: mutateMfa, mfaVerifications } = useCurrentUserMfa();
  const [backupCodes, setBackupCodes] = useState<BackupCodes | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [isConfirmed, setIsConfirmed] = useState(false);

  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  // Check if user has other MFA factors (TOTP or WebAuthn) configured
  const hasOtherMfaFactors =
    mfaVerifications?.some(
      (verification) =>
        verification.type === MfaFactor.TOTP || verification.type === MfaFactor.WebAuthn
    ) ?? false;

  // Generate backup codes on mount (only if user has other MFA factors)
  useEffect(() => {
    if (!hasOtherMfaFactors) {
      return;
    }

    const generateCodes = async () => {
      setIsLoading(true);
      try {
        const response = await api.post('me/mfa-verifications', {
          json: { type: MfaFactor.BackupCode },
        });
        const data = await response.json<BackupCodes>();
        setBackupCodes(data);
      } catch (error: unknown) {
        void handleError(error, async (_, message) => {
          setError(() => message);
          return true;
        });
      } finally {
        setIsLoading(false);
      }
    };

    void generateCodes();
  }, [api, hasOtherMfaFactors]);

  const onClose = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const handleCopyCodes = useCallback(async () => {
    if (!backupCodes) {
      return;
    }

    try {
      await navigator.clipboard.writeText(backupCodes.codes.join('\n'));
      toast.success(t('profile.set_up_mfa.backup_codes_copied'));
    } catch {
      toast.error(t('profile.set_up_mfa.copy_failed'));
    }
  }, [backupCodes, t]);

  const handleDownloadCodes = useCallback(() => {
    if (!backupCodes) {
      return;
    }

    const codesText = backupCodes.codes.join('\n');
    const blob = new Blob([codesText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'backup-codes.txt';
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(url);
    toast.success(t('profile.set_up_mfa.backup_codes_downloaded'));
  }, [backupCodes, t]);

  const handleFinish = useCallback(async () => {
    if (!isConfirmed) {
      return;
    }

    try {
      toast.success(t('profile.set_up_mfa.backup_codes_setup_success'));
      void mutateMfa();
      onClose();
    } catch (error: unknown) {
      void handleError(error, async (_, message) => {
        setError(() => message);
        return true;
      });
    }
  }, [isConfirmed, t, mutateMfa, onClose]);

  // If user doesn't have other MFA factors, show prerequisite message
  if (!hasOtherMfaFactors) {
    return (
      <ExperienceLikeModal title="profile.set_up_mfa.setup_backup_codes" onClose={onClose}>
        <div className={styles.container}>
          <div className={styles.prerequisiteMessage}>
            <div className={styles.prerequisiteTitle}>
              {t('profile.set_up_mfa.backup_codes_prerequisite_title')}
            </div>
            <div className={styles.prerequisiteText}>
              {t('profile.set_up_mfa.backup_codes_prerequisite_text')}
            </div>
          </div>

          <div className={styles.prerequisiteActions}>
            <Button
              type="primary"
              size="large"
              title="profile.set_up_mfa.setup_totp"
              onClick={() => {
                navigate('setup-mfa/totp');
              }}
            />
            <Button
              type="outline"
              size="large"
              title="profile.set_up_mfa.setup_webauthn"
              onClick={() => {
                navigate('setup-mfa/webauthn');
              }}
            />
          </div>
        </div>
      </ExperienceLikeModal>
    );
  }

  if (isLoading) {
    return (
      <ExperienceLikeModal title="profile.set_up_mfa.setup_backup_codes" onClose={onClose}>
        <div className={styles.loading}>{t('general.loading')}</div>
      </ExperienceLikeModal>
    );
  }

  if (error && !backupCodes) {
    return (
      <ExperienceLikeModal title="profile.set_up_mfa.setup_backup_codes" onClose={onClose}>
        <div className={styles.error}>{error}</div>
        <Button
          type="primary"
          size="large"
          title="general.retry"
          onClick={() => {
            window.location.reload();
          }}
        />
      </ExperienceLikeModal>
    );
  }

  return (
    <ExperienceLikeModal
      title="profile.set_up_mfa.setup_backup_codes"
      subtitle="profile.set_up_mfa.setup_backup_codes_subtitle"
      onClose={onClose}
    >
      <div className={styles.container}>
        <div className={styles.description}>{t('profile.set_up_mfa.backup_codes_description')}</div>

        {backupCodes && (
          <div className={styles.codesContainer}>
            <div className={styles.codesHeader}>
              <div className={styles.codesTitle}>{t('profile.set_up_mfa.your_backup_codes')}</div>
              <div className={styles.codesCount}>
                {t('profile.set_up_mfa.backup_codes_count', { count: backupCodes.codes.length })}
              </div>
            </div>

            <div className={styles.codesList}>
              {backupCodes.codes.map((code, index) => (
                <div key={`backup-code-${code}-${index}`} className={styles.codeItem}>
                  <span className={styles.codeNumber}>{index + 1}.</span>
                  <span className={styles.codeValue}>{code}</span>
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <Button
                type="outline"
                size="large"
                title="profile.set_up_mfa.copy_codes"
                onClick={handleCopyCodes}
              />
              <Button
                type="outline"
                size="large"
                title="profile.set_up_mfa.download_codes"
                onClick={handleDownloadCodes}
              />
            </div>
          </div>
        )}

        <div className={styles.warning}>
          <div className={styles.warningTitle}>
            {t('profile.set_up_mfa.backup_codes_warning_title')}
          </div>
          <div className={styles.warningText}>
            {t('profile.set_up_mfa.backup_codes_warning_text')}
          </div>
        </div>

        <div className={styles.confirmation}>
          <label className={styles.confirmationLabel}>
            <input
              type="checkbox"
              checked={isConfirmed}
              onChange={(event) => {
                setIsConfirmed(() => event.target.checked);
              }}
            />
            {t('profile.set_up_mfa.confirm_backup_codes_saved')}
          </label>
        </div>

        <Button
          type="primary"
          size="large"
          title="general.done"
          disabled={!isConfirmed}
          onClick={handleFinish}
        />
      </div>
    </ExperienceLikeModal>
  );
}

export default SetupBackupCodeModal;
