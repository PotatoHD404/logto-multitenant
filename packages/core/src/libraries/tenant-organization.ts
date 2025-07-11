/**
 * @fileoverview
 * Library for managing tenant organizations in local OSS.
 * Handles the creation and management of organizations in the admin tenant
 * that represent user tenants for member management.
 */

import { TenantRole, adminTenantId, getTenantRole, OrganizationInvitationStatus, getTenantOrganizationId } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import type { CommonQueryMethods } from '@silverhand/slonik';

import RequestError from '#src/errors/RequestError/index.js';
import type Queries from '#src/tenants/Queries.js';
import { EnvSet } from '#src/env-set/index.js';
import { sql } from '@silverhand/slonik';

export type TenantOrganizationLibrary = ReturnType<typeof createTenantOrganizationLibrary>;

export const createTenantOrganizationLibrary = (queries: Queries) => {
  const {
    organizations,
    tenants,
  } = queries;

  const ensureTenantOrganization = async (tenantId: string, tenantName?: string) => {
    const organizationId = getTenantOrganizationId(tenantId);
    
    try {
      // Check if organization already exists
      await organizations.findById(organizationId);
      return organizationId;
    } catch {
      // Organization doesn't exist, create it
      try {
        // Use the provided tenant name, or fall back to tenant ID as display name
        const displayName = tenantName || tenantId;
        
        // Special case for admin tenant: use "Admin tenant" instead of "Tenant admin"
        const organizationName = tenantId === adminTenantId ? 'Admin tenant' : `Tenant ${displayName}`;
        
        await organizations.insert({
          id: organizationId,
          tenantId: adminTenantId,
          name: organizationName,
          description: `Organization for tenant ${tenantId}`,
        });
        
        console.log(`Successfully created organization ${organizationId}`);
        return organizationId;
      } catch (error) {
        console.error(`Failed to create organization ${organizationId}:`, error);
        throw new RequestError({ 
          code: 'entity.create_failed', 
          status: 500,
          name: 'organization',
          data: { tenantId, organizationId, error: error instanceof Error ? error.message : String(error) }
        });
      }
    }
  };

  const addUserToTenant = async (tenantId: string, userId: string, role: TenantRole = TenantRole.Collaborator) => {
    const organizationId = await ensureTenantOrganization(tenantId);
    
    // Check if user is already a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });
    
    if (isMember) {
      throw new RequestError({ 
        code: 'entity.unique_integrity_violation', 
        status: 422 
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
    
    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });
    
    if (!isMember) {
      throw new RequestError({ code: 'entity.not_found', status: 404 });
    }

    // Check if user is the only admin
    const userScopes = await organizations.relations.usersRoles.getUserScopes(organizationId, userId);
    const isAdmin = userScopes.some((scope: any) => scope.name === 'manage:tenant');
    
    if (isAdmin) {
      const [, allMembers] = await organizations.relations.users.getUsersByOrganizationId(
        organizationId,
        { limit: 100, offset: 0 }
      );
      
      const adminCount = allMembers.filter((member: any) => 
        member.organizationRoles.some((role: any) => role.name === TenantRole.Admin)
      ).length;
      
      if (adminCount <= 1) {
        throw new RequestError({ 
          code: 'entity.db_constraint_violated', 
          status: 422 
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
    
    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });
    
    if (!isMember) {
      throw new RequestError({ code: 'entity.not_found', status: 404 });
    }

    // If changing from admin to collaborator, check if user is the only admin
    const currentScopes = await organizations.relations.usersRoles.getUserScopes(organizationId, userId);
    const isCurrentlyAdmin = currentScopes.some((scope: any) => scope.name === 'manage:tenant');
    
    if (isCurrentlyAdmin && newRole === TenantRole.Collaborator) {
      const [, allMembers] = await organizations.relations.users.getUsersByOrganizationId(
        organizationId,
        { limit: 100, offset: 0 }
      );
      
      const adminCount = allMembers.filter((member: any) => 
        member.organizationRoles.some((role: any) => role.name === TenantRole.Admin)
      ).length;
      
      if (adminCount <= 1) {
        throw new RequestError({ 
          code: 'entity.db_constraint_violated', 
          status: 422 
        });
      }
    }

    // Replace user's roles with the new role
    await organizations.relations.usersRoles.replace(organizationId, userId, [newRole]);
  };

  const getUserScopes = async (tenantId: string, userId: string): Promise<string[]> => {
    const organizationId = getTenantOrganizationId(tenantId);
    
    // Check if user is a member
    const isMember = await organizations.relations.users.exists({
      organizationId,
      userId,
    });
    
    if (!isMember) {
      return [];
    }

    const scopes = await organizations.relations.usersRoles.getUserScopes(organizationId, userId);
    return scopes.map((scope: any) => scope.name);
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
        case 'read:data':
          permissions.add('read:tenant_data');
          break;
        case 'write:data':
          permissions.add('write:tenant_data');
          break;
        case 'delete:data':
          permissions.add('delete:tenant_data');
          break;
        case 'read:member':
          permissions.add('read:tenant_members');
          break;
        case 'invite:member':
          permissions.add('invite:tenant_members');
          break;
        case 'remove:member':
          permissions.add('remove:tenant_members');
          break;
        case 'update:member:role':
          permissions.add('update:tenant_member_roles');
          break;
        case 'manage:tenant':
          permissions.add('manage:tenant');
    
        default:
          // Include unknown scopes as-is
          permissions.add(scope);
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
            userId: user.id 
          });
          
          // Assign admin role to user in organization
          await organizations.relations.usersRoles.insert({
            organizationId,
            userId: user.id,
            organizationRoleId: getTenantRole(TenantRole.Admin).id,
          });
        } catch (error) {
          // Continue with other users if one fails
          console.warn(`Failed to add admin user ${user.id} to organization ${organizationId}:`, error);
        }
      }

      console.log(`Successfully provisioned ${adminUsers.length} admin users to tenant organization ${organizationId}`);
    } catch (error) {
      console.error(`Failed to provision admin users to tenant ${tenantId}:`, error);
    }
  };

  const getTenantMembers = async (
    tenantId: string, 
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
    search?: any
  ) => {
    const organizationId = await ensureTenantOrganization(tenantId);
    
    const [totalCount, members] = await organizations.relations.users.getUsersByOrganizationId(
      organizationId,
      { limit, offset },
      search
    );

    return {
      totalCount,
      members: members.map((member: any) => ({
        id: member.id,
        name: member.name,
        primaryEmail: member.primaryEmail,
        primaryPhone: member.primaryPhone,
        avatar: member.avatar,
        username: member.username,
        role: member.organizationRoles?.[0]?.name as TenantRole || TenantRole.Collaborator,
        isOwner: member.organizationRoles?.[0]?.name === TenantRole.Admin,
        organizationRoles: member.organizationRoles || [],
      })),
    };
  };

  const createInvitation = async (
    tenantId: string,
    email: string,
    role: TenantRole,
    inviterId: string
  ) => {
    const organizationId = await ensureTenantOrganization(tenantId);
    
    // Get role ID for the specified tenant role
    const roleId = role === TenantRole.Admin 
      ? getTenantRole(TenantRole.Admin).id 
      : getTenantRole(TenantRole.Collaborator).id;
    
    try {
      const invitation = await organizations.invitations.insert({
        id: generateStandardId(),
        organizationId,
        invitee: email,
        inviterId,
        status: OrganizationInvitationStatus.Pending,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });
      
      // Add role relation
      await organizations.relations.invitationsRoles.insert({
        organizationInvitationId: invitation.id,
        organizationRoleId: roleId,
      });
      
      return invitation;
    } catch (error) {
      if (error instanceof RequestError && error.code === 'entity.unique_integrity_violation') {
        throw error;
      }
      throw new RequestError({ 
        code: 'entity.create_failed', 
        status: 500,
        data: { email, tenantId }
      });
    }
  };

  const getTenantInvitations = async (
    tenantId: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
  ) => {
    const organizationId = await ensureTenantOrganization(tenantId);
    
    // Use findEntities method with organizationId filter
    const invitations = await organizations.invitations.findEntities({
      organizationId,
    });

    // Apply pagination manually since findEntities doesn't support it directly
    const paginatedInvitations = invitations.slice(offset, offset + limit);

    return {
      totalCount: invitations.length,
      invitations: paginatedInvitations.map((invitation: any) => ({
        id: invitation.id,
        email: invitation.invitee,
        role: invitation.organizationRoles?.[0]?.name as TenantRole || TenantRole.Collaborator,
        status: invitation.status,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
        invitee: invitation.invitee,
        organizationRoles: invitation.organizationRoles || [],
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
    createInvitation,
    getTenantInvitations,
  };
}; 