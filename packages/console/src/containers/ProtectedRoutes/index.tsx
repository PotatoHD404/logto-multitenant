import { useLogto } from '@logto/react';
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
import useApi, { useAdminApi } from '@/hooks/use-api';
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
  const adminApi = useAdminApi({ hideErrorToast: true });
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
            // For local OSS, use admin API with admin organization tokens
            // This will show all tenants the user has access to based on organization membership
            const tenants = await adminApi.get('/api/tenants').json<LocalTenantResponse[]>();
            
            // Convert local API response to match TenantResponse format
            const tenantResponses: TenantResponse[] = tenants.map((tenant) => ({
              ...defaultTenantResponse,
              id: tenant.id,
              name: tenant.name,
              tag: tenant.tag as any,
              createdAt: new Date(tenant.createdAt),
              isSuspended: tenant.isSuspended || false,
            }));
            resetTenants(tenantResponses);
          }
        } catch (error) {
          console.error('Failed to load tenants:', error);
          // Don't throw error as this shouldn't block the app
        }
      };

      void loadTenants();
    }
  }, [isAuthenticated, isInitComplete, cloudApi, adminApi, resetTenants]);

  if (!isInitComplete || !isAuthenticated) {
    return <AppLoading />;
  }

  return <Outlet />;
}
