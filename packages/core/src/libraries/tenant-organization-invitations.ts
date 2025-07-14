import { OrganizationInvitationStatus, TenantRole } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';

import RequestError from '#src/errors/RequestError/index.js';

type AdminOrganizations = {
  invitations: {
    insert: (data: {
      id: string;
      organizationId: string;
      invitee: string;
      inviterId: string;
      status: OrganizationInvitationStatus;
      expiresAt: number;
    }) => Promise<{ id: string }>;
    findEntities: (filter: { organizationId: string }) => Promise<
      Array<{
        id: string;
        invitee: string;
        status: OrganizationInvitationStatus;
        createdAt: string;
        expiresAt: string;
        organizationRoles: Array<{ name: string }>;
      }>
    >;
  };
  relations: {
    invitationsRoles: {
      insert: (data: {
        organizationInvitationId: string;
        organizationRoleId: string;
      }) => Promise<void>;
    };
  };
};

type TenantRoleFunction = (role: TenantRole) => { id: string };

const createInvitation = async (
  tenantId: string,
  email: string,
  role: TenantRole,
  inviterId: string,
  getAdminOrganizations: () => Promise<AdminOrganizations>,
  ensureTenantOrganization: (tenantId: string) => Promise<string>,
  getTenantRole: TenantRoleFunction
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

const getTenantInvitations = async (
  tenantId: string,
  getAdminOrganizations: () => Promise<AdminOrganizations>,
  ensureTenantOrganization: (tenantId: string) => Promise<string>,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
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
    invitations: paginatedInvitations.map((invitation) => ({
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

export { createInvitation, getTenantInvitations };
