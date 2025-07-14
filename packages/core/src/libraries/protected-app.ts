import {
  DomainStatus,
  type Application,
  type ProtectedAppMetadata,
  type CustomDomain,
} from '@logto/schemas';
import { isValidSubdomain } from '@logto/shared';

import { protectedAppSignInCallbackUrl } from '#src/constants/index.js';
import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import {
  defaultProtectedAppPageRules,
  defaultProtectedAppSessionDuration,
} from '#src/routes/applications/constants.js';
import type Queries from '#src/tenants/Queries.js';
import SystemContext from '#src/tenants/SystemContext.js';
import assertThat from '#src/utils/assert-that.js';
import {
  createCustomHostname,
  deleteCustomHostname,
  deleteProtectedAppSiteConfigs,
  getCustomHostname,
  getDomainStatusFromCloudflareData,
  getFallbackOrigin,
  updateProtectedAppSiteConfigs,
} from '#src/utils/cloudflare/index.js';
import { isSubdomainOf } from '#src/utils/domain.js';

export type ProtectedAppLibrary = ReturnType<typeof createProtectedAppLibrary>;

const getProviderConfig = async () => {
  const { protectedAppConfigProviderConfig } = SystemContext.shared;

  // For local OSS, if Cloudflare is not configured, return null
  if (!protectedAppConfigProviderConfig) {
    if (EnvSet.values.isCloud) {
      assertThat(false, 'application.protected_app_not_configured', 501);
    }
    return null;
  }

  return protectedAppConfigProviderConfig;
};

const getHostnameProviderConfig = async () => {
  const { protectedAppHostnameProviderConfig } = SystemContext.shared;

  // For local OSS, if Cloudflare is not configured, return null
  if (!protectedAppHostnameProviderConfig) {
    if (EnvSet.values.isCloud) {
      assertThat(false, 'domain.not_configured', 501);
    }
    return null;
  }

  return protectedAppHostnameProviderConfig;
};

const getDefaultDomain = async (): Promise<string> => {
  const providerConfig = await getProviderConfig();

  // For local OSS, return localhost as default domain
  if (!providerConfig) {
    return 'localhost:3001';
  }

  return providerConfig.domain;
};

const deleteRemoteAppConfigs = async (host: string): Promise<void> => {
  // Skip for integration test, we don't do third party call in integration test
  if (EnvSet.values.isIntegrationTest) {
    return;
  }

  const providerConfig = await getProviderConfig();

  // For local OSS, skip if Cloudflare is not configured
  if (!providerConfig) {
    return;
  }

  await deleteProtectedAppSiteConfigs(providerConfig, host);
};

/**
 * Build application data for protected app
 * check if subdomain is valid
 * generate host based on subdomain
 * generate default protectedAppMetadata based on host and origin
 * generate redirectUris and postLogoutRedirectUris based on host
 */
const buildProtectedAppData = async ({
  subDomain,
  origin,
}: {
  subDomain: string;
  origin: string;
}): Promise<Pick<Application, 'protectedAppMetadata' | 'oidcClientMetadata'>> => {
  assertThat(
    isValidSubdomain(subDomain),
    new RequestError({
      code: 'application.invalid_subdomain',
      status: 422,
    })
  );

  // Skip for integration test, use empty value instead
  const domain = EnvSet.values.isIntegrationTest ? '' : await getDefaultDomain();
  const host = `${subDomain}.${domain}`;

  return {
    protectedAppMetadata: {
      host,
      origin,
      sessionDuration: defaultProtectedAppSessionDuration,
      pageRules: defaultProtectedAppPageRules,
    },
    oidcClientMetadata: {
      redirectUris: [`https://${host}/${protectedAppSignInCallbackUrl}`],
      postLogoutRedirectUris: [`https://${host}`],
    },
  };
};

/**
 * Call Cloudflare API to add the domain (custom hostname) to the remote
 * and get the DNS records to be added to the DNS provider
 */
const addDomainToRemote = async (
  hostname: string
): Promise<NonNullable<ProtectedAppMetadata['customDomains']>[number]> => {
  const hostnameProviderConfig = await getHostnameProviderConfig();

  // For local OSS, if Cloudflare is not configured, return a mock domain
  if (!hostnameProviderConfig) {
    return {
      domain: hostname,
      cloudflareData: null,
      status: DomainStatus.Active, // Mark as active since no verification needed
      errorMessage: null,
      dnsRecords: [
        {
          type: 'A',
          name: hostname,
          value: '127.0.0.1', // Local development placeholder
        },
      ],
    };
  }

  const { blockedDomains } = hostnameProviderConfig;
  assertThat(
    !(blockedDomains ?? []).some(
      (domain) => hostname === domain || isSubdomainOf(hostname, domain)
    ),
    'domain.domain_is_not_allowed',
    422
  );

  const [fallbackOrigin, cloudflareData] = await Promise.all([
    getFallbackOrigin(hostnameProviderConfig),
    createCustomHostname(hostnameProviderConfig, hostname),
  ]);

  return {
    domain: hostname,
    cloudflareData,
    status: DomainStatus.PendingVerification,
    errorMessage: null,
    dnsRecords: [
      {
        type: 'CNAME',
        name: hostname,
        value: fallbackOrigin,
      },
    ],
  };
};

