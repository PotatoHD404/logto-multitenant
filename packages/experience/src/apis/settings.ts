/**
 * Used to get and general sign-in experience settings.
 * The API will be deprecated in the future once SSR is implemented.
 */

import type { LanguageInfo } from '@logto/schemas';
import { conditionalString } from '@silverhand/essentials';

import type { SignInExperienceResponse } from '@/types';

import { createTenantApi } from './api';

const searchKeys = Object.freeze({
  organizationId: 'organization_id',
  directSignIn: 'direct_sign_in',
  firstScreen: 'first_screen',
  identifier: 'identifier',
  socialConnectorId: 'social_connector_id',
  organizationInvitationId: 'organization_invitation_id',
  socialConnectorTarget: 'social_connector_target',
  ssoConnectorId: 'sso_connector_id',
} as const);

const buildSearchParameters = (data: Record<string, unknown>) => {
  const result = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    const parameterValue = conditionalString(value && String(value));

    if (parameterValue) {
      result.append(key, parameterValue);
    }
  }

  return result;
};

export const getSignInExperience = async <T extends SignInExperienceResponse>(
  tenantId?: string
): Promise<T> => {
  const api = createTenantApi(tenantId);
  
  return api
    .get('/api/.well-known/sign-in-exp', {
      searchParams: buildSearchParameters(
        Object.fromEntries(
          Object.values(searchKeys).map((key) => [camelCase(key), sessionStorage.getItem(key)])
        )
      ),
    })
    .json<T>();
};

export const getPhrases = async ({
  localLanguage,
  language,
  tenantId,
}: {
  localLanguage?: string;
  language?: string;
  tenantId?: string;
}) => {
  const api = createTenantApi(tenantId);
  
  return api
    .extend({
      hooks: {
        beforeRequest: [
          (request) => {
            if (localLanguage) {
              request.headers.set('Accept-Language', localLanguage);
            }
          },
        ],
      },
    })
    .get('/api/.well-known/phrases', {
      searchParams: buildSearchParameters({
        lng: language,
      }),
    });
};

function camelCase(string: string): string {
  return string.replaceAll(/_[a-z]/g, (match) => match[1]!.toUpperCase());
}

export const getTermsOfUse = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  return api.get('/api/.well-known/terms-of-use').json<LanguageInfo[]>();
};

export const getPrivacyPolicy = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  return api.get('/api/.well-known/privacy-policy').json<LanguageInfo[]>();
};
