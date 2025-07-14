import { generateStandardId } from '@logto/shared';
import { OrganizationInvitationStatus, TenantRole } from '@logto/schemas';
import RequestError from '#src/errors/RequestError/index.js';

export const createInvitation = async (
  tenantId: string,
  email: string,
  role: TenantRole,
  inviterId: string,
  getAdminOrganizations: Function,
  ensureTenantOrganization: Function,
  getTenantRole: Function
) => {
  const organizations = await getAdminOrganizations();
  const organizationId = await ensureTenantOrganization(tenantId);

  // Get role ID for the specified tenant role
  const roleId =
    role === TenantRole.Admin
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
      data: { email, tenantId },
    });
  }
};

export const getTenantInvitations = async (
  tenantId: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
  getAdminOrganizations: Function,
  ensureTenantOrganization: Function
) => {
  const organizations = await getAdminOrganizations();
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
      role: invitation.organizationRoles[0]?.name ?? TenantRole.Collaborator,
      status: invitation.status,
      createdAt: new Date(invitation.createdAt).toISOString(),
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      invitee: invitation.invitee,
      organizationRoles: invitation.organizationRoles,
    })),
  };
}; 