const deleteDomainFromRemote = async (id: string): Promise<void> => {
  const hostnameProviderConfig = await getHostnameProviderConfig();

  // For local OSS, skip if Cloudflare is not configured
  if (!hostnameProviderConfig) {
    return;
  }

  await deleteCustomHostname(hostnameProviderConfig, id);
};

export const createProtectedAppLibrary = (queries: Queries) => {
  const {
    applications: { findApplicationById, updateApplicationById },
  } = queries;

  const syncAppConfigsToRemote = async (applicationId: string): Promise<void> => {
    // Skip for integration test, we don't do third party call in integration test
    if (EnvSet.values.isIntegrationTest) {
      return;
    }

    const providerConfig = await getProviderConfig();

    // For local OSS, skip if Cloudflare is not configured
    if (!providerConfig) {
      return;
    }

    const { protectedAppMetadata, id, secret, tenantId } = await findApplicationById(applicationId);
    if (!protectedAppMetadata) {
      return;
    }

    const { customDomains, ...rest } = protectedAppMetadata;

    const siteConfigs = {
      ...rest,
      sdkConfig: {
        appId: id,
        appSecret: secret,
        endpoint: getTenantEndpoint(tenantId, EnvSet.values).origin,
      },
    };

    // Update default host (subdomain of the default domain)
    await updateProtectedAppSiteConfigs(providerConfig, protectedAppMetadata.host, siteConfigs);

    // Update custom domains sites
    if (customDomains && customDomains.length > 0) {
      await Promise.all(
        customDomains.map(async ({ domain }) => {
          await updateProtectedAppSiteConfigs(providerConfig, domain, {
            ...siteConfigs,
            host: domain,
          });
        })
      );
    }
  };

  /**
   * Query domain status from Cloudflare and update the data and status in the database
   */
  const syncAppCustomDomainStatus = async (
    applicationId: string
  ): Promise<
    Omit<Application, 'protectedAppMetadata'> & {
      protectedAppMetadata: NonNullable<Application['protectedAppMetadata']>;
    }
  > => {
    const hostnameProviderConfig = await getHostnameProviderConfig();

    const application = await findApplicationById(applicationId);
    const { protectedAppMetadata } = application;
    assertThat(protectedAppMetadata, 'application.protected_app_not_configured', 501);

    if (!protectedAppMetadata.customDomains || protectedAppMetadata.customDomains.length === 0) {
      return {
        ...application,
        protectedAppMetadata,
      };
    }

    // For local OSS, if Cloudflare is not configured, return domains as-is
    if (!hostnameProviderConfig) {
      return {
        ...application,
        protectedAppMetadata,
      };
    }

    const customDomains: CustomDomain[] = await Promise.all(
      protectedAppMetadata.customDomains.map(async (domain) => {
        assertThat(domain.cloudflareData, 'domain.cloudflare_data_missing', 501);

        const cloudflareData = await getCustomHostname(
          hostnameProviderConfig,
          domain.cloudflareData.id
        );

        const status = getDomainStatusFromCloudflareData(cloudflareData);
        const {
          verification_errors: verificationErrors,
          ssl: { validation_errors: sslVerificationErrors },
        } = cloudflareData;

        const errorMessage: string = [
          ...(verificationErrors ?? []),
          ...(sslVerificationErrors ?? []).map(({ message }: { message: string }) => message),
        ]
          .filter(Boolean)
          .join('\n');

        return {
          ...domain,
          cloudflareData,
          errorMessage: errorMessage || null,
          status,
        };
      })
    );

    const { protectedAppMetadata: updatedProtectedAppMetadata } = await updateApplicationById(
      applicationId,
      {
        protectedAppMetadata: {
          ...protectedAppMetadata,
          customDomains,
        },
      }
    );
    // Not expected to happen, just to make TS happy
    assertThat(updatedProtectedAppMetadata, 'application.protected_app_not_configured', 501);

    return {
      ...application,
      protectedAppMetadata: updatedProtectedAppMetadata,
    };
  };

  return {
    syncAppConfigsToRemote,
    deleteRemoteAppConfigs,
    buildProtectedAppData,
    getDefaultDomain,
    addDomainToRemote,
    syncAppCustomDomainStatus,
    deleteDomainFromRemote,
  };
};
