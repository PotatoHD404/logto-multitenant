import {
  buildOrganizationUrn,
  getOrganizationIdFromUrn,
  httpCodeToMessage,
  organizationUrnPrefix,
} from '@logto/core-kit';
import { type LogtoErrorCode } from '@logto/phrases';
import { useLogto } from '@logto/react';
import {
  getTenantOrganizationId,
  type RequestErrorBody,
  getManagementApiResourceIndicator,
  defaultTenantId,
  adminTenantId,
} from '@logto/schemas';
import { appendPath, conditionalArray } from '@silverhand/essentials';
import ky from 'ky';
import { type KyInstance } from 'node_modules/ky/distribution/types/ky';
import { useCallback, useContext, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { requestTimeout } from '@/consts';
import { isCloud } from '@/consts/env';
import { AppDataContext } from '@/contexts/AppDataProvider';
import { SubscriptionDataContext } from '@/contexts/SubscriptionDataProvider';
import { TenantsContext } from '@/contexts/TenantsProvider';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import useRedirectUri from '@/hooks/use-redirect-uri';

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: RequestErrorBody
  ) {
    super('Request error occurred.');
  }
}

export type StaticApiProps = {
  prefixUrl?: URL;
  hideErrorToast?: boolean | LogtoErrorCode[];
  resourceIndicator: string;
  timeout?: number;
  signal?: AbortSignal;
};

const useGlobalRequestErrorHandler = (toastDisabledErrorCodes?: LogtoErrorCode[]) => {
  const { signOut } = useLogto();
  const { show } = useConfirmModal();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  const postSignOutRedirectUri = useRedirectUri('signOut');

  const handleError = useCallback(
    async (response: Response) => {
      const fallbackErrorMessage = t('errors.unknown_server_error');

      try {
        // Clone the response to avoid "Response body is already used".
        const data = await response.clone().json<RequestErrorBody>();

        // This is what will happen when the user still has the legacy refresh token without
        // organization scope. We should sign them out and redirect to the sign in page.
        // TODO: This is a temporary solution to prevent the user from getting stuck in Console,
        // which can be removed after all legacy refresh tokens are expired, i.e. after Jan 10th,
        // 2024.
        if (response.status === 403 && data.message === 'Insufficient permissions.') {
          await signOut(postSignOutRedirectUri.href);
          return;
        }

        // Inform and redirect un-authorized users to sign in page.
        if (data.code === 'auth.forbidden') {
          await show({
            ModalContent: data.message,
            type: 'alert',
            cancelButtonText: 'general.got_it',
          });

          await signOut(postSignOutRedirectUri.href);
          return;
        }

        // Handle JWT verification failures and other unauthorized errors
        if (data.code === 'auth.unauthorized') {
          await signOut(postSignOutRedirectUri.href);
          return;
        }

        // Skip showing toast for specific error codes.
        if (toastDisabledErrorCodes?.includes(data.code)) {
          return;
        }

        toast.error([data.message, data.details].join('\n') || fallbackErrorMessage);
      } catch {
        toast.error(httpCodeToMessage[response.status] ?? fallbackErrorMessage);
      }
    },
    [t, toastDisabledErrorCodes, signOut, postSignOutRedirectUri.href, show]
  );

  return {
    handleError,
  };
};

/**
 *
 * @param {StaticApiProps} props
 * @param {URL} props.prefixUrl  The base URL for the API.
 * @param {boolean} props.hideErrorToast  Whether to disable the global error handling.
 * @param {string} props.resourceIndicator  The resource indicator for the API. Used by the Logto SDK to validate the access token.
 *
 * @returns
 */
export const useStaticApi = ({
  prefixUrl,
  hideErrorToast,
  resourceIndicator,
  timeout = requestTimeout,
  signal,
}: StaticApiProps): KyInstance => {
  const { isAuthenticated, getAccessToken, getOrganizationToken } = useLogto();
  const { i18n } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { mutateSubscriptionQuotaAndUsages } = useContext(SubscriptionDataContext);

  // Disable global error handling if `hideErrorToast` is true.
  const disableGlobalErrorHandling = hideErrorToast === true;
  // Disable toast for specific error codes.
  const toastDisabledErrorCodes = Array.isArray(hideErrorToast) ? hideErrorToast : undefined;

  const { handleError } = useGlobalRequestErrorHandler(toastDisabledErrorCodes);

  const api = useMemo(
    () =>
      ky.create({
        prefixUrl,
        timeout,
        signal,
        hooks: {
          beforeError: conditionalArray(
            !disableGlobalErrorHandling &&
              (async (error) => {
                await handleError(error.response);
                return error;
              })
          ),
          beforeRequest: [
            async (request) => {
              if (isAuthenticated) {
                const accessToken = await (resourceIndicator.startsWith(organizationUrnPrefix)
                  ? getOrganizationToken(getOrganizationIdFromUrn(resourceIndicator))
                  : getAccessToken(resourceIndicator));
                request.headers.set('Authorization', `Bearer ${accessToken ?? ''}`);
                request.headers.set('Accept-Language', i18n.language);
              }
            },
          ],
          afterResponse: [
            async (request, _options, response) => {
              if (
                isCloud &&
                isAuthenticated &&
                ['POST', 'PUT', 'DELETE'].includes(request.method) &&
                response.status >= 200 &&
                response.status < 300
              ) {
                mutateSubscriptionQuotaAndUsages();
              }
            },
          ],
        },
      }),
    [
      prefixUrl,
      timeout,
      signal,
      disableGlobalErrorHandling,
      handleError,
      isAuthenticated,
      resourceIndicator,
      getOrganizationToken,
      getAccessToken,
      i18n.language,
      mutateSubscriptionQuotaAndUsages,
    ]
  );

  return api;
};

