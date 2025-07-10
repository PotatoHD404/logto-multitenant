import { OrganizationInvitationStatus } from '@logto/schemas';
import classNames from 'classnames';
import { useContext, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAuthedCloudApi } from '@/cloud/hooks/use-cloud-api';
import { isCloud } from '@/consts/env';
import ActionsButton from '@/components/ActionsButton';
import Button from '@/ds-components/Button';
import DynamicT from '@/ds-components/DynamicT';
import { TenantsContext } from '@/contexts/TenantsProvider';
import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';
import Table from '@/ds-components/Table';
import Tag from '@/ds-components/Tag';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import type { RequestError } from '@/hooks/use-api';
import useApi, { useAdminApi } from '@/hooks/use-api';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import type { InvitationResponse, TenantInvitationResponse } from '@/cloud/types/router';
// import InviteMemberModal from '../InviteMemberModal';

import styles from './index.module.scss';

// Local OSS types
type LocalTenantInvitationResponse = {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  invitee: string;
  organizationRoles: Array<{ id: string; name: string; }>;
};

const invitationStatusColorMap = {
  Pending: 'state',
  Accepted: 'state',
  Expired: 'state',
  Revoked: 'state',
} as const;

const getExpirationStatus = (expiresAt: Date) => {
  const now = Date.now();
  const expirationTime = expiresAt.getTime();
  const timeDiff = expirationTime - now;
  const isExpired = timeDiff <= 0;
  const isExpiringSoon = timeDiff > 0 && timeDiff <= 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

  return { isExpired, isExpiringSoon };
};

