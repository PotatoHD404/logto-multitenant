import { generateStandardId } from '@logto/shared/universal';

import {
  RoleType,
  type CreateResource,
  type CreateRole,
  type CreateScope,
} from '../db-entries/index.js';
import {
  PredefinedScope,
  InternalRole,
  AdminTenantRole,
  getMapiProxyRole,
} from '../types/index.js';

import { adminTenantId, defaultTenantId } from './tenant.js';

/**
 * Tenant management scopes for OSS deployments
 */
export enum TenantManagementScope {
  /** Read tenant information */
  Read = 'tenant:read',
  /** Write/update tenant information */
  Write = 'tenant:write',
  /** Delete tenant */
  Delete = 'tenant:delete',
}

/**
 * The Management API data for a tenant. Usually used for creating a new tenant in the admin
 * tenant.
 */
export type AdminData = {
  resource: CreateResource;
  scopes: CreateScope[];
  role: CreateRole;
};

export type UpdateAdminData = Omit<AdminData, 'role'> & {
  /** Attach to an existing role instead of creating one. */
  role: Pick<CreateRole, 'tenantId' | 'name'>;
};

// Consider remove the dependency of IDs
const defaultResourceId = 'management-api';
const defaultScopeAllId = 'management-api-all';

// Consider combining this with `createAdminData()`
/** The fixed Management API Resource for `default` tenant. */
export const defaultManagementApi = Object.freeze({
  resource: {
    tenantId: defaultTenantId,
    /** @deprecated You should not rely on this constant. Change to something else. */
    id: defaultResourceId,
    /**
     * The fixed resource indicator for Management APIs.
     *
     * Admin Console requires the access token of this resource to be functional.
     */
    indicator: `https://${defaultTenantId}.logto.app/api`,
    name: 'Logto Management API',
  },
  scopes: [
    {
      tenantId: defaultTenantId,
      /** @deprecated You should not rely on this constant. Change to something else. */
      id: defaultScopeAllId,
      name: PredefinedScope.All,
      description: 'Default scope for Management API, allows all permissions.',
      /** @deprecated You should not rely on this constant. Change to something else. */
      resourceId: defaultResourceId,
    },
    // Tenant management scopes for OSS
    {
      tenantId: defaultTenantId,
      id: generateStandardId(),
      name: TenantManagementScope.Read,
      description: 'Allow reading tenant information.',
      resourceId: defaultResourceId,
    },
    {
      tenantId: defaultTenantId,
      id: generateStandardId(),
      name: TenantManagementScope.Write,
      description: 'Allow writing/updating tenant information.',
      resourceId: defaultResourceId,
    },
    {
      tenantId: defaultTenantId,
      id: generateStandardId(),
      name: TenantManagementScope.Delete,
      description: 'Allow deleting tenant.',
      resourceId: defaultResourceId,
    },
  ],
  /**
   * An internal user role for Management API of the `default` tenant.
   * @deprecated This role will be removed soon.
   */
  role: {
    tenantId: defaultTenantId,
    /** @deprecated You should not rely on this constant. Change to something else. */
    id: 'admin-role',
    name: InternalRole.Admin,
    description: `Internal admin role for Logto tenant ${defaultTenantId}.`,
    type: RoleType.MachineToMachine,
  },
}) satisfies AdminData;

/**
 * Get the Management API resource indicator for the given tenant ID.
 *
 * @param tenantId The ID of tenant.
 * @param prefix The prefix of the resource indicator. Defaults to 'api'.
 * @returns The resource indicator.
 */
export const getManagementApiResourceIndicator = (tenantId: string, prefix = 'api') =>
  `https://${tenantId}.logto.app/${prefix}`;

/**
 * The fixed Management API user role for `default` tenant in the admin tenant. It is used for
 * OSS only.
 */
export const defaultManagementApiAdminName = `${defaultTenantId}:admin` as const;

/** Create a set of admin data for Management API of the given tenant ID. */
export const createAdminData = (tenantId: string) => {
  const resourceId = generateStandardId();

  return Object.freeze({
    resource: {
      tenantId,
      id: resourceId,
      indicator: getManagementApiResourceIndicator(tenantId),
      name: `Logto Management API`,
    },
    scopes: [
      {
        tenantId,
        id: generateStandardId(),
        name: PredefinedScope.All,
        description: 'Default scope for Management API, allows all permissions.',
        resourceId,
      },
      // Tenant management scopes for OSS
      {
        tenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Read,
        description: 'Allow reading tenant information.',
        resourceId,
      },
      {
        tenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Write,
        description: 'Allow writing/updating tenant information.',
        resourceId,
      },
      {
        tenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Delete,
        description: 'Allow deleting tenant.',
        resourceId,
      },
    ],
    /** @deprecated This role will be removed soon. */
    role: {
      tenantId,
      id: generateStandardId(),
      name: InternalRole.Admin,
      description: `Internal admin role for Logto tenant ${defaultTenantId}.`,
      type: RoleType.MachineToMachine,
    },
  } satisfies AdminData);
};

/** Create a set of admin data for Management API of the given tenant ID for the admin tenant. */
export const createAdminDataInAdminTenant = (tenantId: string) => {
  const resourceId = generateStandardId();

  return Object.freeze({
    resource: {
      tenantId: adminTenantId,
      id: resourceId,
      indicator: getManagementApiResourceIndicator(tenantId),
      name: `Logto Management API for tenant ${tenantId}`,
    },
    scopes: [
      {
        tenantId: adminTenantId,
        id: generateStandardId(),
        name: PredefinedScope.All,
        description: 'Default scope for Management API, allows all permissions.',
        resourceId,
      },
      // Tenant management scopes for OSS
      {
        tenantId: adminTenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Read,
        description: 'Allow reading tenant information.',
        resourceId,
      },
      {
        tenantId: adminTenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Write,
        description: 'Allow writing/updating tenant information.',
        resourceId,
      },
      {
        tenantId: adminTenantId,
        id: generateStandardId(),
        name: TenantManagementScope.Delete,
        description: 'Allow deleting tenant.',
        resourceId,
      },
    ],
    /** The machine-to-machine role for the Management API proxy of the given tenant ID. */
    role: getMapiProxyRole(tenantId),
  } satisfies AdminData);
};

export const createMeApiInAdminTenant = () => {
  const resourceId = generateStandardId();

  return Object.freeze({
    resource: {
      tenantId: adminTenantId,
      id: resourceId,
      indicator: getManagementApiResourceIndicator(adminTenantId, 'me'),
      name: `Logto Me API`,
    },
    scopes: [
      {
        tenantId: adminTenantId,
        id: generateStandardId(),
        name: PredefinedScope.All,
        description: 'Default scope for Me API, allows all permissions.',
        resourceId,
      },
    ],
    role: {
      tenantId: adminTenantId,
      id: generateStandardId(),
      name: AdminTenantRole.User,
      description: 'Default role for admin tenant.',
      type: RoleType.User,
    },
  } satisfies AdminData);
};

/**
 * Create a pre-configured M2M role for Management API access.
 */
export const createPreConfiguredManagementApiAccessRole = (tenantId: string): CreateRole => ({
  tenantId,
  id: generateStandardId(),
  description: 'This default role grants access to the Logto management API.',
  name: 'Logto Management API access',
  type: RoleType.MachineToMachine,
});

export default {
  defaultManagementApi,
  createAdminData,
  createAdminDataInAdminTenant,
  createMeApiInAdminTenant,
  createPreConfiguredManagementApiAccessRole,
  getManagementApiResourceIndicator,
  defaultManagementApiAdminName,
  TenantManagementScope,
};
