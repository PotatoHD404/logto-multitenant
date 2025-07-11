import { ReservedResource } from '@logto/core-kit';
import { type Resource, getManagementApiResourceIndicator } from '@logto/schemas';
import { trySafe, type Nullable } from '@silverhand/essentials';
import { type ResourceServer } from 'oidc-provider';
import { sql } from '@silverhand/slonik';

import { EnvSet } from '#src/env-set/index.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';

const isReservedResource = (indicator: string): indicator is ReservedResource =>
  // eslint-disable-next-line no-restricted-syntax -- it's the best way to do it
  Object.values(ReservedResource).includes(indicator as ReservedResource);

/**
 * Check if the given indicator is a management API resource for a valid tenant.
 * Management API resources follow the pattern: https://{tenantId}.logto.app/api
 * where tenantId must be a valid tenant ID (not reserved subdomains).
 */
const isManagementApiResource = (indicator: string): boolean => {
  const match = indicator.match(/^https:\/\/([\w-]+)\.logto\.app\/api$/);
  if (!match?.[1]) return false;
  
  const tenantId = match[1];
  
  // Exclude known non-tenant subdomains (but keep admin as it's a real tenant)
  const reservedSubdomains = ['profile', 'cloud', 'api', 'www', 'console'];
  if (reservedSubdomains.includes(tenantId)) {
    return false;
  }
  
  // Validate tenant ID format - should be alphanumeric and reasonable length
  // Real tenant IDs are typically 21 characters, but allow some flexibility
  if (!/^[a-zA-Z0-9]{5,25}$/.test(tenantId)) {
    return false;
  }
  
  return true;
};

/**
 * Extract tenant ID from a management API resource indicator.
 * @param indicator The resource indicator (e.g., "https://tenant123.logto.app/api")
 * @returns The tenant ID or null if not a valid management API resource
 */
const extractTenantIdFromManagementApiResource = (indicator: string): string | null => {
  if (!isManagementApiResource(indicator)) {
    return null;
  }
  
  const match = indicator.match(/^https:\/\/([\w-]+)\.logto\.app\/api$/);
  return match?.[1] ?? null;
};

export const getSharedResourceServerData = (
  envSet: EnvSet
): Pick<ResourceServer, 'accessTokenFormat' | 'jwt'> => ({
  accessTokenFormat: 'jwt',
  jwt: {
    sign: { alg: envSet.oidc.jwkSigningAlg },
  },
});

/**
 * The default TTL (Time To Live) of the access token for the reversed resources.
 * It may be configurable in the future.
 */
export const reversedResourceAccessTokenTtl = 3600;

/**
 * Find the resource for a given indicator. This function also handles the reserved
 * resources and validates management API resources.
 *
 * @see {@link ReservedResource} for the list of reserved resources.
 */
export const findResource = async (
  queries: Queries,
  indicator: string
): Promise<Nullable<Pick<Resource, 'indicator' | 'accessTokenTtl'>>> => {
  if (isReservedResource(indicator)) {
    return {
      indicator,
      accessTokenTtl: reversedResourceAccessTokenTtl,
    };
  }

  // Handle special case: profile API maps to Me API
  if (indicator === 'https://profile.logto.app/api') {
    // Return the Me API resource configuration
    return {
      indicator,
      accessTokenTtl: reversedResourceAccessTokenTtl,
    };
  }

  // Validate management API resources before database lookup
  if (isManagementApiResource(indicator)) {
    const tenantId = extractTenantIdFromManagementApiResource(indicator);
    if (tenantId) {
      // For validated management API resources, check if it exists in database
      const resource = await queries.resources.findResourceByIndicator(indicator);
      if (resource) {
        return {
          indicator: resource.indicator,
          accessTokenTtl: resource.accessTokenTtl,
        };
      }
      
      // If no resource found in database but it's a valid management API pattern,
      // return a default configuration (this handles the case where the resource
      // should exist but hasn't been created yet)
      return {
        indicator,
        accessTokenTtl: reversedResourceAccessTokenTtl,
      };
    }
    
    // Invalid management API resource (bad tenant ID format, reserved subdomain, etc.)
    return null;
  }

  // For all other resources, do regular database lookup
  const resource = await queries.resources.findResourceByIndicator(indicator);

  if (!resource) {
    return null;
  }

  return {
    indicator: resource.indicator,
    accessTokenTtl: resource.accessTokenTtl,
  };
};

