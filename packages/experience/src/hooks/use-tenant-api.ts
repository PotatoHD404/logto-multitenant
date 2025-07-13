import i18next from 'i18next';
import ky from 'ky';
import { useMemo } from 'react';

import useTenantId from './use-tenant-id';

/**
 * Hook that provides a tenant-aware API client.
 * When in path-based multi-tenancy mode (/t/{tenantId}/...), it prefixes API calls with the tenant path.
 * Otherwise, it uses the standard API paths.
 */
const useTenantApi = () => {
  const tenantId = useTenantId();

  return useMemo(() => {
    const baseUrl = tenantId ? `/t/${tenantId}` : '';

    return ky.extend({
      prefixUrl: baseUrl,
      hooks: {
        beforeRequest: [
          (request) => {
            request.headers.set('Accept-Language', i18next.language);
          },
        ],
      },
    });
  }, [tenantId]);
};

export default useTenantApi; 