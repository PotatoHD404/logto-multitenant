import { TenantRole } from '@logto/schemas';
import { useContext, useState } from 'react';
import { toast } from 'react-hot-toast';
import ReactModal from 'react-modal';

import { useAuthedCloudApi } from '@/cloud/hooks/use-cloud-api';
import { isCloud } from '@/consts/env';
import Button from '@/ds-components/Button';
import FormField from '@/ds-components/FormField';
import ModalLayout from '@/ds-components/ModalLayout';
import TextInput from '@/ds-components/TextInput';
import { TenantsContext } from '@/contexts/TenantsProvider';
import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';
import useApi from '@/hooks/use-api';
import modalStyles from '@/scss/modal.module.scss';

type Props = {
  readonly isOpen: boolean;
  readonly onClose: (isSuccessful?: boolean) => void;
};

function InviteMemberModal({ isOpen, onClose }: Props) {
  const cloudApi = useAuthedCloudApi();
  const localApi = useApi();
  const { currentTenantId } = useContext(TenantsContext);
  const { mutateSubscriptionQuotaAndUsages } = useContext(SubscriptionDataContext);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');

  const handleClose = (isSuccessful = false) => {
    setEmail('');
    onClose(isSuccessful);
  };

  const onSubmit = async () => {
    if (!email.trim()) {
      toast.error('Email is required');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      if (isCloud) {
        await cloudApi.post('/api/tenants/:tenantId/invitations', {
          params: { tenantId: currentTenantId },
          body: { invitee: [email.trim()], roleName: TenantRole.Collaborator },
        });
      } else {
        await localApi.post(`api/tenants/${currentTenantId}/invitations`, {
          json: { emails: [email.trim()], role: TenantRole.Collaborator },
        });
      }
      
      if (isCloud) {
        mutateSubscriptionQuotaAndUsages();
      }
      
      toast.success('Invitation sent successfully');
      handleClose(true);
    } catch (error) {
      console.error('Error sending invitation:', error);
      toast.error('Failed to send invitation');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ReactModal
      isOpen={isOpen}
      className={modalStyles.content}
      overlayClassName={modalStyles.overlay}
      onRequestClose={() => handleClose(false)}
    >
      <ModalLayout
        title="tenant_members.invite_modal.title"
        subtitle="tenant_members.invite_modal.subtitle"
        onClose={() => handleClose(false)}
        footer={
          <Button type="primary" title="tenant_members.invite_members" isLoading={isLoading} onClick={onSubmit} />
        }
      >
        <FormField title="tenant_members.invite_modal.to">
          <TextInput
            value={email}
            placeholder="tenant_members.invite_modal.email_input_placeholder"
            onChange={({ currentTarget: { value } }) => setEmail(value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void onSubmit();
              }
            }}
          />
        </FormField>
        <FormField title="tenant_members.invite_modal.added_as">
          <TextInput
            value="Collaborator"
            readOnly
            placeholder="Role will be set to Collaborator"
          />
        </FormField>
      </ModalLayout>
    </ReactModal>
  );
}

export default InviteMemberModal; 