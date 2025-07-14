/**
 * @fileoverview
 * Routes for handling tenant invitation acceptance.
 * This provides endpoints for users to accept invitations to join specific tenants.
 */

import { TenantRole, OrganizationInvitationStatus } from '@logto/schemas';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';
import koaAuth from '#src/middleware/koa-auth/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import type { ManagementApiRouter, RouterInitArgs } from '#src/routes/types.js';

const invitationAcceptanceGuard = z.object({
  invitationId: z.string(),
  email: z.string().email(),
});

const invitationAcceptanceResponseGuard = z.object({
  success: z.boolean(),
  tenantId: z.string(),
  role: z.nativeEnum(TenantRole),
});

// Remove unused default export by commenting out export keyword
export default function invitationAcceptanceRoutes<T extends ManagementApiRouter>(
  router: T,
  { queries }: RouterInitArgs<any>
): T {
  // POST /api/invitation/accept - Accept tenant invitation
  router.post(
    '/invitation/accept',
    koaAuth(),
    koaGuard({
      body: invitationAcceptanceGuard,
      response: invitationAcceptanceResponseGuard,
      status: [200, 400, 404, 422],
    }),
    async (ctx, next) => {
      const { sub: userId } = ctx.auth;
      const { invitationId, email } = ctx.guard.body;

      try {
        // Get the invitation details
        const invitation = await queries.organizations.invitations.findById(invitationId);

        if (!invitation) {
          throw new RequestError({ code: 'entity.not_found', status: 404 });
        }

        // Verify the invitation is for the correct email
        if (invitation.invitee !== email) {
          throw new RequestError({
            code: 'invitation.invalid_email',
            status: 400,
          });
        }

        // Check if invitation is still valid
        if (invitation.status !== OrganizationInvitationStatus.Pending) {
          throw new RequestError({
            code: 'invitation.invalid_status',
            status: 400,
          });
        }

        // Check if invitation has expired
        if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
          throw new RequestError({
            code: 'invitation.expired',
            status: 400,
          });
        }

        // Extract tenant ID from organization ID (format: t-{tenantId})
        const tenantId = invitation.organizationId.replace(/^t-/, '');

        // Get invitation roles
        const invitationRoles =
          await queries.organizations.relations.invitationsRoles.findByInvitationId(invitationId);

        if (invitationRoles.length === 0) {
          throw new RequestError({
            code: 'invitation.no_roles',
            status: 400,
          });
        }

        // Determine role based on first role (should only be one)
        const roleId = invitationRoles[0]?.organizationRoleId;
        const role = roleId?.includes('admin') ? TenantRole.Admin : TenantRole.Collaborator;

        // Create tenant organization library
        const tenantOrganizationLibrary = createTenantOrganizationLibrary(queries);

        // Add user to tenant with the specified role
        await tenantOrganizationLibrary.addUserToTenant(tenantId, userId, role);

        // Update invitation status to accepted
        await queries.organizations.invitations.updateById(invitationId, {
          status: OrganizationInvitationStatus.Accepted,
          acceptedAt: Date.now(),
        });

        ctx.body = {
          success: true,
          tenantId,
          role,
        };
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        throw new RequestError({
          code: 'invitation.acceptance_failed',
          status: 500,
        });
      }

      return next();
    }
  );

  // GET /api/invitation/:invitationId - Get invitation details
  router.get(
    '/invitation/:invitationId',
    koaGuard({
      params: z.object({ invitationId: z.string() }),
      response: z.object({
        id: z.string(),
        tenantId: z.string(),
        tenantName: z.string().optional(),
        inviterName: z.string().optional(),
        role: z.nativeEnum(TenantRole),
        email: z.string().email(),
        status: z.nativeEnum(OrganizationInvitationStatus),
        expiresAt: z.number().optional(),
        createdAt: z.number(),
      }),
      status: [200, 404],
    }),
    async (ctx, next) => {
      const { invitationId } = ctx.guard.params;

      try {
        const invitation = await queries.organizations.invitations.findById(invitationId);

        if (!invitation) {
          throw new RequestError({ code: 'entity.not_found', status: 404 });
        }

        // Get invitation roles
        const invitationRoles =
          await queries.organizations.relations.invitationsRoles.findByInvitationId(invitationId);

        const roleId = invitationRoles[0]?.organizationRoleId;
        const role = roleId?.includes('admin') ? TenantRole.Admin : TenantRole.Collaborator;

        // Extract tenant ID from organization ID (format: t-{tenantId})
        const tenantId = invitation.organizationId.replace(/^t-/, '');

        // Get tenant details
        const tenant = await queries.tenants.findById(tenantId);

        // Get inviter details
        const inviter = await queries.users.findById(invitation.inviterId);

        ctx.body = {
          id: invitation.id,
          tenantId,
          tenantName: tenant?.name,
          inviterName: inviter?.name,
          role,
          email: invitation.invitee,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        };
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        throw new RequestError({
          code: 'entity.not_found',
          status: 404,
        });
      }

      return next();
    }
  );

  return router;
}
