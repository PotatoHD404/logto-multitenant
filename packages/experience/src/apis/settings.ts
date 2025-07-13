/**
 * Used to get and general sign-in experience settings.
 * The API will be deprecated in the future once SSR is implemented.
 */

import type { LanguageInfo } from '@logto/schemas';
import { conditionalString } from '@silverhand/essentials';

import type { SignInExperienceResponse } from '@/types';
import { searchKeys } from '@/utils/search-parameters';

import { createTenantApi } from './api';

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

// A simple camelCase utility to prevent the need to add a dependency.
const camelCase = (string: string): string =>
  string.replaceAll(
    /_([^_])([^_]*)/g,
    (_, letter: string, rest: string) => letter.toUpperCase() + rest.toLowerCase()
  );

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

export const getTermsOfUse = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  return api.get('/api/.well-known/terms-of-use').json<LanguageInfo[]>();
};

export const getPrivacyPolicy = async (tenantId?: string) => {
  const api = createTenantApi(tenantId);
  return api.get('/api/.well-known/privacy-policy').json<LanguageInfo[]>();
};