function Invitations() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console.tenant_members' });
  const cloudApi = useAuthedCloudApi();
  const adminApi = useAdminApi();
  const { currentTenantId } = useContext(TenantsContext);
  const {
    access: { canInviteMember, canRemoveMember },
  } = useCurrentTenantScopes();
  const { mutateSubscriptionQuotaAndUsages } = useContext(SubscriptionDataContext);
  const { data, error, isLoading, mutate } = useSWR<
    (TenantInvitationResponse | LocalTenantInvitationResponse)[], 
    RequestError
  >(
    `api/tenants/${currentTenantId}/invitations`,
    async () => {
      if (isCloud) {
        return cloudApi.get('/api/tenants/:tenantId/invitations', { params: { tenantId: currentTenantId } });
      } else {
        return adminApi.get(`api/tenants/${currentTenantId}/invitations`).json<LocalTenantInvitationResponse[]>();
      }
    }
  );

  const [showInviteModal, setShowInviteModal] = useState(false);
  const { show } = useConfirmModal();

  const handleRevoke = async (invitationId: string) => {
    const [result] = await show({
      ModalContent: t('revoke_invitation_confirm'),
      confirmButtonText: 'general.confirm',
    });

    if (!result) {
      return;
    }

    try {
      if (isCloud) {
        await cloudApi.patch(`/api/tenants/:tenantId/invitations/:invitationId/status`, {
          params: { tenantId: currentTenantId, invitationId },
          body: { status: OrganizationInvitationStatus.Revoked },
        });
      } else {
        await adminApi.patch(`api/tenants/${currentTenantId}/invitations/${invitationId}/status`, {
          json: { status: OrganizationInvitationStatus.Revoked },
        });
      }
      
      if (isCloud) {
        mutateSubscriptionQuotaAndUsages();
      }
      void mutate();
      toast.success(t('messages.invitation_revoked'));
    } catch (error) {
      console.error('Failed to revoke invitation:', error);
      toast.error(t('errors.generic'));
    }
  };

  const handleDelete = async (invitationId: string) => {
    const [result] = await show({
      ModalContent: t('delete_user_confirm'),
      confirmButtonText: 'general.delete',
    });

    if (!result) {
      return;
    }

    if (isCloud) {
      await cloudApi.delete(`/api/tenants/:tenantId/invitations/:invitationId`, {
        params: { tenantId: currentTenantId, invitationId },
      });
          } else {
        await adminApi.delete(`api/tenants/${currentTenantId}/invitations/${invitationId}`);
      }
    
    if (isCloud) {
      mutateSubscriptionQuotaAndUsages();
    }
    void mutate();
    toast.success(t('messages.invitation_deleted'));
  };

  const handleResend = async (invitationId: string) => {
    if (isCloud) {
      await cloudApi.post(
        '/api/tenants/:tenantId/invitations/:invitationId/message',
        {
          params: { tenantId: currentTenantId, invitationId },
        }
      );
          } else {
        await adminApi.post(`api/tenants/${currentTenantId}/invitations/${invitationId}/message`);
      }
    toast.success(t('messages.invitation_sent'));
  };

  return (
    <>
      <div className={styles.header}>
        <div className={styles.title}>{t('invitations')}</div>
        {canInviteMember && (
          <Button
            size="small"
            type="primary"
            title="tenant_members.invite_members"
            onClick={() => {
              setShowInviteModal(true);
            }}
          />
        )}
      </div>
      <Table
        placeholder={<div />}
        isLoading={isLoading}
        errorMessage={error?.toString()}
        rowGroups={[{ key: 'invitations', data }]}
        columns={[
          {
            dataIndex: 'invitee',
            title: t('user'),
            colSpan: 5,
                         render: (invitation: TenantInvitationResponse | LocalTenantInvitationResponse) => {
               const email = 'email' in invitation ? invitation.email : invitation.invitee;
               
               return (
                 <div>
                   <div className={styles.name}>{email}</div>
                 </div>
               );
             },
          },
          {
            dataIndex: 'role',
            title: t('roles'),
            colSpan: 2,
            render: (invitation: TenantInvitationResponse | LocalTenantInvitationResponse) => {
              const role = 'role' in invitation ? invitation.role : invitation.organizationRoles[0]?.name || 'collaborator';
              return (
                <Tag variant="cell">
                  <span>{t(role === 'admin' ? 'admin' : 'collaborator')}</span>
                </Tag>
              );
            },
          },
          {
            dataIndex: 'status',
            title: t('invitation_status'),
            colSpan: 2,
            render: (invitation: TenantInvitationResponse | LocalTenantInvitationResponse) => {
              const { status } = invitation;
              const { isExpired, isExpiringSoon } = getExpirationStatus(new Date(invitation.expiresAt));
              const effectiveStatus = isExpired ? 'Expired' : status;
              const color = invitationStatusColorMap[effectiveStatus as keyof typeof invitationStatusColorMap];

              return (
                <div className={styles.statusContainer}>
                  <Tag className={classNames(styles.statusTag, isExpiringSoon && styles.expiringSoon)} variant="cell" type={color}>
                    <DynamicT forKey={`tenant_members.invitation_statuses.${effectiveStatus}`} />
                  </Tag>
                </div>
              );
            },
          },
          {
            dataIndex: 'createdAt',
            title: t('expiration_date'),
            colSpan: 2,
            render: (invitation: TenantInvitationResponse | LocalTenantInvitationResponse) => {
              const expiresAt = new Date(invitation.expiresAt);
              const { isExpired, isExpiringSoon } = getExpirationStatus(expiresAt);

              return (
                <div className={classNames(styles.expirationDate, isExpired && styles.expired, isExpiringSoon && styles.expiringSoon)}>
                  {expiresAt.toLocaleDateString()}
                </div>
              );
            },
          },
          {
            dataIndex: 'actions',
            title: null,
            colSpan: 1,
            render: (invitation: TenantInvitationResponse | LocalTenantInvitationResponse) => (
              <ActionsButton
                fieldName="tenant_members.user"
                deleteConfirmation="tenant_members.delete_user_confirm"
                onEdit={
                  invitation.status === 'Pending' && canInviteMember
                    ? () => {
                        void handleResend(invitation.id);
                      }
                    : undefined
                }
                onDelete={
                  canRemoveMember
                    ? () => {
                        void handleDelete(invitation.id);
                      }
                    : undefined
                }
                customActions={[
                  {
                    key: 'revoke',
                    name: t('revoke'),
                    handler: () => {
                      void handleRevoke(invitation.id);
                    },
                  },
                ]}
                textOverrides={{
                  edit: 'tenant_members.menu_options.resend',
                  delete: 'tenant_members.menu_options.delete',
                  deleteConfirmation: 'general.remove',
                }}
              />
            ),
          },
        ]}
        rowIndexKey="id"
      />
      {showInviteModal && (
        {/* Invite modal temporarily disabled */}
      )}
    </>
  );
}

export default Invitations;
