/**
 * @fileoverview
 * Library for managing tenant organizations in local OSS.
 * Handles the creation and management of organizations in the admin tenant
 * that represent user tenants for member management.
 */

import {
  TenantRole,
  adminTenantId,
  getTenantRole,
  OrganizationInvitationStatus,
  getTenantOrganizationId,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql } from '@silverhand/slonik';

import { type SearchOptions } from '#src/database/utils.js';
import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import Queries from '#src/tenants/Queries.js';
import { unknownConsole } from '#src/utils/console.js';

export const createTenantOrganizationLibrary = (queries: Queries) => {
  const { tenants } = queries;

  // Create admin tenant queries to ensure all organization operations happen in admin tenant
  const getAdminOrganizations = async () => {
    const sharedPool = await EnvSet.sharedPool;
    const adminQueries = new Queries(
      sharedPool,
      queries.wellKnownCache,
      adminTenantId,
      queries.envSet
    );
    return adminQueries.organizations;
  };

  const ensureTenantOrganization = async (tenantId: string, tenantName?: string) => {
    const organizationId = getTenantOrganizationId(tenantId);

    try {
      const organizations = await getAdminOrganizations();
      try {
        await organizations.findById(organizationId);
        return organizationId;
      } catch {
        // Organization doesn't exist, create it
      }

      // Use the provided tenant name, or fall back to tenant ID as display name
      const displayName = tenantName ?? tenantId;

      // Special case for admin tenant: use "Admin tenant" instead of "Tenant admin"
      const organizationName =
        tenantId === adminTenantId ? 'Admin tenant' : `Tenant ${displayName}`;

      await organizations.insert({
        id: organizationId,
        tenantId: adminTenantId,
        name: organizationName,
        description: `Organization for tenant ${tenantId}`,
      });

      unknownConsole.info(`Successfully created organization ${organizationId}`);
      return organizationId;
    } catch (error) {
      unknownConsole.error(`Failed to create organization ${organizationId}:`, error);
      throw new RequestError({
        code: 'entity.create_failed',
        status: 500,
        name: 'organization',
        data: {
          tenantId,
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const addUserToTenant = async (
    tenantId: string,
    userId: string,
    role: TenantRole = TenantRole.Collaborator
  ) => {
    const organizations = await getAdminOrganizations();
    const organizationId = await ensureTenantOrganization(tenantId);

    // Check if user is already a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });

    if (isMember) {
      throw new RequestError({
        code: 'entity.unique_integrity_violation',
        status: 422,
      });
    }

    // Add user to organization
    await organizations.relations.users.insert({
      organizationId,
      userId,
    });

    // Assign role
    await organizations.relations.usersRoles.insert({
      organizationId,
      organizationRoleId: role,
      userId,
    });
  };

  const removeUserFromTenant = async (tenantId: string, userId: string) => {
    const organizationId = getTenantOrganizationId(tenantId);
    const organizations = await getAdminOrganizations();

    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });

    if (!isMember) {
      throw new RequestError({ code: 'entity.not_found', status: 404 });
    }

    // Check if user is the only admin
    const userScopes = await organizations.relations.usersRoles.getUserScopes(
      organizationId,
      userId
    );
    const isAdmin = userScopes.some((scope) => scope.name === 'manage:tenant');

    if (isAdmin) {
      const [, allMembers] = await organizations.relations.users.getUsersByOrganizationId(
        organizationId,
        { limit: 100, offset: 0 }
      );

      const adminCount = allMembers.filter((member) =>
        member.organizationRoles.some((role) => role.name === TenantRole.Admin)
      ).length;

      if (adminCount <= 1) {
        throw new RequestError({
          code: 'entity.db_constraint_violated',
          status: 422,
        });
      }
    }

    // Remove user from organization (cascades to roles)
    await organizations.relations.users.delete({
      organizationId,
      userId,
    });
  };

  const updateUserRole = async (tenantId: string, userId: string, newRole: TenantRole) => {
    const organizationId = getTenantOrganizationId(tenantId);
    const organizations = await getAdminOrganizations();

    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });

    if (!isMember) {
      throw new RequestError({ code: 'entity.not_found', status: 404 });
    }

    // If changing from admin to collaborator, check if user is the only admin
    const currentScopes = await organizations.relations.usersRoles.getUserScopes(
      organizationId,
      userId
    );
    const isCurrentlyAdmin = currentScopes.some((scope) => scope.name === 'manage:tenant');

    if (isCurrentlyAdmin && newRole === TenantRole.Collaborator) {
      const [, allMembers] = await organizations.relations.users.getUsersByOrganizationId(
        organizationId,
        { limit: 100, offset: 0 }
      );

      const adminCount = allMembers.filter((member) =>
        member.organizationRoles.some((role) => role.name === TenantRole.Admin)
      ).length;

      if (adminCount <= 1) {
        throw new RequestError({
          code: 'entity.db_constraint_violated',
          status: 422,
        });
      }
    }

    // Replace user's roles with the new role
    await organizations.relations.usersRoles.replace(organizationId, userId, [newRole]);
  };

  const getUserScopes = async (tenantId: string, userId: string): Promise<string[]> => {
    const organizationId = getTenantOrganizationId(tenantId);
    const organizations = await getAdminOrganizations();

    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });

    if (!isMember) {
      return [];
    }

    const scopes = await organizations.relations.usersRoles.getUserScopes(organizationId, userId);
    return scopes.map((scope) => scope.name);
  };

  /**
   * Get tenant permissions for a user based on their organization roles.
   * This maps organization scopes to actual tenant permission strings.
   */
  const getTenantPermissions = async (tenantId: string, userId: string): Promise<string[]> => {
    const scopes = await getUserScopes(tenantId, userId);

    // Map organization scopes to tenant permissions
    const permissions = new Set<string>();

    for (const scope of scopes) {
      switch (scope) {
        case 'read:data': {
          permissions.add('read:tenant_data');
          break;
        }
        case 'write:data': {
          permissions.add('write:tenant_data');
          break;
        }
        case 'delete:data': {
          permissions.add('delete:tenant_data');
          break;
        }
        case 'read:member': {
          permissions.add('read:tenant_members');
          break;
        }
        case 'invite:member': {
          permissions.add('invite:tenant_members');
          break;
        }
        case 'remove:member': {
          permissions.add('remove:tenant_members');
          break;
        }
        case 'update:member:role': {
          permissions.add('update:tenant_member_roles');
          break;
        }
        case 'manage:tenant': {
          permissions.add('manage:tenant');
          break;
        }

        default: {
          // Include unknown scopes as-is
          permissions.add(scope);
        }
      }
    }

    return Array.from(permissions);
  };

  /**
   * Provision existing admin users to a new tenant organization.
   * This should be called when a new tenant is created in a multi-tenant OSS environment.
   */
  const provisionAdminUsersToNewTenant = async (tenantId: string) => {
    const { isCloud } = EnvSet.values;
    const organizations = await getAdminOrganizations();

    // Only do this for local OSS multi-tenant setups
    if (isCloud) {
      return;
    }

    try {
      const organizationId = await ensureTenantOrganization(tenantId);

      // Get all existing admin users from the admin tenant
      const sharedPool = await EnvSet.sharedPool;
      const adminUsers = await sharedPool.any<{ id: string }>(sql`
        select distinct u.id
        from users u
        join users_roles ur on ur.user_id = u.id
        join roles r on r.id = ur.role_id
        where r.tenant_id = ${adminTenantId}
        and (r.name = 'admin:admin' or r.name like '%:admin');
      `);

      // Add each admin user to the new tenant organization with admin role
      for (const user of adminUsers) {
        try {
          // Add user to organization
          await organizations.relations.users.insert({
            organizationId,
            userId: user.id,
          });

          // Assign admin role to user in organization
          await organizations.relations.usersRoles.insert({
            organizationId,
            userId: user.id,
            organizationRoleId: getTenantRole(TenantRole.Admin).id,
          });
        } catch (error) {
          // Continue with other users if one fails
          unknownConsole.warn(
            `Failed to add admin user ${user.id} to organization ${organizationId}:`,
            error
          );
        }
      }

      unknownConsole.info(
        `Successfully provisioned ${adminUsers.length} admin users to tenant organization ${organizationId}`
      );
    } catch (error) {
      unknownConsole.error(`Failed to provision admin users to tenant ${tenantId}:`, error);
    }
  };

  const getTenantMembers = async (
    tenantId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    search?: SearchOptions<'id' | 'name' | 'username' | 'primaryEmail' | 'primaryPhone'>
  ) => {
    const organizations = await getAdminOrganizations();
    const organizationId = await ensureTenantOrganization(tenantId);

    const [totalCount, members] = await organizations.relations.users.getUsersByOrganizationId(
      organizationId,
      { limit, offset },
      search
    );

    return {
      totalCount,
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        primaryEmail: member.primaryEmail,
        primaryPhone: member.primaryPhone,
        avatar: member.avatar,
        username: member.username,
        role: member.organizationRoles[0]?.name ?? TenantRole.Collaborator,
        isOwner: member.organizationRoles[0]?.name === TenantRole.Admin,
        organizationRoles: member.organizationRoles,
      })),
    };
  };

  return {
    ensureTenantOrganization,
    addUserToTenant,
    removeUserFromTenant,
    updateUserRole,
    getUserScopes,
    getTenantPermissions,
    provisionAdminUsersToNewTenant,
    getTenantMembers,
  };
};
