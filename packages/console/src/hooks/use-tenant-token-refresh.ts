import { useLogto } from '@logto/react';
import { useContext, useEffect, useCallback, useState } from 'react';
import { buildOrganizationUrn } from '@logto/core-kit';
import { getTenantOrganizationId, getManagementApiResourceIndicator } from '@logto/schemas';
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
    getAccessToken, 
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

      // Get fresh token based on environment
      if (isCloud) {
        // For cloud: get organization token
        const organizationId = getTenantOrganizationId(currentTenantId);
        const resourceIndicator = buildOrganizationUrn(organizationId);
        
        // This will fetch a fresh token
        const token = await getOrganizationToken(organizationId);
        
        if (!token) {
          console.warn('Failed to get organization token for tenant:', currentTenantId);
          // Optionally redirect to sign-in for re-consent
          saveRedirect();
          void signIn({
            redirectUri: redirectUri.href,
            prompt: Prompt.Consent,
          });
          return;
        }

        // Validate token has required scopes
        const claims = await getOrganizationTokenClaims(organizationId);
        console.log('Refreshed token claims for tenant:', currentTenantId, claims);
        
      } else {
        // For OSS: get management API token
        const resourceIndicator = getManagementApiResourceIndicator(currentTenantId);
        const token = await getAccessToken(resourceIndicator);
        
        if (!token) {
          console.warn('Failed to get management API token for tenant:', currentTenantId);
          return;
        }

        console.log('Refreshed management API token for tenant:', currentTenantId);
      }

    } catch (error) {
      console.error('Failed to refresh tenant token:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isAuthenticated,
    currentTenantId,
    isRefreshing,
    clearAccessToken,
    getAccessToken,
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
      if (isCloud) {
        const organizationId = getTenantOrganizationId(currentTenantId);
        const token = await getOrganizationToken(organizationId);
        return Boolean(token);
      } else {
        const resourceIndicator = getManagementApiResourceIndicator(currentTenantId);
        const token = await getAccessToken(resourceIndicator);
        return Boolean(token);
      }
    } catch (error) {
      console.error('Failed to validate tenant access:', error);
      return false;
    }
  }, [isAuthenticated, currentTenantId, getAccessToken, getOrganizationToken]);

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