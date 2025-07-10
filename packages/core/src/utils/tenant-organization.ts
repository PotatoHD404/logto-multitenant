/** 
 * @fileoverview
 * Utility functions for managing tenant organizations in local OSS.
 * These functions help map tenant IDs to organization IDs for user management.
 */

import { adminTenantId } from '@logto/schemas';

/** Given a tenant ID, return the corresponding organization ID in the admin tenant. */
export const getTenantOrganizationId = (tenantId: string) => `t-${tenantId}`;

/** Given an admin tenant organization ID, check the format and return the corresponding user tenant ID. */
export const getTenantIdFromOrganizationId = (organizationId: string) => {
  if (!organizationId.startsWith('t-')) {
    throw new Error(`Invalid admin tenant organization ID: ${organizationId}`);
  }

  return organizationId.slice(2);
};

/**
 * Ensure that a tenant organization exists in the admin tenant.
 * This should be called when a tenant is created or when first accessing tenant members.
 */
export const ensureTenantOrganization = async (
  tenantId: string,
  tenantName: string,
  organizationQueries: any
) => {
  const organizationId = getTenantOrganizationId(tenantId);
  
  try {
    // Check if organization already exists
    await organizationQueries.findById(organizationId);
  } catch {
    // Create the organization if it doesn't exist
    await organizationQueries.insert({
      id: organizationId,
      tenantId: adminTenantId,
      name: `Tenant ${tenantName || tenantId}`,
      description: `Organization for tenant ${tenantId}`,
    });
  }
}; 