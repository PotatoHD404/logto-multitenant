import { useLogto } from '@logto/react';
import { useContext, useEffect, useCallback, useState } from 'react';
import { getTenantOrganizationId } from '@logto/schemas';
import { Prompt } from '@logto/react';

import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

/**
 * Hook to handle token refresh and rights validation when switching tenants
 */
export default function useTenantTokenRefresh() {
  const { currentTenantId } = useContext(TenantsContext);
  const { 
    isAuthenticated, 
    getOrganizationToken, 
    getOrganizationTokenClaims,
    clearAccessToken,
    signIn
  } = useLogto();
  const redirectUri = useRedirectUri();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastTenantId, setLastTenantId] = useState<string>('');

  /**
   * Refresh tokens for the current tenant
   */
  const refreshTenantToken = useCallback(async () => {
    if (!isAuthenticated || !currentTenantId || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    try {
      // Clear existing access token to force refresh
      await clearAccessToken();

      // Both cloud and OSS now use organization tokens for consistent behavior
      const organizationId = getTenantOrganizationId(currentTenantId);
      
      // This will fetch a fresh organization token
      const token = await getOrganizationToken(organizationId);
      
      if (!token) {
        console.warn('❌ Failed to get organization token for tenant:', currentTenantId);
        // Redirect to sign-in for re-consent
        saveRedirect();
        void signIn({
          redirectUri: redirectUri.href,
          prompt: Prompt.Consent,
        });
        return;
      }

      // Validate token has required scopes
      const claims = await getOrganizationTokenClaims(organizationId);
      console.log('✅ Auto-refreshed organization token for tenant:', currentTenantId, 'scopes:', claims?.scope);

    } catch (error) {
      console.error('❌ Failed to refresh tenant token:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isAuthenticated,
    currentTenantId,
    isRefreshing,
    clearAccessToken,
    getOrganizationToken,
    getOrganizationTokenClaims,
    redirectUri.href,
    signIn,
  ]);

  /**
   * Validate user has access to current tenant
   */
  const validateTenantAccess = useCallback(async () => {
    if (!isAuthenticated || !currentTenantId) {
      return false;
    }

    try {
      // Both cloud and OSS now use organization tokens for consistent behavior
      const organizationId = getTenantOrganizationId(currentTenantId);
      const token = await getOrganizationToken(organizationId);
      return Boolean(token);
    } catch (error) {
      console.error('Failed to validate tenant access:', error);
      return false;
    }
  }, [isAuthenticated, currentTenantId, getOrganizationToken]);

  // Refresh token when tenant changes
  useEffect(() => {
    if (currentTenantId && currentTenantId !== lastTenantId) {
      setLastTenantId(currentTenantId);
      void refreshTenantToken();
    }
  }, [currentTenantId, lastTenantId, refreshTenantToken]);

  return {
    refreshTenantToken,
    validateTenantAccess,
    isRefreshing,
  };
} 