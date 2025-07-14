import { useLogto } from '@logto/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import ModalLayout from '@/ds-components/ModalLayout';
import { useStaticApi } from '@/hooks/use-api';
import useRedirectUri from '@/hooks/use-redirect-uri';

import styles from '../../index.module.scss';

type Props = {
  readonly onClose: () => void;
};

export default function OssDeleteAccountModal({ onClose }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console.profile.delete_account' });
  const { signOut } = useLogto();
  const postSignOutRedirectUri = useRedirectUri('signOut');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFinalConfirmation, setShowFinalConfirmation] = useState(false);
  const [deletionError, setDeletionError] = useState<string>();

  const api = useStaticApi({ prefixUrl: adminTenantEndpoint, resourceIndicator: meApi.indicator });

  const handleDeleteAccount = async () => {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);
    setDeletionError(undefined);

    try {
      await api.delete('me');
      // Account deleted successfully, sign out the user
      await signOut(postSignOutRedirectUri.href);
    } catch (error) {
      console.error('Error deleting account:', error);
      setDeletionError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsDeleting(false);
    }
  };

  if (deletionError) {
    return (
      <ModalLayout
        title="profile.delete_account.error_occurred"
        footer={<Button size="large" title="general.got_it" onClick={onClose} />}
      >
        <div className={styles.container}>
          <p>{t('error_occurred_description')}</p>
          <p>
            <code>{deletionError}</code>
          </p>
          <p>{t('try_again_later')}</p>
        </div>
      </ModalLayout>
    );
  }

  if (showFinalConfirmation) {
    return (
      <ModalLayout
        title="profile.delete_account.final_confirmation"
        footer={
          <>
            <Button
              size="large"
              disabled={isDeleting}
              title="general.cancel"
              onClick={() => {
                setShowFinalConfirmation(false);
              }}
            />
            <Button
              size="large"
              disabled={isDeleting}
              isLoading={isDeleting}
              type="danger"
              title="profile.delete_account.permanently_delete"
              onClick={handleDeleteAccount}
            />
          </>
        }
      >
        <div className={styles.container}>
          <p>{t('about_to_start_deletion')}</p>
          <p>
            This action will permanently delete your account and all associated data. This cannot be
            undone.
          </p>
        </div>
      </ModalLayout>
    );
  }

  return (
    <ModalLayout
      title="profile.delete_account.label"
      footer={
        <>
          <Button size="large" title="general.cancel" onClick={onClose} />
          <Button
            size="large"
            type="danger"
            title="general.delete"
            onClick={() => {
              setShowFinalConfirmation(true);
            }}
          />
        </>
      }
    >
      <div className={styles.container}>
        <p>{t('description')}</p>
        <p>
          <strong>Warning:</strong> This action cannot be undone. All your data will be permanently
          deleted.
        </p>
        <p>Please confirm that you want to proceed with deleting your account.</p>
      </div>
    </ModalLayout>
  );
}
