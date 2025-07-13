import { InteractionEvent } from '@logto/schemas';

import { createTenantApi } from '../api';

import { createTenantExperienceApiRoutes, type VerificationResponse } from './const';

type InteractionPayload = {
  interactionEvent: InteractionEvent;
  verificationId?: string;
  context?: Record<string, unknown>;
  captchaToken?: string;
};

type SubmitInteractionPayload = {
  verificationId: string;
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
  
  return api.put(routes.prefix, {
    json: {
      interactionEvent,
    },
  });
};

export const identifyUser = async (payload: InteractionPayload, tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api
    .put(routes.identification, {
      json: payload,
    })
    .json<VerificationResponse>();
};

export const submitInteraction = async (payload: SubmitInteractionPayload, tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api
    .post(routes.submit, {
      json: payload,
    })
    .json<{ redirectTo: string }>();
};

export const identifyAndSubmitInteraction = async (
  payload: SubmitInteractionPayload,
  tenantId?: string
) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api
    .post(routes.identification, {
      json: payload,
    })
    .json<{ redirectTo: string }>();
};

export const updateProfile = async (payload: Record<string, unknown>, tenantId?: string) => {
  const api = createTenantApi(tenantId);
  const routes = createTenantExperienceApiRoutes(tenantId);
  
  return api.patch(routes.profile, {
    json: payload,
  });
};
