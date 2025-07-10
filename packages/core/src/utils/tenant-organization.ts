/** 
 * @fileoverview
 * Utility functions for managing tenant organizations in local OSS.
 * These functions help map tenant IDs to organization IDs for user management.
 */

import { adminTenantId } from '@logto/schemas';

/** 
 * Given a tenant ID, return the corresponding organization ID in the admin tenant.
 * Since tenant IDs are already unique and fit within the 21-character database constraint,
 * we use the tenant ID directly as the organization ID.
 */
export const getTenantOrganizationId = (tenantId: string) => tenantId;

/** Given an admin tenant organization ID, return the corresponding user tenant ID. */
export const getTenantIdFromOrganizationId = (organizationId: string) => organizationId;

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