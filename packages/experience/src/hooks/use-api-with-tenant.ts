import { useCallback, useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';

import useTenantId from './use-tenant-id';
import useApi from './use-api';

type TenantAwareApiFunction<Args extends unknown[], Response> = 
  (tenantId?: string) => (...args: Args) => Promise<Response>;

/**
 * Hook that wraps an API function to automatically use the current tenant ID.
 * This ensures that all API calls use the correct tenant path when in path-based multi-tenancy mode.
 * 
 * @param api - The tenant-aware API function that accepts tenantId as its first parameter
 * @returns The API function with tenant ID automatically injected
 */
const useApiWithTenant = <Args extends unknown[], Response>(
  api: TenantAwareApiFunction<Args, Response>
) => {
  const tenantId = useTenantId();
  const { setLoading } = useContext(PageContext);
  
  const apiWithTenant = useCallback(
    api(tenantId),
    [api, tenantId]
  );

  const request = useCallback(
    async (...args: Args): Promise<[unknown | null, Response?]> => {
      setLoading(true);

      try {
        const result = await apiWithTenant(...args);
        return [null, result];
      } catch (error: unknown) {
        return [error];
      } finally {
        setLoading(false);
      }
    },
    [apiWithTenant, setLoading]
  );

  return request;
};

export default useApiWithTenant; 