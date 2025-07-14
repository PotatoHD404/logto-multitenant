import { TenantScope } from '@logto/schemas';
import { useContext, useMemo } from 'react';
import useSWR from 'swr';

import { useAuthedCloudApi } from '@/cloud/hooks/use-cloud-api';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';

import { type RequestError } from './use-api';
import useCurrentUser from './use-current-user';

const useCurrentTenantScopes = () => {
  const { currentTenantId } = useContext(TenantsContext);
  const cloudApi = useAuthedCloudApi();
  const { user } = useCurrentUser();
  const userId = user?.id ?? '';

  const {
    data: scopes,
    isLoading,
    mutate,
  } = useSWR<string[], RequestError>(
    // Only fetch scopes for cloud environments
    isCloud && userId && `api/tenants/${currentTenantId}/members/${userId}/scopes`,
    async () => {
      const scopes = await cloudApi.get('/api/tenants/:tenantId/members/:userId/scopes', {
        params: { tenantId: currentTenantId, userId },
      });
      return scopes.map(({ name }) => name);
    }
  );

  const access = useMemo(
    () => ({
      canInviteMember: Boolean(scopes?.includes(TenantScope.InviteMember)) || !isCloud,
      canRemoveMember: Boolean(scopes?.includes(TenantScope.RemoveMember)) || !isCloud,
      canUpdateMemberRole: Boolean(scopes?.includes(TenantScope.UpdateMemberRole)) || !isCloud,
      canManageTenant: Boolean(scopes?.includes(TenantScope.ManageTenant)) || !isCloud,
    }),
    [scopes]
  );

  return useMemo(
    () => ({
      // In local OSS, never show loading state and always have full access
      isLoading: isCloud ? isLoading : false,
      // In local OSS, return a dummy scopes array to prevent logout behavior
      scopes: isCloud ? scopes : ['manage_tenant'],
      access,
      mutate,
    }),
    [isLoading, scopes, access, mutate]
  );
};

export default useCurrentTenantScopes;
