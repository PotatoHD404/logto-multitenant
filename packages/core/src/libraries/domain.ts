import { type CloudflareData, DomainStatus, type Domain } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type Queries from '#src/tenants/Queries.js';
import SystemContext from '#src/tenants/SystemContext.js';
import assertThat from '#src/utils/assert-that.js';
import {
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
  getDomainStatusFromCloudflareData,
  getFallbackOrigin,
} from '#src/utils/cloudflare/index.js';
import { isSubdomainOf } from '#src/utils/domain.js';
import { clearCustomDomainCache } from '#src/utils/tenant.js';

export type DomainLibrary = ReturnType<typeof createDomainLibrary>;

export const createDomainLibrary = (queries: Queries) => {
  const {
    domains: { updateDomainById, insertDomain, findDomainById, deleteDomainById },
  } = queries;

  const syncDomainStatusFromCloudflareData = async (
    domain: Domain,
    cloudflareData: CloudflareData
  ): Promise<Domain> => {
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

    return updateDomainById(domain.id, { cloudflareData, errorMessage, status }, 'replace');
  };

  const syncDomainStatus = async (domain: Domain): Promise<Domain> => {
    const { hostnameProviderConfig } = SystemContext.shared;

    // For local OSS, if Cloudflare is not configured, return domain as-is
    if (!hostnameProviderConfig) {
      if (EnvSet.values.isCloud) {
        assertThat(false, 'domain.not_configured');
      }
      return domain;
    }

    assertThat(domain.cloudflareData, 'domain.cloudflare_data_missing');

    const cloudflareData = await getCustomHostname(
      hostnameProviderConfig,
      domain.cloudflareData.id
    );

    const updatedDomain = await syncDomainStatusFromCloudflareData(domain, cloudflareData);

    await clearCustomDomainCache(domain.domain);
    return updatedDomain;
  };

  const addDomain = async (hostname: string): Promise<Domain> => {
    const { hostnameProviderConfig } = SystemContext.shared;

    // For local OSS, if Cloudflare is not configured, create a domain without cloud integration
    if (!hostnameProviderConfig) {
      if (EnvSet.values.isCloud) {
        assertThat(false, 'domain.not_configured');
      }

      // Create a domain without Cloudflare integration for local OSS
      const insertedDomain = await insertDomain({
        domain: hostname,
        id: generateStandardId(),
        cloudflareData: null,
        status: DomainStatus.Active, // Mark as active since no verification needed
        dnsRecords: [
          {
            type: 'A',
            name: hostname,
            value: '127.0.0.1', // Local development placeholder
          },
        ],
        errorMessage: null,
      });

      return insertedDomain;
    }

    const { blockedDomains } = hostnameProviderConfig;
    assertThat(
      !(blockedDomains ?? []).some(
        (domain) => hostname === domain || isSubdomainOf(hostname, domain)
      ),
      'domain.domain_is_not_allowed'
    );

    const [fallbackOrigin, cloudflareData] = await Promise.all([
      getFallbackOrigin(hostnameProviderConfig),
      createCustomHostname(hostnameProviderConfig, hostname),
    ]);

    const insertedDomain = await insertDomain({
      domain: hostname,
      id: generateStandardId(),
      cloudflareData,
      status: DomainStatus.PendingVerification,
      dnsRecords: [
        {
          type: 'CNAME',
          name: hostname,
          value: fallbackOrigin,
        },
      ],
    });
    await clearCustomDomainCache(hostname);
    return insertedDomain;
  };

  const deleteDomain = async (id: string) => {
    const { hostnameProviderConfig } = SystemContext.shared;

    // For local OSS, if Cloudflare is not configured, skip cloud operations
    if (!hostnameProviderConfig) {
      if (EnvSet.values.isCloud) {
        assertThat(false, 'domain.not_configured');
      }

      // Just delete from database for local OSS
      const domain = await findDomainById(id);
      await deleteDomainById(id);
      return;
    }

    const domain = await findDomainById(id);

    if (domain.cloudflareData?.id) {
      try {
        await deleteCustomHostname(hostnameProviderConfig, domain.cloudflareData.id);
      } catch (error: unknown) {
        // Ignore not found error, since we are deleting the domain anyway
        if (!(error instanceof RequestError) || error.code !== 'domain.cloudflare_not_found') {
          throw error;
        }
      }
    }

    await deleteDomainById(id);
    await clearCustomDomainCache(domain.domain);
  };

  return {
    syncDomainStatus,
    addDomain,
    deleteDomain,
  };
};
