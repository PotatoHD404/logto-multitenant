import { adminTenantId, defaultTenantId } from '@logto/schemas';
import { type UrlSet } from '@logto/shared';
import { conditionalString, trySafe } from '@silverhand/essentials';
import { type CommonQueryMethods } from '@silverhand/slonik';

import { redisCache } from '#src/caches/index.js';
import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import { createDomainsQueries } from '#src/queries/domains.js';

import { debugConsole } from './console.js';

const normalizePathname = (pathname: string) =>
  pathname + conditionalString(!pathname.endsWith('/') && '/');

const isEndpointOf = (current: URL, endpoint: URL) => {
  // Make sure current pathname fragments start with endpoint's
  return (
    current.origin === endpoint.origin &&
    normalizePathname(current.pathname).startsWith(normalizePathname(endpoint.pathname))
  );
};

const matchDomainBasedTenantId = (pattern: URL, url: URL) => {
  const toMatch = pattern.hostname.replace('*', '([^.]*)');
  const matchedId = new RegExp(toMatch).exec(url.hostname)?.[1];

  if (!matchedId || matchedId === '*') {
    return;
  }

  if (isEndpointOf(url, getTenantEndpoint(matchedId, EnvSet.values))) {
    return matchedId;
  }
};

/**
 * Match tenant-based routing pattern: /t/{tenantId}/...
 * This is used for path-based multi-tenancy to distinguish from custom domain routing.
 */
const matchTenantBasedRouting = (url: URL) => {
  const pathSegments = url.pathname.split('/').filter(Boolean);
  
  // Check if the path starts with 't' and has at least 2 segments: ['t', tenantId, ...]
  if (pathSegments.length >= 2 && pathSegments[0] === 't') {
    const tenantId = pathSegments[1];
    
    // Exclude reserved paths that shouldn't be treated as tenant IDs
    if (tenantId === 'api' || tenantId === 'oidc' || tenantId === '.well-known') {
      return;
    }
    
    return tenantId;
  }
  
  return undefined;
};

const matchPathBasedTenantId = (urlSet: UrlSet, url: URL) => {
  const found = urlSet.deduplicated().find((value) => isEndpointOf(url, value));

  if (!found) {
    return;
  }

  const urlSegments = url.pathname.split('/');
  const endpointSegments = found.pathname.split('/');

  const potentialTenantId = urlSegments[found.pathname === '/' ? 1 : endpointSegments.length];
  
  // Exclude reserved paths that shouldn't be treated as tenant IDs
  if (potentialTenantId === 'api' || potentialTenantId === 'oidc' || potentialTenantId === '.well-known') {
    return;
  }

  return potentialTenantId;
};

/**
 * Match management API tenant routing pattern: /m/{tenantId}/api/...
 * This supports both cloud and OSS environments.
 */
const matchManagementApiTenantId = (url: URL) => {
  const pathSegments = url.pathname.split('/').filter(Boolean);
  
  // Check if the path starts with 'm' and has at least 3 segments: ['m', tenantId, 'api', ...]
  if (pathSegments.length >= 3 && pathSegments[0] === 'm' && pathSegments[2] === 'api') {
    return pathSegments[1];
  }
  
  return undefined;
};



const cacheKey = 'custom-domain';
const getDomainCacheKey = (url: URL | string) =>
  `${cacheKey}:${typeof url === 'string' ? url : url.hostname}`;

export const clearCustomDomainCache = async (url: URL | string) => {
  await trySafe(async () => redisCache.delete(getDomainCacheKey(url)));
};

/**
 * Get tenant ID from the custom domain URL.
 */
const getTenantIdFromCustomDomain = async (
  url: URL,
  pool: CommonQueryMethods
): Promise<string | undefined> => {
  const cachedValue = await trySafe(async () => redisCache.get(getDomainCacheKey(url)));

  if (cachedValue) {
    return cachedValue;
  }

  const { findActiveDomain } = createDomainsQueries(pool);

  const domain = await findActiveDomain(url.hostname);

  if (domain?.tenantId) {
    await trySafe(async () => redisCache.set(getDomainCacheKey(url), domain.tenantId));
  }

  return domain?.tenantId;
};

