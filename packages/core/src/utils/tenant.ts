import { adminTenantId } from '@logto/schemas';
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

const matchPathBasedTenantId = (urlSet: UrlSet, url: URL) => {
  const found = urlSet.deduplicated().find((value) => isEndpointOf(url, value));

  if (!found) {
    return;
  }

  const urlSegments = url.pathname.split('/');
  const endpointSegments = found.pathname.split('/');

  const potentialTenantId = urlSegments[found.pathname === '/' ? 1 : endpointSegments.length];

  // Exclude reserved paths that shouldn't be treated as tenant IDs
  if (
    potentialTenantId === 'api' ||
    potentialTenantId === 'oidc' ||
    potentialTenantId === '.well-known'
  ) {
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
    values: { isProduction, isIntegrationTest, developmentTenantId, urlSet, adminUrlSet, isCloud },
    sharedPool,
  } = EnvSet;
  const pool = await sharedPool;

  // Management API tenant routing check
  const managementApiResult = checkManagementApiRouting(url, adminUrlSet);
  if (managementApiResult) {
    return managementApiResult;
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

  // Multi-tenancy is enabled by default
  // For local OSS: Support both custom domain AND path-based routing AND domain-based routing simultaneously
  // For cloud: Use original cloud logic
  if (!isCloud) {
    return handleLocalOssTenantRouting(url, pool, urlSet);
  }

  return handleCloudTenantRouting(url, pool, urlSet);
};

const checkManagementApiRouting = (
  url: URL,
  adminUrlSet: UrlSet
): [tenantId: string | undefined, isCustomDomain: boolean] | undefined => {
  // Management API tenant routing check
  // Pattern: /m/{tenantId}/api/...
  // These requests should ONLY be accessible on admin endpoints!
  const managementApiTenantId = matchManagementApiTenantId(url);
  if (managementApiTenantId) {
    const isOnAdminEndpoint = adminUrlSet
      .deduplicated()
      .some((endpoint) => isEndpointOf(url, endpoint));

    if (isOnAdminEndpoint) {
      // Allow management API access on admin endpoints
      debugConsole.warn(
        `Found management API pattern for tenant ${managementApiTenantId}, routing to target tenant.`
      );
      return [managementApiTenantId, false];
    }
    // Block management API access on non-admin endpoints
    debugConsole.warn(`Blocked management API pattern on non-admin endpoint: ${url.toString()}`);
    return [undefined, false];
  }
  return undefined;
};

const handleLocalOssTenantRouting = async (
  url: URL,
  pool: CommonQueryMethods,
  urlSet: UrlSet
): Promise<[tenantId: string | undefined, isCustomDomain: boolean]> => {
  // Local OSS: Hybrid multi-tenancy approach
  // 1. First try custom domain matching
  const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
  if (customDomainTenantId) {
    // Security: Prevent admin tenant access via custom domain on regular servers
    if (customDomainTenantId === adminTenantId) {
      debugConsole.warn(
        `Blocked admin tenant access via custom domain on regular server: ${url.toString()}`
      );
      return [undefined, false];
    }
    return [customDomainTenantId, true];
  }

  // 3. Try domain-based routing (extract tenant ID from subdomain)
  // First try standard domain-based matching (if endpoint has wildcard)
  const domainBasedTenantId = matchDomainBasedTenantId(urlSet.endpoint, url);
  if (domainBasedTenantId) {
    // Security: Prevent admin tenant access via domain-based routing on regular servers
    if (domainBasedTenantId === adminTenantId) {
      debugConsole.warn(
        `Blocked admin tenant access via domain-based routing on regular server: ${url.toString()}`
      );
      return [undefined, false];
    }
    return [domainBasedTenantId, false];
  }

  // 7. No tenant found
  return [undefined, false];
};

const handleCloudTenantRouting = async (
  url: URL,
  pool: CommonQueryMethods,
  urlSet: UrlSet
): Promise<[tenantId: string | undefined, isCustomDomain: boolean]> => {
  // Cloud environment: Use original cloud logic
  const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
  if (customDomainTenantId) {
    // Security: Prevent admin tenant access via custom domain in cloud too
    if (customDomainTenantId === adminTenantId) {
      debugConsole.warn(
        `Blocked admin tenant access via custom domain in cloud: ${url.toString()}`
      );
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
      debugConsole.warn(
        `Blocked admin tenant access via path-based routing in cloud: ${url.toString()}`
      );
      return [undefined, false];
    }
    return [pathBasedTenantId, false];
  }

  return [matchDomainBasedTenantId(urlSet.endpoint, url), false];
};
