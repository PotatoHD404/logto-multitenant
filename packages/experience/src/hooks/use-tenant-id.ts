import { useParams } from 'react-router-dom';

/**
 * Hook to extract tenant ID from the URL path when in path-based multi-tenancy mode.
 * Returns the tenant ID if present in the URL path (e.g., /t/{tenantId}/...), undefined otherwise.
 */
const useTenantId = () => {
  const params = useParams<{ tenantId?: string }>();
  return params.tenantId;
};

export default useTenantId; 