/**
 * @fileoverview
 * Library for managing tenant organizations in local OSS.
 * Handles the creation and management of organizations in the admin tenant
 * that represent user tenants for member management.
 */

import { TenantRole, adminTenantId, getTenantRole, OrganizationInvitationStatus } from '@logto/schemas';
import type { CommonQueryMethods } from '@silverhand/slonik';

import RequestError from '#src/errors/RequestError/index.js';
import type Queries from '#src/tenants/Queries.js';
import { getTenantOrganizationId } from '#src/utils/tenant-organization.js';

export type TenantOrganizationLibrary = ReturnType<typeof createTenantOrganizationLibrary>;

export const createTenantOrganizationLibrary = (queries: Queries) => {
  const {
    organizations,
    tenants,
  } = queries;

  const ensureTenantOrganization = async (tenantId: string) => {
    const organizationId = getTenantOrganizationId(tenantId);
    
    try {
      // Check if organization already exists
      await organizations.findById(organizationId);
      return organizationId;
    } catch {
      // Organization doesn't exist, create it
      try {
        const tenant = await tenants.findTenantSuspendStatusById(tenantId);
        
        await organizations.insert({
          id: organizationId,
          tenantId: adminTenantId,
          name: `Tenant ${tenant.id}`,
          description: `Organization for tenant ${tenant.id}`,
        });
        
        return organizationId;
      } catch (error) {
        throw new RequestError({ 
          code: 'entity.create_failed', 
          status: 500,
          data: { tenantId }
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
          break;
        default:
          // Include unknown scopes as-is
          permissions.add(scope);
      }
    }
    
    return Array.from(permissions);
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
    
    const [totalCount, invitations] = await organizations.invitations.findByOrganizationId(
      organizationId,
      limit,
      offset
    );

    return {
      totalCount,
      invitations: invitations.map((invitation: any) => ({
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
    getTenantMembers,
    createInvitation,
    getTenantInvitations,
  };
}; 