export const findResourceScopes = async ({
  queries,
  libraries,
  userId,
  applicationId,
  indicator,
  organizationId,
  findFromOrganizations,
  envSet,
}: {
  queries: Queries;
  libraries: Libraries;
  indicator: string;
  /**
   * In consent or code exchange flow, the `organizationId` is `undefined`, and all the scopes
   * inherited from the all organization roles should be granted.
   *
   * In the flow of granting token for a specific organization with API resource, `organizationId`
   * is provided, and only the scopes inherited from that organization should be granted.
   *
   * Note: This value does not affect the reserved resources and application subjects.
   */
  findFromOrganizations: boolean;
  userId?: string;
  applicationId?: string;
  organizationId?: string;
  envSet?: EnvSet;
}): Promise<readonly { name: string; id: string; }[]> => {
  if (isReservedResource(indicator)) {
    const { users: { findUserScopesForResourceIndicator }, applications: { findApplicationScopesForResourceIndicator } } = libraries;

    if (userId) {
      const scopes = await findUserScopesForResourceIndicator(
        userId,
        indicator,
        findFromOrganizations,
        organizationId
      );
      return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
    }

    if (applicationId && organizationId) {
      const scopes = await queries.organizations.relations.appsRoles.getApplicationResourceScopes(
        organizationId,
        applicationId,
        indicator
      );
      return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
    }

    if (applicationId) {
      const scopes = await findApplicationScopesForResourceIndicator(applicationId, indicator);
      return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
    }

    return [];
  }

  // Handle special case: profile API maps to Me API scopes  
  // Profile API scopes are stored in admin tenant, so we need cross-tenant access
  if (indicator === 'https://profile.logto.app/api') {
    if (envSet && userId) {
      try {
        // For profile API, we need to query admin tenant directly
        // because user permissions are stored there, not in the user tenant
        const sharedPool = await EnvSet.sharedPool;
        
        // Use transaction to isolate tenant context setting
        const scopes = await sharedPool.transaction(async (connection) => {
          await connection.query(sql`SET LOCAL app.tenant_id = 'admin'`);
          
          // Query admin tenant for user scopes on the Me API resource
          return await connection.any<{ name: string; id: string }>(sql`
            SELECT DISTINCT s.name, s.id
            FROM scopes s
            JOIN resources r ON s.resource_id = r.id
            JOIN roles_scopes rs ON s.id = rs.scope_id
            JOIN roles role ON rs.role_id = role.id
            JOIN users_roles ur ON role.id = ur.role_id
            WHERE r.indicator = 'https://admin.logto.app/me'
            AND r.tenant_id = 'admin'
            AND ur.user_id = ${userId}
            AND role.tenant_id = 'admin'
          `);
        });
        
        return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
      } catch (error) {
        console.error(`Failed to query profile API scopes:`, error);
        return [];
      }
    }
  }

  // Handle Me API resource directly (https://admin.logto.app/me)
  // Me API scopes are stored in admin tenant, so we need cross-tenant access
  if (indicator === 'https://admin.logto.app/me') {
    console.log(`[DEBUG] Me API detected for ${indicator} - userId: ${!!userId}, envSet: ${!!envSet}`);
    if (envSet && userId) {
      try {
        // For Me API, we need to query admin tenant directly
        // because user permissions are stored there, not in the user tenant
        const sharedPool = await EnvSet.sharedPool;
        
        // Use transaction to isolate tenant context setting
        const scopes = await sharedPool.transaction(async (connection) => {
          await connection.query(sql`SET LOCAL app.tenant_id = 'admin'`);
          
          // Query admin tenant for user scopes on the Me API resource
          return await connection.any<{ name: string; id: string }>(sql`
            SELECT DISTINCT s.name, s.id
            FROM scopes s
            JOIN resources r ON s.resource_id = r.id
            JOIN roles_scopes rs ON s.id = rs.scope_id
            JOIN roles role ON rs.role_id = role.id
            JOIN users_roles ur ON role.id = ur.role_id
            WHERE r.indicator = 'https://admin.logto.app/me'
            AND r.tenant_id = 'admin'
            AND ur.user_id = ${userId}
            AND role.tenant_id = 'admin'
          `);
        });
        
        console.log(`[DEBUG] Me API scopes found: ${JSON.stringify(scopes)}`);
        return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
      } catch (error) {
        console.error(`Failed to query Me API scopes:`, error);
        return [];
      }
    }
  }

  // Handle management API resources with cross-tenant access for admin permissions
  if (isManagementApiResource(indicator)) {
    console.log(`[DEBUG] Management API detected for ${indicator} - userId: ${!!userId}, envSet: ${!!envSet}`);
    if (envSet && userId) {
      const tenantId = extractTenantIdFromManagementApiResource(indicator);
      if (tenantId) {
        try {
          // For management API resources, we need to query admin tenant directly
          // because user permissions are stored there, not in the user tenant
          const sharedPool = await EnvSet.sharedPool;
          
          // Use transaction to isolate tenant context setting
          const scopes = await sharedPool.transaction(async (connection) => {
            await connection.query(sql`SET LOCAL app.tenant_id = 'admin'`);
            
            // Query admin tenant for user scopes on this management API resource
            return await connection.any<{ name: string; id: string }>(sql`
              SELECT DISTINCT s.name, s.id
              FROM scopes s
              JOIN resources r ON s.resource_id = r.id
              JOIN roles_scopes rs ON s.id = rs.scope_id
              JOIN roles role ON rs.role_id = role.id
              JOIN users_roles ur ON role.id = ur.role_id
              WHERE r.indicator = ${indicator}
              AND r.tenant_id = 'admin'
              AND ur.user_id = ${userId}
              AND role.tenant_id = 'admin'
            `);
          });
          
          console.log(`[DEBUG] Management API scopes found: ${JSON.stringify(scopes)}`);
          return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
        } catch (error) {
          console.error(`Failed to query management API scopes for ${indicator}:`, error);
          return [];
        }
      }
    }
  }

  // For all other resources (organizations, custom APIs), use tenant-isolated queries
  // This ensures proper tenant isolation for regular resources
  const resource = await queries.resources.findResourceByIndicator(indicator);

  if (!resource) {
    return [];
  }

  const { users: { findUserScopesForResourceIndicator }, applications: { findApplicationScopesForResourceIndicator } } = libraries;

  if (userId) {
    const scopes = await findUserScopesForResourceIndicator(
      userId,
      resource.indicator,
      findFromOrganizations,
      organizationId
    );
    return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
  }

  if (applicationId && organizationId) {
    const scopes = await queries.organizations.relations.appsRoles.getApplicationResourceScopes(
      organizationId,
      applicationId,
      resource.indicator
    );
    return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
  }

  if (applicationId) {
    const scopes = await findApplicationScopesForResourceIndicator(applicationId, resource.indicator);
    return scopes.map((scope) => ({ name: scope.name, id: scope.id }));
  }

  return [];
};

