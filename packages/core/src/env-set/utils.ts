import path from 'node:path';

import { adminTenantId } from '@logto/schemas';
import type { GlobalValues } from '@logto/shared';
import type { Optional } from '@silverhand/essentials';
import { deduplicate, trySafe } from '@silverhand/essentials';

export const getTenantEndpoint = (
  id: string,
  { urlSet, adminUrlSet, isDomainBasedMultiTenancy, isPathBasedMultiTenancy }: GlobalValues
): URL => {
  const adminUrl = trySafe(() => adminUrlSet.endpoint);

  if (adminUrl && id === adminTenantId) {
    return adminUrl;
  }

  if (isPathBasedMultiTenancy) {
    return new URL(path.join(urlSet.endpoint.pathname, id), urlSet.endpoint);
  }

  if (!isDomainBasedMultiTenancy) {
    return urlSet.endpoint;
  }

  const tenantUrl = new URL(urlSet.endpoint);
  // eslint-disable-next-line @silverhand/fp/no-mutation
  tenantUrl.hostname = tenantUrl.hostname.replace('*', id);

  return tenantUrl;
};

const getTenantLocalhost = (
  id: string,
  { urlSet, adminUrlSet, isDomainBasedMultiTenancy, isPathBasedMultiTenancy }: GlobalValues
): Optional<URL> => {
  const adminUrl = trySafe(() => adminUrlSet.localhostUrl);

  if (adminUrl && id === adminTenantId) {
    return adminUrl;
  }

  const localhost = trySafe(() => urlSet.localhostUrl);

  if (isPathBasedMultiTenancy && localhost) {
    return new URL(path.join(localhost.pathname, id), localhost);
  }

  if (!isDomainBasedMultiTenancy) {
    return localhost;
  }
};

export const getTenantUrls = (id: string, globalValues: GlobalValues): URL[] => {
  const endpoint = getTenantEndpoint(id, globalValues);
  const localhost = getTenantLocalhost(id, globalValues);

  return deduplicate(
    [endpoint.toString(), localhost?.toString()].filter(
      (value): value is string => typeof value === 'string'
    )
  ).map((element) => new URL(element));
};

/**
 * Get tenant URLs including custom domains from the database.
 * This function extends getTenantUrls to include active custom domains.
 */
export const getTenantUrlsWithCustomDomains = async (
  id: string,
  globalValues: GlobalValues,
  queries?: { domains: { findAllDomains: () => Promise<Array<{ domain: string; status: string }>> } }
): Promise<URL[]> => {
  const baseUrls = getTenantUrls(id, globalValues);
  
  // If no queries provided or not in cloud environment, return base URLs
  if (!queries || !globalValues.isCloud) {
    return baseUrls;
  }

  try {
    const domains = await queries.domains.findAllDomains();
    const activeCustomDomains = domains
      .filter((domain) => domain.status === 'Active')
      .map((domain) => new URL(`https://${domain.domain}`));

    return deduplicate([...baseUrls, ...activeCustomDomains]);
  } catch (error) {
    // If there's an error fetching custom domains, fall back to base URLs
    console.warn('Failed to fetch custom domains:', error);
    return baseUrls;
  }
};