/** A hook to get a Ky instance with the current tenant's Management API prefix URL. */
const useApi = (props: Omit<StaticApiProps, 'prefixUrl' | 'resourceIndicator'> = {}) => {
  const { tenantEndpoint } = useContext(AppDataContext);
  const { currentTenantId } = useContext(TenantsContext);

  /**
   * The config object for the Ky instance.
   *
   * - In Cloud, it uses the Management API proxy endpoint with tenant organization tokens.
   * - In OSS, it supports both domain-based and path-based multi-tenancy:
   *   - Domain-based: custom.localhost/api/connectors
   *   - Path-based: localhost/api/{tenantId}/connectors
   */
  const config = useMemo(() => {
    // If no tenant ID is available (e.g., on reserved routes like profile),
    // fall back to the default tenant organization for OSS
    if (!currentTenantId) {
      if (isCloud) {
        throw new Error('Tenant ID is required for cloud environments');
      }
      const organizationId = getTenantOrganizationId(defaultTenantId);
      return {
        prefixUrl: appendPath(tenantEndpoint ?? new URL(window.location.origin), '/api'),
        resourceIndicator: buildOrganizationUrn(organizationId),
      };
    }

    if (isCloud) {
      return {
        prefixUrl: appendPath(new URL(window.location.origin), 'm', currentTenantId),
        resourceIndicator: buildOrganizationUrn(getTenantOrganizationId(currentTenantId)),
      };
    }

    // For OSS, use the /m/{tenantId}/api pattern that matches the server routing
    return {
      prefixUrl: appendPath(new URL(window.location.origin), 'm', currentTenantId),
      resourceIndicator: buildOrganizationUrn(getTenantOrganizationId(currentTenantId)),
    };
  }, [currentTenantId, tenantEndpoint]);

  return useStaticApi({
    ...props,
    ...config,
  });
};

export default useApi;

/**
 * A hook to get a Ky instance specifically for tenant management operations.
 * Uses tenant-specific routing (/m/{tenantId}/api/...) for cross-tenant admin operations.
 * This properly uses organization tokens for the specific tenant being managed.
 */
export const useAdminApi = (
  tenantId?: string,
  props: Omit<StaticApiProps, 'prefixUrl' | 'resourceIndicator'> = {}
) => {
  const { currentTenantId } = useContext(TenantsContext);

  const config = useMemo(() => {
    const targetTenantId = tenantId ?? currentTenantId ?? defaultTenantId;

    // Use the organization token for the specific tenant being managed
    // Each tenant has a corresponding organization t-{tenantId} in the admin tenant
    // The user must have proper permissions in that organization
    const targetTenantOrganizationId = getTenantOrganizationId(targetTenantId);

    // Both Cloud and OSS use the same /m/{tenantId}/api pattern
    // The console server handles the proxying to the core API
    return {
      prefixUrl: appendPath(new URL(window.location.origin), 'm', targetTenantId),
      resourceIndicator: buildOrganizationUrn(targetTenantOrganizationId),
    };
  }, [tenantId, currentTenantId]);

  return useStaticApi({
    ...props,
    ...config,
  });
};

/**
 * A hook to get a Ky instance for cross-tenant management operations.
 * Uses management API tokens for operations like listing all tenants, creating tenants, etc.
 * These operations are available directly at /api/tenants on the admin port.
 */
export const useCrossTenantApi = (
  tenantId: string = adminTenantId,
  props: Omit<StaticApiProps, 'prefixUrl' | 'resourceIndicator'> = {}
) => {
  const config = useMemo(
    () => ({
      // Cross-tenant operations are available directly at /api/... on the admin port
      // These use management API tokens, not organization tokens
      prefixUrl: appendPath(new URL(window.location.origin), 'api'),
      // Use management API resource indicator for cross-tenant operations
      resourceIndicator: getManagementApiResourceIndicator(tenantId),
    }),
    [tenantId]
  );

  return useStaticApi({
    ...props,
    ...config,
  });
};
