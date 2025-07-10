import { type UserMfaVerificationResponse } from '@logto/schemas';
import useSWR from 'swr';

import { adminTenantEndpoint, meApi } from '@/consts';
import { type RequestError } from '@/hooks/use-api';
import { useStaticApi } from '@/hooks/use-api';
import useCurrentUser from '@/hooks/use-current-user';
import useSwrFetcher from '@/hooks/use-swr-fetcher';

/**
 * Hook to fetch the current user's MFA verifications.
 * This is for the profile page where users can manage their own MFA factors.
 */
const useCurrentUserMfa = () => {
  const { user } = useCurrentUser();
  const api = useStaticApi({ 
    prefixUrl: adminTenantEndpoint, 
    resourceIndicator: meApi.indicator 
  });
  const fetcher = useSwrFetcher<UserMfaVerificationResponse>(api);
  
  const { data: mfaVerifications, error, isLoading, mutate } = useSWR<
    UserMfaVerificationResponse,
    RequestError
  >(
    user?.id ? `my-account/mfa-verifications` : null,
    fetcher
  );
  
  const deleteMfaVerification = async (verificationId: string) => {
    if (!user?.id) {
      throw new Error('User ID not available');
    }
    await api.delete(`my-account/mfa-verifications/${verificationId}`);
    // Update the cache by removing the deleted verification
    if (mfaVerifications) {
      const updated = mfaVerifications.filter(verification => verification.id !== verificationId);
      void mutate(updated);
    }
  };
  
  return {
    mfaVerifications,
    error,
    isLoading,
    mutate,
    deleteMfaVerification,
  };
};

export default useCurrentUserMfa; 