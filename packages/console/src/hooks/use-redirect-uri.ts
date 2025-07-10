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
        // For signOut, include tenant ID if available (post-tenant flow)
        !isCloud && flow === 'signOut' && currentTenantId,
        flow === 'signIn' ? 'callback' : ''
      )
    )
  );
  
  // For OSS sign-in callback, ensure we always use /console/callback regardless of current route
  const finalPath = !isCloud && flow === 'signIn' ? `${ossConsolePath}/callback` : path;
  
  const url = useMemo(() => new URL(finalPath, window.location.origin), [finalPath]);

  return url;
};

export default useRedirectUri;
