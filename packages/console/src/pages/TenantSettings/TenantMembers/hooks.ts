import { useContext, useMemo } from 'react';

import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';

const useTenantMembersUsage = () => {
  const {
    currentSubscriptionUsage,
    currentSubscriptionQuota,
    hasReachedSubscriptionQuotaLimit,
    hasSurpassedSubscriptionQuotaLimit,
  } = useContext(SubscriptionDataContext);

  const usage = useMemo(() => {
    return currentSubscriptionUsage.tenantMembersLimit;
  }, [currentSubscriptionUsage.tenantMembersLimit]);

  const hasTenantMembersReachedLimit = hasReachedSubscriptionQuotaLimit('tenantMembersLimit');

  const hasTenantMembersSurpassedLimit = hasSurpassedSubscriptionQuotaLimit('tenantMembersLimit');

  return {
    hasTenantMembersReachedLimit,
    hasTenantMembersSurpassedLimit,
    usage,
    limit: currentSubscriptionQuota.tenantMembersLimit ?? Number.POSITIVE_INFINITY,
  };
};

// Removed unused export - hook is not used anywhere
// export default useTenantMembersUsage;
