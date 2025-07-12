import type React from 'react';
import { useMemo } from 'react';
import type { SWRConfig } from 'swr';

import { shouldRetryOnError } from '@/utils/request';

import { useAdminApi } from './use-api';
import useSwrFetcher from './use-swr-fetcher';

const useSwrOptions = (): Partial<React.ComponentProps<typeof SWRConfig>['value']> => {
  // Use admin API for console management operations - this ensures proper cross-tenant routing
  // for all management APIs (applications, connectors, sign-in experience, etc.)
  const api = useAdminApi();
  const fetcher = useSwrFetcher(api);

  const config = useMemo(
    () => ({
      fetcher,
      shouldRetryOnError: shouldRetryOnError({ ignore: [401, 403] }),
    }),
    [fetcher]
  );
  return config;
};

export default useSwrOptions;
