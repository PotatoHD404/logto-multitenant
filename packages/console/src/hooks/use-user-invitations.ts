import { type OrganizationInvitationStatus } from '@logto/schemas';
import { type Optional } from '@silverhand/essentials';
import { useMemo } from 'react';
import useSWR from 'swr';

import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type InvitationListResponse } from '@/cloud/types/router';
import { isCloud } from '@/consts/env';

import { type RequestError } from './use-api';

/**
 *
 * @param status Filter invitations by status
 * @returns The invitations with tenant info, error, and loading status.
 */
const useUserInvitations = (
  status?: OrganizationInvitationStatus
): {
  data: Optional<InvitationListResponse>;
  error: Optional<RequestError>;
  isLoading: boolean;
} => {
  const cloudApi = useCloudApi({ hideErrorToast: true });
  const { data, isLoading, error } = useSWR<InvitationListResponse, RequestError>(
    isCloud ? `/api/invitations}` : null,
    async () => cloudApi.get('/api/invitations')
  );

  // Filter invitations by given status
  const filteredResult = useMemo(
    () => (status ? data?.filter((invitation) => status === invitation.status) : data),
    [data, status]
  );

  return {
    data: isCloud ? filteredResult : [],
    error: isCloud ? error : undefined,
    isLoading: isCloud ? isLoading : false,
  };
};

export default useUserInvitations;
