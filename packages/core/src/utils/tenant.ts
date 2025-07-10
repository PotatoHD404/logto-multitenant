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
      isMultiTenancy,
      isPathBasedMultiTenancy,
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

  if (adminUrlSet.deduplicated().some((endpoint) => isEndpointOf(url, endpoint))) {
    return [adminTenantId, false];
  }

  if ((!isProduction || isIntegrationTest) && developmentTenantId) {
    debugConsole.warn(`Found dev tenant ID ${developmentTenantId}.`);

    return [developmentTenantId, false];
  }

  if (!isMultiTenancy) {
    return [defaultTenantId, false];
  }

  // For local OSS, implement hybrid routing:
  // 1. First try custom domain matching
  // 2. If no custom domain found, fall back to path-based routing
  if (!isCloud) {
    // Always try custom domain first in local OSS
    const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);

    if (customDomainTenantId) {
      return [customDomainTenantId, true];
    }

    // If no custom domain found, fall back to path-based routing for non-admin tenants
    // This allows URLs like /tenant/tenant-id/... to work
    const pathBasedTenantId = matchPathBasedTenantId(urlSet, url);
    
    if (pathBasedTenantId) {
      return [pathBasedTenantId, false];
    }

    // If neither custom domain nor path-based matching worked, return undefined
    return [undefined, false];
  }

  // For cloud environments, use the original logic
  if (isPathBasedMultiTenancy) {
    return [matchPathBasedTenantId(urlSet, url), false];
  }

  const customDomainTenantId = await getTenantIdFromCustomDomain(url, pool);

  if (customDomainTenantId) {
    return [customDomainTenantId, true];
  }

  return [matchDomainBasedTenantId(urlSet.endpoint, url), false];
};
