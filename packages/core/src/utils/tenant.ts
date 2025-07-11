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

const matchPathBasedTenantId = (urlSet: UrlSet, url: URL) => {
  const found = urlSet.deduplicated().find((value) => isEndpointOf(url, value));

  if (!found) {
    return;
  }

  const urlSegments = url.pathname.split('/');
  const endpointSegments = found.pathname.split('/');

  return urlSegments[found.pathname === '/' ? 1 : endpointSegments.length];
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

  // Admin tenant check - always first priority
  if (adminUrlSet.deduplicated().some((endpoint) => isEndpointOf(url, endpoint))) {
    return [adminTenantId, false];
  }

  // Development tenant check
  if ((!isProduction || isIntegrationTest) && developmentTenantId) {
    debugConsole.warn(`Found dev tenant ID ${developmentTenantId}.`);
    return [developmentTenantId, false];
  }

  // Multi-tenancy is enabled by default
  // For local OSS: Support both custom domain AND path-based routing simultaneously
  // For cloud: Use original cloud logic
  if (!isCloud) {
    // Local OSS: Hybrid multi-tenancy approach
    // 1. First try custom domain matching
    const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
    if (customDomainTenantId) {
      return [customDomainTenantId, true];
    }

    // 2. Try path-based routing (works with default domain)
    const pathBasedTenantId = matchPathBasedTenantId(urlSet, url);
    if (pathBasedTenantId) {
      return [pathBasedTenantId, false];
    }

    // 3. For root requests on default domain, return default tenant
    if (url.origin === urlSet.endpoint.origin && url.pathname === '/') {
      return [defaultTenantId, false];
    }

    // 4. No tenant found
    return [undefined, false];
  }

  // Cloud environment: Use original cloud logic
  const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);
  if (customDomainTenantId) {
    return [customDomainTenantId, true];
  }

  // Cloud fallback: domain-based or path-based depending on configuration
  const { isPathBasedMultiTenancy } = EnvSet.values;
  if (isPathBasedMultiTenancy) {
    return [matchPathBasedTenantId(urlSet, url), false];
  }

  return [matchDomainBasedTenantId(urlSet.endpoint, url), false];
};
