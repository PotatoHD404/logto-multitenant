import { type AccessTokenClaims } from '@logto/react';
import { getTenantOrganizationId } from '@logto/schemas';

type LogtoMethods = {
  isAuthenticated: boolean;
  getAccessToken: (resource?: string) => Promise<string | undefined>;
  getOrganizationToken: (organizationId: string) => Promise<string | undefined>;
  getOrganizationTokenClaims: (organizationId: string) => Promise<AccessTokenClaims | undefined>;
  clearAccessToken: () => Promise<void>;
};

/**
 * Manually refresh tokens for a specific tenant
 * Useful when switching tenants or when user permissions change
 */
export const refreshTokensForTenant = async (
  tenantId: string,
  isCloud: boolean,
  logtoMethods: LogtoMethods
): Promise<{ success: boolean; error?: string }> => {
  const {
    isAuthenticated,
    getAccessToken,
    getOrganizationToken,
    getOrganizationTokenClaims,
    clearAccessToken,
  } = logtoMethods;

  if (!isAuthenticated) {
    return { success: false, error: 'User not authenticated' };
  }

  try {
    // Clear existing tokens to force refresh
    await clearAccessToken();

    let tokenResult;

    // Both cloud and OSS now use organization tokens for consistent behavior
    const organizationId = getTenantOrganizationId(tenantId);
    const token = await getOrganizationToken(organizationId);

    if (!token) {
      return { success: false, error: 'Failed to obtain organization token' };
    }

    // Validate token claims
    const claims = await getOrganizationTokenClaims(organizationId);
    console.log(
      '✅ Organization token refreshed for tenant:',
      tenantId,
      'with scopes:',
      claims?.scope
    );

    tokenResult = { token, claims };

    return { success: true };
  } catch (error) {
    console.error('❌ Failed to refresh tokens for tenant:', tenantId, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};


