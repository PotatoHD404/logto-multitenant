import { MfaFactor } from '@logto/schemas';
import { useState, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import VerificationCodeInput from '@/components/VerificationCodeInput';
import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import FormField from '@/ds-components/FormField';
import TextLink from '@/ds-components/TextLink';
import { useStaticApi } from '@/hooks/use-api';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';
import { handleError } from '../../utils';

import styles from './index.module.scss';

type FormFields = {
  code: string[];
};

type TotpSecret = {
  secret: string;
  secretQrCode: string;
};

// TOTP validation helper (basic format check)
const validateTotpCode = (code: string): boolean => {
  return code.length === 6 && /^\d{6}$/.test(code);
};

function SetupTotpModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { show: showModal } = useConfirmModal();
  const { mutate: mutateMfa } = useCurrentUserMfa();
  const [totpSecret, setTotpSecret] = useState<TotpSecret | undefined>(null);
  const [isShowingSecret, setIsShowingSecret] = useState(true);
  const [isQrCodeFormat, setIsQrCodeFormat] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const {
    watch,
    setValue,
    formState: { isSubmitting },
  } = useForm<FormFields>({
    defaultValues: { code: [] },
  });

  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  const code = watch('code');

  // Get TOTP secret from backend API on mount
  useEffect(() => {
    const generateSecret = async () => {
      setIsLoading(true);
      try {
        const response = await api.post('me/mfa-verifications', {
          json: { type: MfaFactor.TOTP },
        });

        const data = await response.json<{
          type: 'TOTP';
          secret: string;
          secretQrCode: string;
        }>();

        setTotpSecret({
          secret: data.secret,
          secretQrCode: data.secretQrCode,
        });
      } catch (error: unknown) {
        void handleError(error, async (_, message) => {
          setError(message);
          return true;
        });
      } finally {
        setIsLoading(false);
      }
    };

    void generateSecret();
  }, [api]);

  const onClose = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const handleContinue = useCallback(async () => {
    if (!totpSecret) {
      return;
    }

    setIsShowingSecret(false);
  }, [totpSecret]);

  const handleSubmit = useCallback(async () => {
    if (!totpSecret || code.length !== 6 || code.some((c) => !c)) {
      setError(t('profile.set_up_mfa.invalid_code'));
      return;
    }

    const totpCode = code.join('');

    // Basic validation
    if (!validateTotpCode(totpCode)) {
      setError(t('profile.set_up_mfa.invalid_code'));
      return;
    }

    // Verify code and save to database
    try {
      await api.post('me/mfa-verifications', {
        json: {
          type: MfaFactor.TOTP,
          secret: totpSecret.secret,
          code: totpCode,
        },
      });

      toast.success(t('profile.set_up_mfa.totp_setup_success'));
      void mutateMfa();
      onClose();
    } catch (error: unknown) {
      void handleError(error, async (_, message) => {
        setError(message);
        return true;
      });
    }
  }, [api, code, totpSecret, t, mutateMfa, onClose]);

  const handleCodeChange = useCallback(
    (newCode: string[]) => {
      setValue('code', newCode);
      setError(undefined);

      // Remove auto-submit - let user manually submit with Continue button
    },
    [setValue]
  );

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t('profile.set_up_mfa.secret_copied'));
      } catch {
        toast.error(t('profile.set_up_mfa.copy_failed'));
      }
    },
    [t]
  );

  if (isLoading) {
    return (
      <ExperienceLikeModal title="profile.set_up_mfa.setup_totp" onClose={onClose}>
        <div className={styles.loading}>{t('general.loading')}</div>
      </ExperienceLikeModal>
    );
  }

  if (error && !totpSecret) {
    return (
      <ExperienceLikeModal title="profile.set_up_mfa.setup_totp" onClose={onClose}>
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

  if (isShowingSecret && totpSecret) {
    return (
      <ExperienceLikeModal
        title="profile.set_up_mfa.setup_totp"
        subtitle="profile.set_up_mfa.totp_description"
        onClose={onClose}
      >
        <div className={styles.container}>
          <div className={styles.step}>
            <div className={styles.stepTitle}>
              {t('profile.set_up_mfa.step', {
                step: 1,
                content: isQrCodeFormat
                  ? t('profile.set_up_mfa.scan_qr_code')
                  : t('profile.set_up_mfa.copy_secret'),
              })}
            </div>
            <div className={styles.stepDescription}>
              {t(
                isQrCodeFormat
                  ? 'profile.set_up_mfa.scan_qr_code_description'
                  : 'profile.set_up_mfa.copy_secret_description'
              )}
            </div>
          </div>

          <div className={styles.secretContent}>
            {isQrCodeFormat && totpSecret.secretQrCode && (
              <div className={styles.qrCode}>
                <img src={totpSecret.secretQrCode} alt="QR code" />
              </div>
            )}
            {!isQrCodeFormat && (
              <div className={styles.rawSecret}>
                <div className={styles.secretText}>{totpSecret.secret}</div>
                <Button
                  type="outline"
                  size="small"
                  title="general.copy"
                  onClick={async () => copyToClipboard(totpSecret.secret)}
                />
              </div>
            )}
            <TextLink
              onClick={() => {
                setIsQrCodeFormat(!isQrCodeFormat);
              }}
            >
              {isQrCodeFormat
                ? t('profile.set_up_mfa.cannot_scan_qr_code')
                : t('profile.set_up_mfa.want_to_scan_qr_code')}
            </TextLink>
          </div>

          <Button type="primary" size="large" title="general.continue" onClick={handleContinue} />
        </div>
      </ExperienceLikeModal>
    );
  }

  return (
    <ExperienceLikeModal
      title="profile.set_up_mfa.setup_totp"
      subtitle="profile.set_up_mfa.verify_totp_subtitle"
      onClose={onClose}
    >
      <div className={styles.container}>
        <div className={styles.step}>
          <div className={styles.stepTitle}>
            {t('profile.set_up_mfa.step', {
              step: 2,
              content: t('profile.set_up_mfa.enter_verification_code'),
            })}
          </div>
          <div className={styles.stepDescription}>
            {t('profile.set_up_mfa.enter_totp_code_description')}
          </div>
        </div>

        <FormField title="profile.set_up_mfa.enter_verification_code">
          <VerificationCodeInput
            name="totpCode"
            value={code}
            error={error}
            onChange={handleCodeChange}
          />
        </FormField>

        <Button
          type="primary"
          size="large"
          title="general.continue"
          isLoading={isSubmitting}
          disabled={code.length !== 6 || code.some((c) => !c)}
          onClick={handleSubmit}
        />
      </div>
    </ExperienceLikeModal>
  );
}

export default SetupTotpModal;
