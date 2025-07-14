import { conditional } from '@silverhand/essentials';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useAuthedCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type TenantMemberResponse } from '@/cloud/types/router';
import ActionsButton from '@/components/ActionsButton';
import EmptyDataPlaceholder from '@/components/EmptyDataPlaceholder';
import UserPreview from '@/components/ItemPreview/UserPreview';
import { isCloud } from '@/consts/env';
import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Table from '@/ds-components/Table';
import type { RequestError } from '@/hooks/use-api';
import { useAdminApi } from '@/hooks/use-api';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useCurrentUser from '@/hooks/use-current-user';

// Local OSS types
type LocalTenantMemberResponse = {
  id: string;
  name: string | undefined;
  primaryEmail: string | undefined;
  primaryPhone: string | undefined;
  avatar: string | undefined;
  username: string | undefined;
  role: string;
  isOwner: boolean;
  organizationRoles: Array<{ id: string; name: string }>;
};

function Members() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console.tenant_members' });
  const cloudApi = useAuthedCloudApi();
  const adminApi = useAdminApi();
  const { currentTenantId } = useContext(TenantsContext);
  const { user: currentUser } = useCurrentUser();
  const {
    access: { canRemoveMember, canUpdateMemberRole },
  } = useCurrentTenantScopes();
  const { mutateSubscriptionQuotaAndUsages } = useContext(SubscriptionDataContext);

  const { data, error, isLoading, mutate } = useSWR<
    Array<TenantMemberResponse | LocalTenantMemberResponse>,
    RequestError
  >(`api/tenants/${currentTenantId}/members`, async () => {
    if (isCloud) {
      return cloudApi.get('/api/tenants/:tenantId/members', {
        params: { tenantId: currentTenantId },
      });
    }
    return adminApi
      .get(`api/tenants/${currentTenantId}/members`)
      .json<LocalTenantMemberResponse[]>();
  });

  const [userToBeEdited, setUserToBeEdited] = useState<
    TenantMemberResponse | LocalTenantMemberResponse | undefined
  >();

  const handleDeleteMember = async (userId: string) => {
    await (isCloud
      ? cloudApi.delete(`/api/tenants/:tenantId/members/:userId`, {
          params: { tenantId: currentTenantId, userId },
        })
      : adminApi.delete(`api/tenants/${currentTenantId}/members/${userId}`));
    void mutate();
    if (isCloud) {
      mutateSubscriptionQuotaAndUsages();
    }
  };

  return (
    <Table
      isRowHoverEffectDisabled
      placeholder={<EmptyDataPlaceholder />}
      isLoading={isLoading}
      errorMessage={error?.toString()}
      rowGroups={[{ key: 'data', data }]}
      columns={[
        {
          dataIndex: 'user',
          title: t('user'),
          colSpan: 5,
          render: (user: TenantMemberResponse | LocalTenantMemberResponse) => (
            <UserPreview
              user={{
                id: user.id,
                name: user.name,
                primaryEmail: user.primaryEmail,
                primaryPhone: user.primaryPhone,
                avatar: user.avatar,
              }}
            />
          ),
        },
        {
          dataIndex: 'roles',
          title: t('roles'),
          colSpan: 2,
          render: (user: TenantMemberResponse | LocalTenantMemberResponse) => {
            const role =
              'role' in user ? user.role : user.organizationRoles[0]?.name || 'collaborator';
            return <span>{t(role === 'admin' ? 'admin' : 'collaborator')}</span>;
          },
        },
        ...(canUpdateMemberRole || canRemoveMember
          ? [
              {
                dataIndex: 'actions',
                title: null,
                colSpan: 1,
                render: (user: TenantMemberResponse | LocalTenantMemberResponse) => (
                  <ActionsButton
                    deleteConfirmation="tenant_members.delete_user_confirm"
                    fieldName="tenant_members.user"
                    textOverrides={{
                      edit: 'tenant_members.menu_options.edit',
                      delete: 'tenant_members.menu_options.delete',
                      deleteConfirmation: 'general.remove',
                    }}
                    onEdit={conditional(
                      canUpdateMemberRole &&
                        (() => {
                          setUserToBeEdited(user);
                        })
                    )}
                    onDelete={conditional(
                      canRemoveMember &&
                        // Cannot remove self from members list
                        currentUser?.id !== user.id &&
                        (async () => handleDeleteMember(user.id))
                    )}
                  />
                ),
              },
            ]
          : []),
      ]}
      rowIndexKey="id"
    />
  );
}

export default Members;
