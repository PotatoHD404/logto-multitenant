import { type SnakeCaseOidcConfig } from '@logto/schemas';
import { useContext } from 'react';
import useSWR from 'swr';

import { AppDataContext } from '@/contexts/AppDataProvider';
import { openIdProviderConfigPath } from '@/consts/oidc';

import { useStaticApi, type RequestError } from './use-api';
import useSwrFetcher from './use-swr-fetcher';

/**
 * Hook to fetch OIDC configuration from the correct tenant endpoint.
 * This avoids the issue where global SWR configuration uses management API patterns
 * which are not appropriate for OIDC endpoints.
 */
const useOidcConfig = () => {
  const { tenantEndpoint } = useContext(AppDataContext);
  
  // Use the tenant endpoint directly for OIDC configuration
  const oidcApi = useStaticApi({
    prefixUrl: tenantEndpoint || new URL(window.location.origin),
    resourceIndicator: '', // OIDC endpoints don't require authentication
  });
  
  const fetcher = useSwrFetcher<SnakeCaseOidcConfig>(oidcApi);
  
  return useSWR<SnakeCaseOidcConfig, RequestError>(openIdProviderConfigPath, fetcher);
};

export default useOidcConfig; 