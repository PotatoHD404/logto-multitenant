import {
  type InteractionEvent,
  type IdentificationApiPayload,
  type UpdateProfileApiPayload,
} from '@logto/schemas';

import { createTenantApi } from '../api';

import { createTenantExperienceApiRoutes, type VerificationResponse } from './const';

type SubmitInteractionResponse = {
  redirectTo: string;
};

export const initInteraction = async (
  interactionEvent: InteractionEvent,
  captchaToken?: string,
  tenantId?: string
) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.put(routes.prefix, {
    json: {
      interactionEvent,
      captchaToken,
    },
  });
};

export const updateInteractionEvent = async (
  interactionEvent: InteractionEvent,
  tenantId?: string
) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.put(`${routes.prefix}/interaction-event`, {
    json: {
      interactionEvent,
    },
  });
};

export const identifyUser = async (payload: IdentificationApiPayload = {}, tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.post(routes.identification, { json: payload });
};

export const submitInteraction = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.post(routes.submit).json<SubmitInteractionResponse>();
};

export const identifyAndSubmitInteraction = async (payload?: IdentificationApiPayload, tenantId?: string) => {
  await identifyUser(payload, tenantId);
  return submitInteraction(tenantId);
};

export const updateProfile = async (payload: UpdateProfileApiPayload, tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.post(routes.profile, { json: payload });
};
