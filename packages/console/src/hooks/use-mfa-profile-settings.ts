import { useContext } from 'react';

import { isCloud } from '@/consts/env';
import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';

/**
 * Hook to check if MFA is enabled for the admin user's profile management.
 * 
 * For the admin profile page, MFA is available if:
 * 1. MFA is enabled in the subscription quota (Cloud) or always enabled (OSS)
 * 
 * Note: We don't check tenant MFA policy here since this is the admin's personal profile,
 * and admins should be able to manage their own MFA regardless of tenant policy.
 */
const useMfaProfileSettings = () => {
  const {
    currentSubscriptionQuota: { mfaEnabled },
  } = useContext(SubscriptionDataContext);
  
  // For OSS, MFA is always enabled. For Cloud, check subscription quota
  const isMfaAvailableForUser = !isCloud || mfaEnabled;
  
  return {
    isLoading: false,
    error: null,
    isMfaAvailableForUser,
  };
};

export default useMfaProfileSettings; 