export const isThirdPartyApplication = async ({ applications }: Queries, applicationId: string) => {
  // Demo-app not exist in the database
  const application = await trySafe(async () => applications.findApplicationById(applicationId));

  return application?.isThirdParty ?? false;
};

/**
 * Filter out the unsupported scopes for the third-party application.
 *
 * third-party application can only request the scopes that are enabled in the client scope metadata  @see {@link https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#clients}
 * However, the client scope metadata does not support prefix matching and resource scopes name are not unique, so we need to filter out the resource and organization scopes specifically based on the resource indicator.
 *
 * Available resource scopes can be found using {@link findResourceScopes}.
 */
export const filterResourceScopesForTheThirdPartyApplication = async (
  libraries: Libraries,
  applicationId: string,
  indicator: string,
  scopes: ReadonlyArray<{ name: string; id: string }>,
  {
    includeOrganizationResourceScopes = true,
    includeResourceScopes = true,
  }: { includeOrganizationResourceScopes?: boolean; includeResourceScopes?: boolean } = {}
) => {
  const {
    applications: {
      getApplicationUserConsentOrganizationScopes,
      getApplicationUserConsentResourceScopes,
      getApplicationUserConsentOrganizationResourceScopes,
    },
  } = libraries;

  if (isReservedResource(indicator)) {
    switch (indicator) {
      case ReservedResource.Organization: {
        const userConsentOrganizationScopes =
          await getApplicationUserConsentOrganizationScopes(applicationId);

        // Filter out the organization scopes that are not enabled in the application
        return scopes.filter(({ id: organizationScopeId }) =>
          userConsentOrganizationScopes.some(
            ({ id: consentOrganizationId }) => consentOrganizationId === organizationScopeId
          )
        );
      }
      // FIXME: @simeng double check if it's necessary
      // Return all the scopes for the reserved resources
      // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
      default: {
        return scopes;
      }
    }
  }

  // Get the API resource scopes that are enabled in the application
  const userConsentResources = includeResourceScopes
    ? await getApplicationUserConsentResourceScopes(applicationId)
    : [];
  const userConsentResource = userConsentResources.find(
    ({ resource }) => resource.indicator === indicator
  );
  const userConsentOrganizationResources = includeOrganizationResourceScopes
    ? await getApplicationUserConsentOrganizationResourceScopes(applicationId)
    : [];
  const userConsentOrganizationResource = userConsentOrganizationResources.find(
    ({ resource }) => resource.indicator === indicator
  );

  const resourceScopes = [
    ...(userConsentResource?.scopes ?? []),
    ...(userConsentOrganizationResource?.scopes ?? []),
  ];

  return scopes.filter(({ id: resourceScopeId }) =>
    resourceScopes.some(
      ({ id: consentResourceScopeId }) => consentResourceScopeId === resourceScopeId
    )
  );
};

/**
 * Check if the user has consented to the application for the specific organization.
 *
 * User will be asked to grant the organization access to the application on the consent page.
 * User application organization grant status can be managed using management API.
 */
export const isOrganizationConsentedToApplication = async (
  { applications: { userConsentOrganizations } }: Queries,
  applicationId: string,
  accountId: string,
  organizationId: string
) => {
  return userConsentOrganizations.exists({ applicationId, userId: accountId, organizationId });
};
