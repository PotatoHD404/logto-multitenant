import { Theme, TenantTag } from '@logto/schemas';
import { FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import Modal from 'react-modal';

import CreateTenantHeaderIconDark from '@/assets/icons/create-tenant-header-dark.svg?react';
import CreateTenantHeaderIcon from '@/assets/icons/create-tenant-header.svg?react';
import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type TenantResponse } from '@/cloud/types/router';
import Button from '@/ds-components/Button';
import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import TextInput from '@/ds-components/TextInput';
import { isCloud } from '@/consts/env';
import { defaultTenantResponse } from '@/consts/tenants';
import useApi, { useAdminApi } from '@/hooks/use-api';
import useTheme from '@/hooks/use-theme';
import modalStyles from '@/scss/modal.module.scss';
import { trySubmitSafe } from '@/utils/form';

import { type CreateTenantData } from './types';

type Props = {
  readonly isOpen: boolean;
  readonly onClose: (tenant?: TenantResponse) => void;
};

function CreateTenantModal({ isOpen, onClose }: Props) {
  const theme = useTheme();

  const defaultValues = Object.freeze({
    // For local OSS, always use Production tag (no dev/prod distinction)
    // For cloud, keep the existing behavior with tag selection
    tag: isCloud ? TenantTag.Development : TenantTag.Production,
  });
  const methods = useForm<CreateTenantData>({
    defaultValues,
  });

  const {
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
    register,
  } = methods;

  const cloudApi = useCloudApi();
  const adminApi = useAdminApi();

  const createTenant = async ({ name, tag }: CreateTenantData) => {
    if (isCloud) {
      const newTenant = await cloudApi.post('/api/tenants', { body: { name, tag } });
      onClose(newTenant);
    } else {
      // For local OSS, use the admin tenant API
      const newTenant = await adminApi.post('api/tenants', { json: { name, tag } }).json<TenantResponse>();
      onClose(newTenant);
    }
  };
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  const onCreateClick = handleSubmit(
    trySubmitSafe(async (data: CreateTenantData) => {
      await createTenant(data);
      toast.success(t('tenants.create_modal.tenant_created'));
    })
  );

  return (
    <Modal
      shouldCloseOnOverlayClick
      shouldCloseOnEsc
      isOpen={isOpen}
      className={modalStyles.content}
      overlayClassName={modalStyles.overlay}
      onAfterClose={() => {
        reset(defaultValues);
      }}
      onRequestClose={() => {
        onClose();
      }}
    >
      <ModalLayout
        title="tenants.create_modal.title"
        subtitle="tenants.create_modal.subtitle"
        headerIcon={
          theme === Theme.Light ? <CreateTenantHeaderIcon /> : <CreateTenantHeaderIconDark />
        }
        footer={
          <Button
            isLoading={isSubmitting}
            disabled={isSubmitting}
            htmlType="submit"
            title="tenants.create_modal.create_button"
            size="large"
            type="primary"
            onClick={onCreateClick}
          />
        }
        size="large"
        onClose={onClose}
      >
        <FormProvider {...methods}>
          <FormField isRequired title="tenants.settings.tenant_name">
            <TextInput
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              {...register('name', { required: true })}
              error={Boolean(errors.name)}
              disabled={isSubmitting}
            />
          </FormField>
        </FormProvider>
      </ModalLayout>
    </Modal>
  );
}

export default CreateTenantModal;
