import { useLogto } from '@logto/react';
import { TenantTag } from '@logto/schemas';
import { yes, conditional } from '@silverhand/essentials';
import { useContext, useEffect } from 'react';
import { Outlet, useMatch, useSearchParams } from 'react-router-dom';

import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type TenantResponse } from '@/cloud/types/router';
import AppLoading from '@/components/AppLoading';
import { searchKeys } from '@/consts';
import { isCloud } from '@/consts/env';
import { defaultTenantResponse } from '@/consts/tenants';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useApi, { useAdminApi, useCrossTenantApi } from '@/hooks/use-api';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

// Type for local API tenant response
type LocalTenantResponse = {
  id: string;
  name: string;
  tag: string;
  createdAt: string;
  isSuspended?: boolean;
};

// Add a type guard for TenantTag
function isTenantTag(tag: unknown): tag is TenantTag {
  if (typeof tag !== 'string') {
    return false;
  }
  return tag === TenantTag.Development || tag === TenantTag.Production;
}

/**
 * The container for all protected routes. It renders `<AppLoading />` when the user is not
 * authenticated or the user is authenticated but the tenant is not initialized.
 *
 * That is, when it renders `<Outlet />`, you can expect:
 *
 * - `isAuthenticated` from `useLogto()` to be `true`.
 * - `isInitComplete` from `TenantsContext` to be `true`.
 *
 * Usage:
 *
 * ```tsx
 * <Route element={<ProtectedRoutes />}>
 *  <Route path="some-path" element={<SomeContent />} />
 * </Route>
 * ```
 *
 * Note that the `ProtectedRoutes` component should be put in a {@link https://reactrouter.com/en/main/start/concepts#pathless-routes | pathless route}.
 */
export default function ProtectedRoutes() {
  const { isAuthenticated, isLoading, signIn } = useLogto();
  const { isInitComplete, resetTenants } = useContext(TenantsContext);
  const redirectUri = useRedirectUri();
  const match = useMatch('/accept/:invitationId');
  const [searchParameters] = useSearchParams();

  const localApi = useApi({ hideErrorToast: true });
  const adminApi = useAdminApi();
  const crossTenantApi = useCrossTenantApi();
  const cloudApi = useCloudApi({ hideErrorToast: true });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      saveRedirect();
      const isInvitationLink = Boolean(match?.pathname.startsWith('/accept/'));
      const isSignUpMode = yes(searchParameters.get(searchKeys.signUp)) || isInvitationLink;
      void signIn(redirectUri.href, conditional(isSignUpMode && 'signUp'));
    }
  }, [redirectUri, isAuthenticated, isLoading, searchParameters, signIn, match?.pathname]);

  useEffect(() => {
    if (isAuthenticated && !isInitComplete) {
      const loadTenants = async () => {
        try {
          if (isCloud) {
            const data = await cloudApi.get('/api/tenants');
            resetTenants(data);
          } else {
            // For local OSS, use cross-tenant API to fetch tenants
            // This uses management API tokens for cross-tenant operations
            const tenants = await crossTenantApi.get('tenants').json<LocalTenantResponse[]>();

            // Convert local API response to match TenantResponse format
            const tenantResponses: TenantResponse[] = tenants.map((tenant) => {
              const tag = isTenantTag(tenant.tag) ? tenant.tag : TenantTag.Development;
              return {
                ...defaultTenantResponse,
                id: tenant.id,
                name: tenant.name,
                tag,
                createdAt: new Date(tenant.createdAt),
                isSuspended: typeof tenant.isSuspended === 'boolean' ? tenant.isSuspended : false,
              };
            });
            resetTenants(tenantResponses);
          }
        } catch (error) {
          console.error('Failed to load tenants:', error);
          // For OSS, if tenant loading fails, still allow access to default tenant
          if (!isCloud) {
            resetTenants([
              {
                ...defaultTenantResponse,
                id: 'default',
                name: 'Default',
                tag: TenantTag.Development,
                createdAt: new Date(),
                isSuspended: false,
              },
            ]);
          }
        }
      };

      void loadTenants();
    }
  }, [isAuthenticated, isInitComplete, cloudApi, crossTenantApi, resetTenants]);

  if (!isInitComplete || !isAuthenticated) {
    return <AppLoading />;
  }

  return <Outlet />;
}