/**
 * Get tenant ID from the current request's URL.
 *
 * @param url The current request's URL
 * @returns The tenant ID and whether the URL is a custom domain
 */
export const getTenantId = async (
  url: URL
): Promise<[tenantId: string | undefined, isCustomDomain: boolean]> => {
  const {
    values: {
      isProduction,
      isIntegrationTest,
      developmentTenantId,
      urlSet,
      adminUrlSet,
      isCloud,
    },
    sharedPool,
  } = EnvSet;
  const pool = await sharedPool;

  // Management API tenant routing check - only apply on admin endpoints
  // Pattern: /m/{tenantId}/api/...
  // These requests should be handled by the TARGET TENANT!
  const managementApiTenantId = matchManagementApiTenantId(url);
  if (managementApiTenantId && adminUrlSet.deduplicated().some((endpoint) => isEndpointOf(url, endpoint))) {
    debugConsole.warn(`Found management API pattern for tenant ${managementApiTenantId}, routing to target tenant.`);
    return [managementApiTenantId, false];
  }

  // Admin tenant check
  if (adminUrlSet.deduplicated().some((endpoint) => isEndpointOf(url, endpoint))) {
    return [adminTenantId, false];
  }



  // Development tenant check
  if ((!isProduction || isIntegrationTest) && developmentTenantId) {
    debugConsole.warn(`Found dev tenant ID ${developmentTenantId}.`);
    return [developmentTenantId, false];
  }

  // Multi-tenancy routing - enable by default for local OSS environments
  if (!isCloud) {
    // Local OSS: Enhanced multi-tenancy with proper routing order
    
    // 1. First, check for tenant-based routing pattern: /t/{tenantId}/...
    // This takes precedence to distinguish from custom domain routing
    const tenantBasedTenantId = matchTenantBasedRouting(url);
    if (tenantBasedTenantId) {
      // Security: Prevent admin tenant access via tenant-based routing on regular servers
      if (tenantBasedTenantId === adminTenantId) {
        debugConsole.warn(`Blocked admin tenant access via tenant-based routing on regular server: ${url.toString()}`);
        return [undefined, false];
      }
      return [tenantBasedTenantId, false];
    }

    // 2. Then, try custom domain matching
    const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
    if (customDomainTenantId) {
      // Security: Prevent admin tenant access via custom domain on regular servers
      if (customDomainTenantId === adminTenantId) {
        debugConsole.warn(`Blocked admin tenant access via custom domain on regular server: ${url.toString()}`);
        return [undefined, false];
      }
      return [customDomainTenantId, true];
    }

    // 3. For direct API access without tenant prefix, use default tenant
    // This handles requests like /api/... or /oidc/... 
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oidc/') || url.pathname.startsWith('/.well-known/')) {
      return [defaultTenantId, false];
    }

    // 4. For sign-in experience routes without tenant prefix, use default tenant
    // This handles requests like /sign-in?preview=true
    if (url.pathname.startsWith('/sign-in') || url.pathname.startsWith('/register') || url.pathname.startsWith('/forgot-password') || url.pathname === '/') {
      return [defaultTenantId, false];
    }

    // 5. No tenant found
    return [defaultTenantId, false];
  }

  // Cloud environment: Use original cloud logic
  const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
  if (customDomainTenantId) {
    // Security: Prevent admin tenant access via custom domain in cloud too
    if (customDomainTenantId === adminTenantId) {
      debugConsole.warn(`Blocked admin tenant access via custom domain in cloud: ${url.toString()}`);
      return [undefined, false];
    }
    return [customDomainTenantId, true];
  }

  // Cloud fallback: domain-based or path-based depending on configuration
  const { isPathBasedMultiTenancy } = EnvSet.values;
  if (isPathBasedMultiTenancy) {
    const pathBasedTenantId = matchPathBasedTenantId(urlSet, url);
    // Security: Prevent admin tenant access via path-based routing in cloud too
    if (pathBasedTenantId === adminTenantId) {
      debugConsole.warn(`Blocked admin tenant access via path-based routing in cloud: ${url.toString()}`);
      return [undefined, false];
    }
    return [pathBasedTenantId, false];
  }

  return [matchDomainBasedTenantId(urlSet.endpoint, url), false];
};
