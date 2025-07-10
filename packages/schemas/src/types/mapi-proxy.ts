/**
 * @fileoverview
 * Mapi (Management API) proxy is an endpoint in Logto Cloud that proxies the requests to the
 * corresponding Management API. It has the following benefits:
 *
 * - When we migrate the tenant management from API resources to tenant organizations, we can
 *   migrate Console to use the mapi proxy endpoint by changing only the base URL.
 * - It decouples the access control of Cloud user collaboration from the machine-to-machine access
 *   control of the Management API.
 * - The mapi proxy endpoint shares the same domain with Logto Cloud, so it can be used in the
 *   browser without CORS.
 *
 * This module provides utilities to manage mapi proxy.
 */

import { generateStandardSecret, generateStandardId } from '@logto/shared/universal';

import {
  RoleType,
  type Role,
  type CreateApplication,
  ApplicationType,
} from '../db-entries/index.js';
import { adminTenantId } from '../seeds/tenant.js';

/**
 * Generate a deterministic role ID for the mapi proxy that doesn't exceed 21 characters.
 * Uses a simple truncation approach for longer tenant IDs.
 */
const getMapiProxyRoleId = (tenantId: string): string => {
  // For backward compatibility, use the old pattern if it fits
  if (tenantId.length <= 20) {
    return `m-${tenantId}`;
  }
  
  // For longer tenant IDs, use the first 19 characters after "m-"
  // This ensures uniqueness for most cases while staying within the 21-character limit
  return `m-${tenantId.slice(0, 19)}`;
};

/**
 * Generate a deterministic application ID for the mapi proxy that doesn't exceed 21 characters.
 * Uses a simple truncation approach for longer tenant IDs.
 */
const getMapiProxyAppId = (tenantId: string): string => {
  // For backward compatibility, use the old pattern if it fits
  if (tenantId.length <= 20) {
    return `m-${tenantId}`;
  }
  
  // For longer tenant IDs, use the first 19 characters after "m-"
  // This ensures uniqueness for most cases while staying within the 21-character limit
  return `m-${tenantId.slice(0, 19)}`;
};

/**
 * Given a tenant ID, return the role data for the mapi proxy.
 *
 * It follows a convention to generate all the fields which can be used across the system. See
 * the Logto Cloud for more details.
 */
export const getMapiProxyRole = (tenantId: string): Readonly<Role> =>
  Object.freeze({
    tenantId: adminTenantId,
    id: getMapiProxyRoleId(tenantId),
    name: `machine:mapi:${tenantId}`,
    description: `Machine-to-machine role for accessing Management API of tenant '${tenantId}'.`,
    type: RoleType.MachineToMachine,
    isDefault: false,
  });

/**
 * Given a tenant ID, return the application data for the mapi proxy.
 *
 * It follows a convention to generate all the fields which can be used across the system. See
 * the Logto Cloud for more details.
 */
export const getMapiProxyApplication = (tenantId: string): Readonly<CreateApplication> =>
  Object.freeze({
    tenantId: adminTenantId,
    id: getMapiProxyAppId(tenantId),
    name: `Logto Cloud Mapi Proxy (${tenantId})`,
    description: `The proxy application for accessing Management API of tenant '${tenantId}'.`,
    type: ApplicationType.MachineToMachine,
    secret: generateStandardSecret(),
    oidcClientMetadata: {
      redirectUris: [],
      postLogoutRedirectUris: [],
    },
  });
