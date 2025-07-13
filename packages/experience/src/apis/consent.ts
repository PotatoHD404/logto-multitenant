import { type ConsentInfoResponse } from '@logto/schemas';

import { createTenantApi } from './api';

export const consent = async (organizationId?: string, tenantId?: string) => {
  type Response = {
    redirectTo: string;
  };

  const api = createTenantApi(tenantId);

  return api
    .post('/api/interaction/consent', {
      json: {
        organizationIds: organizationId && [organizationId],
      },
    })
    .json<Response>();
};

export const getConsentInfo = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  
  return api.get('/api/interaction/consent').json<ConsentInfoResponse>();
};
