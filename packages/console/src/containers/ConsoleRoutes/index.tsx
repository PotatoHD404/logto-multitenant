import { ossConsolePath } from '@logto/schemas';
import { Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';
import { SWRConfig } from 'swr';

import AppLoading from '@/components/AppLoading';
import { isCloud } from '@/consts/env';
import AppBoundary from '@/containers/AppBoundary';
import AppContent, { RedirectToFirstItem } from '@/containers/AppContent';
import ConsoleContent from '@/containers/ConsoleContent';
import ProtectedRoutes from '@/containers/ProtectedRoutes';
import TenantAccess from '@/containers/TenantAccess';
import { GlobalRoute } from '@/contexts/TenantsProvider';
import useSwrOptions from '@/hooks/use-swr-options';
import Callback from '@/pages/Callback';
import CheckoutSuccessCallback from '@/pages/CheckoutSuccessCallback';
import { dropLeadingSlash } from '@/utils/url';

import { __Internal__ImportError } from './internal';

const Welcome = safeLazy(async () => import('@/pages/Welcome'));
const Profile = safeLazy(async () => import('@/pages/Profile'));

function Layout() {
  const swrOptions = useSwrOptions();

  return (
    <SWRConfig value={swrOptions}>
      <AppBoundary>
        <Outlet />
      </AppBoundary>
    </SWRConfig>
  );
}

export function ConsoleRoutes() {
  return (
    <Suspense fallback={<AppLoading />}>
      <Routes>
        {/**
         * OSS doesn't have a tenant concept nor root path handling component, but it may
         * navigate to the root path in frontend. In this case, we redirect it to the OSS
         * console path to trigger the console routes.
         */}
        {!isCloud && <Route path="/" element={<Navigate to={`${ossConsolePath}/welcome`} />} />}

        {/* OSS console routing */}
        {!isCloud && (
          <Route path={ossConsolePath} element={<Layout />}>
            {/* Default route for /console redirects to welcome */}
            <Route index element={<Navigate replace to="welcome" />} />

            {/* Pre-tenant routes - no tenant ID required */}
            <Route path="welcome" element={<Welcome />} />
            <Route path="callback" element={<Callback />} />
            <Route path="__internal__/import-error" element={<__Internal__ImportError />} />

            {/* Protected routes that don't require tenant context */}
            <Route element={<ProtectedRoutes />}>
              {/* Admin profile route - tenant-independent, uses admin tenant API */}
              <Route path={dropLeadingSlash(GlobalRoute.Profile) + '/*'} element={<Profile />} />
            </Route>

            {/* Tenant-specific routes - require tenant ID */}
            <Route path=":tenantId" element={<ProtectedRoutes />}>
              <Route element={<TenantAccess />}>
                <Route element={<AppContent />}>
                  <Route index element={<RedirectToFirstItem />} />
                  <Route path="*" element={<ConsoleContent />} />
                </Route>
              </Route>
            </Route>
          </Route>
        )}

        {/* Cloud routing: /:tenantId */}
        {isCloud && (
          <Route path="/:tenantId" element={<Layout />}>
            <Route path="callback" element={<Callback />} />
            <Route path="welcome" element={<Welcome />} />
            <Route path="__internal__/import-error" element={<__Internal__ImportError />} />
            <Route element={<ProtectedRoutes />}>
              <Route path={dropLeadingSlash(GlobalRoute.Profile) + '/*'} element={<Profile />} />
              <Route element={<TenantAccess />}>
                <Route
                  path={dropLeadingSlash(GlobalRoute.CheckoutSuccessCallback)}
                  element={<CheckoutSuccessCallback />}
                />
                <Route element={<AppContent />}>
                  <Route index element={<RedirectToFirstItem />} />
                  <Route path="*" element={<ConsoleContent />} />
                </Route>
              </Route>
            </Route>
          </Route>
        )}
      </Routes>
    </Suspense>
  );
}
