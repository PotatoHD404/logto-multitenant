import { ReservedPlanId, type TenantTag } from '@logto/schemas';
import classNames from 'classnames';
import { useContext, useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { isCloud } from '@/consts/env';
import PageMeta from '@/components/PageMeta';
import SubmitFormChangesActionBar from '@/components/SubmitFormChangesActionBar';
import UnsavedChangesAlertModal from '@/components/UnsavedChangesAlertModal';
import { TenantsContext } from '@/contexts/TenantsProvider';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useApi, { useCrossTenantApi } from '@/hooks/use-api';
import { trySubmitSafe } from '@/utils/form';

import DeleteCard from './DeleteCard';
import DeleteModal from './DeleteModal';
import LeaveCard from './LeaveCard';
import ProfileForm from './ProfileForm';
import styles from './index.module.scss';
import { type TenantSettingsForm } from './types.js';

// Type for local API tenant response
type LocalTenantResponse = {
  id: string;
  name: string;
  tag: TenantTag;
  createdAt: string;
  isSuspended?: boolean;
};

function TenantBasicSettings() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const {
    access: { canManageTenant },
  } = useCurrentTenantScopes();
  const cloudApi = useCloudApi();
  const crossTenantApi = useCrossTenantApi();
  const {
    currentTenant,
    currentTenantId,
    isDevTenant,
    updateTenant,
    removeTenant,
    navigateTenant,
  } = useContext(TenantsContext);
  const [isDeletionModalOpen, setIsDeletionModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { show: showModal } = useConfirmModal();

  const methods = useForm<TenantSettingsForm>({
    defaultValues: { profile: currentTenant },
  });
  const {
    watch,
    reset,
    handleSubmit,
    formState: { isDirty, isSubmitting },
  } = methods;

  useEffect(() => {
    reset({ profile: currentTenant });
  }, [currentTenant, reset]);

  const saveData = async (data: { name?: string; tag?: TenantTag }) => {
    if (isCloud) {
      const { name, tag } = await cloudApi.patch(`/api/tenants/:tenantId`, {
        params: { tenantId: currentTenantId },
        body: data,
      });
      reset({ profile: { name, tag } });
      updateTenant(currentTenantId, data);
          } else {
        // For local OSS, use the cross-tenant API
        const updatedTenant = await crossTenantApi.patch(`tenants/${currentTenantId}`, { json: data }).json<LocalTenantResponse>();
        reset({ profile: { name: updatedTenant.name, tag: updatedTenant.tag } });
        updateTenant(currentTenantId, { name: updatedTenant.name, tag: updatedTenant.tag });
      }
    toast.success(t('tenants.settings.tenant_info_saved'));
  };

  const onSubmit = handleSubmit(
    trySubmitSafe(async (formData: TenantSettingsForm) => {
      if (isSubmitting) {
        return;
      }

      const {
        profile: { name, tag },
      } = formData;
      await saveData({ name, tag });
    })
  );

  const onClickDeletionButton = async () => {
    // Protect system tenants from deletion
    if (currentTenantId === 'default' || currentTenantId === 'admin') {
      await showModal({
        title: 'tenants.deletion.delete_modal.cannot_delete_title',
        ModalContent: t('tenants.deletion.delete_modal.cannot_delete_system'),
        type: 'alert',
        cancelButtonText: 'general.got_it',
      });
      return;
    }

    if (
      !isDevTenant &&
      (currentTenant?.subscription.planId !== ReservedPlanId.Free ||
        currentTenant.openInvoices.length > 0)
    ) {
      await showModal({
        title: 'tenants.deletion.delete_modal.cannot_delete_title',
        ModalContent: t('tenants.deletion.delete_modal.cannot_delete_description'),
        type: 'alert',
        cancelButtonText: 'general.got_it',
      });

      return;
    }

    setIsDeletionModalOpen(true);
  };

  const onDelete = async () => {
    if (isDeleting) {
      return;
    }

    // Double-check system tenant protection
    if (currentTenantId === 'default' || currentTenantId === 'admin') {
      await showModal({
        title: 'tenants.deletion.delete_modal.cannot_delete_title',
        ModalContent: t('tenants.deletion.delete_modal.cannot_delete_system'),
        type: 'alert',
        cancelButtonText: 'general.got_it',
      });
      setIsDeletionModalOpen(false);
      return;
    }

    setIsDeleting(true);
    try {
      if (isCloud) {
        await cloudApi.delete(`/api/tenants/:tenantId`, { params: { tenantId: currentTenantId } });
      } else {
        // For local OSS, use the cross-tenant API for deletion
        await crossTenantApi.delete(`tenants/${currentTenantId}`);
      }
      setIsDeletionModalOpen(false);
      removeTenant(currentTenantId);
      navigateTenant('');
    } catch (error) {
      console.error('Error deleting tenant:', error);
      toast.error(t('tenants.deletion.delete_modal.delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <PageMeta titleKey={['tenants.tabs.settings', 'tenants.title']} />
      <form className={classNames(styles.container, isDirty && styles.withSubmitActionBar)}>
        <FormProvider {...methods}>
          <div className={styles.fields}>
            <ProfileForm currentTenantId={currentTenantId} />
            {/* Add LeaveCard for local OSS */}
            {!isCloud && <LeaveCard />}
            {canManageTenant && (
              <DeleteCard currentTenantId={currentTenantId} onClick={onClickDeletionButton} />
            )}
          </div>
        </FormProvider>
        {canManageTenant && (
          <SubmitFormChangesActionBar
            isOpen={isDirty}
            isSubmitting={isSubmitting}
            onDiscard={reset}
            onSubmit={onSubmit}
          />
        )}
      </form>
      {canManageTenant && (
        <>
          <UnsavedChangesAlertModal hasUnsavedChanges={isDirty} />
          <DeleteModal
            isOpen={isDeletionModalOpen}
            isLoading={isDeleting}
            tenant={watch('profile')}
            onClose={() => {
              setIsDeletionModalOpen(false);
            }}
            onDelete={onDelete}
          />
        </>
      )}
    </>
  );
}

export default TenantBasicSettings;
