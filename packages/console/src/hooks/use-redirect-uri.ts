import { ossConsolePath } from '@logto/schemas';
import { conditionalArray, joinPath } from '@silverhand/essentials';
import { useContext, useMemo } from 'react';
import { useHref } from 'react-router-dom';

import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';

/**
 * The hook that returns the absolute URL for the sign-in or sign-out callback.
 * The path is not related to react-router, which means the path will also include
 * the basename of react-router if it's set.
 */
const useRedirectUri = (flow: 'signIn' | 'signOut' = 'signIn') => {
  const { currentTenantId } = useContext(TenantsContext);
  
  const path = useHref(
    joinPath(
      ...conditionalArray(
        !isCloud && ossConsolePath,
        // For signIn callback, always use /callback (pre-tenant flow)
        // For signOut, use tenant-independent path to avoid dynamic tenant ID issues
        // The console routing will handle redirecting to the appropriate tenant
        !isCloud && flow === 'signOut' && currentTenantId,
        flow === 'signIn' ? 'callback' : ''
      )
    )
  );
  
  // For OSS, use tenant-independent paths for both sign-in and sign-out
  // This avoids the issue of needing to pre-register all possible tenant IDs
  const finalPath = !isCloud ? 
    (flow === 'signIn' ? `${ossConsolePath}/callback` : `${ossConsolePath}/admin`) : 
    path;
  
  const url = useMemo(() => new URL(finalPath, window.location.origin), [finalPath]);

  return url;
};

export default useRedirectUri;
