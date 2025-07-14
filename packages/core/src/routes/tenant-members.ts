import { TenantRole } from '@logto/schemas';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import {
  koaTenantMemberReadAuth,
  koaTenantMemberInviteAuth,
  koaTenantMemberRemoveAuth,
  koaTenantMemberUpdateRoleAuth,
  koaTenantMemberReadInvitationsAuth,
  koaTenantMemberCreateInvitationsAuth,
} from '#src/middleware/koa-tenant-member-auth.js';
import { userSearchKeys } from '#src/queries/user.js';
import type { ManagementApiRouter, RouterInitArgs } from '#src/routes/types.js';
import { parseSearchOptions } from '#src/utils/search.js';

// Response types for tenant members and invitations
const tenantMemberResponseGuard = z.object({
  id: z.string(),
  name: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  avatar: z.string().nullable(),
  username: z.string().nullable(),
  role: z.nativeEnum(TenantRole),
  isOwner: z.boolean(),
  organizationRoles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

const tenantInvitationResponseGuard = z.object({
  id: z.string(),
  email: z.string(),
  role: z.nativeEnum(TenantRole),
  status: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  invitee: z.string(),
  organizationRoles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
});

export default function tenantMemberRoutes<T extends ManagementApiRouter>(
  ...[router, { queries, libraries }]: RouterInitArgs<T>
) {
  const tenantOrg = createTenantOrganizationLibrary(queries);

  // GET /api/tenants/:tenantId/members - Get tenant members
  router.get(
    '/tenants/:tenantId/members',
    koaPagination(),
    koaGuard({
      params: z.object({ tenantId: z.string() }),
      query: z.object({ q: z.string().optional() }),
      response: tenantMemberResponseGuard.array(),
      status: [200, 403, 404],
    }),
    koaTenantMemberReadAuth(queries),
    async (ctx, next) => {
      const { tenantId } = ctx.guard.params;
      const { q } = ctx.guard.query;
      const { limit, offset } = ctx.pagination;

      const searchOptions = parseSearchOptions(userSearchKeys, { q });

      try {
        const { totalCount, members } = await tenantOrg.getTenantMembers(
          tenantId,
          { limit, offset },
          searchOptions
        );

        ctx.pagination.totalCount = totalCount;
        ctx.body = members;
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // POST /api/tenants/:tenantId/members - Add member to tenant
  router.post(
    '/tenants/:tenantId/members',
    koaGuard({
      params: z.object({ tenantId: z.string() }),
      body: z.object({
        userId: z.string(),
        role: z.nativeEnum(TenantRole).optional().default(TenantRole.Collaborator),
      }),
      status: [201, 403, 422],
    }),
    koaTenantMemberInviteAuth(queries),
    async (ctx, next) => {
      const { tenantId } = ctx.guard.params;
      const { userId, role } = ctx.guard.body;

      try {
        await tenantOrg.addUserToTenant(tenantId, userId, role);
        ctx.status = 201;
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        throw new RequestError({ code: 'entity.create_failed', status: 500 });
      }

      return next();
    }
  );

  // DELETE /api/tenants/:tenantId/members/:userId - Remove member from tenant
  router.delete(
    '/tenants/:tenantId/members/:userId',
    koaGuard({
      params: z.object({ tenantId: z.string(), userId: z.string() }),
      status: [204, 403, 404, 422],
    }),
    koaTenantMemberRemoveAuth(queries),
    async (ctx, next) => {
      const { tenantId, userId } = ctx.guard.params;

      try {
        await tenantOrg.removeUserFromTenant(tenantId, userId);
        ctx.status = 204;
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // PUT /api/tenants/:tenantId/members/:userId/roles - Update member role
  router.put(
    '/tenants/:tenantId/members/:userId/roles',
    koaGuard({
      params: z.object({ tenantId: z.string(), userId: z.string() }),
      body: z.object({ roleName: z.nativeEnum(TenantRole) }),
      status: [200, 403, 404, 422],
    }),
    koaTenantMemberUpdateRoleAuth(queries),
    async (ctx, next) => {
      const { tenantId, userId } = ctx.guard.params;
      const { roleName } = ctx.guard.body;

      try {
        await tenantOrg.updateUserRole(tenantId, userId, roleName);
        ctx.status = 200;
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // GET /api/tenants/:tenantId/members/:userId/scopes - Get member scopes
  router.get(
    '/tenants/:tenantId/members/:userId/scopes',
    koaGuard({
      params: z.object({ tenantId: z.string(), userId: z.string() }),
      response: z.array(z.string()),
      status: [200, 403, 404],
    }),
    koaTenantMemberReadAuth(queries),
    async (ctx, next) => {
      const { tenantId, userId } = ctx.guard.params;

      try {
        const permissions = await tenantOrg.getTenantPermissions(tenantId, userId);
        ctx.body = permissions;
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // GET /api/tenants/:tenantId/invitations - Get tenant invitations
  router.get(
    '/tenants/:tenantId/invitations',
    koaPagination(),
    koaGuard({
      params: z.object({ tenantId: z.string() }),
      response: tenantInvitationResponseGuard.array(),
      status: [200, 403, 404],
    }),
    koaTenantMemberReadInvitationsAuth(queries),
    async (ctx, next) => {
      const { tenantId } = ctx.guard.params;
      const { limit, offset } = ctx.pagination;

      try {
        const { totalCount, invitations } = await tenantOrg.getTenantInvitations(tenantId, {
          limit,
          offset,
        });

        ctx.pagination.totalCount = totalCount;
        ctx.body = invitations;
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // POST /api/tenants/:tenantId/invitations - Create tenant invitations
  router.post(
    '/tenants/:tenantId/invitations',
    koaGuard({
      params: z.object({ tenantId: z.string() }),
      body: z.object({
        emails: z.array(z.string().email()),
        role: z.nativeEnum(TenantRole),
      }),
      status: [201, 403, 422],
    }),
    koaTenantMemberCreateInvitationsAuth(queries),
    async (ctx, next) => {
      const { tenantId } = ctx.guard.params;
      const { emails, role } = ctx.guard.body;

      const invitationPromises = emails.map(async (email: string) => {
        try {
          return await tenantOrg.createInvitation(tenantId, email, role, ctx.auth.id);
        } catch (error) {
          // Skip duplicate invitations
          if (error instanceof RequestError && error.code === 'entity.unique_integrity_violation') {
            return null;
          }
          throw error;
        }
      });

      const invitationResults = await Promise.all(invitationPromises);
      const invitations = invitationResults.filter(
        (
          invitation: unknown
        ): invitation is Exclude<(typeof invitationResults)[number], undefined> =>
          invitation !== null
      );

      ctx.status = 201;
      ctx.body = { count: invitations.length };
      return next();
    }
  );

  // PATCH /api/tenants/:tenantId/invitations/:invitationId/status - Update invitation status
  router.patch(
    '/tenants/:tenantId/invitations/:invitationId/status',
    koaGuard({
      params: z.object({ tenantId: z.string(), invitationId: z.string() }),
      body: z.object({ status: z.string() }),
      status: [200, 403, 404],
    }),
    koaTenantMemberCreateInvitationsAuth(queries),
    async (ctx, next) => {
      const { tenantId, invitationId } = ctx.guard.params;
      const { status } = ctx.guard.body;

      try {
        // Update invitation status - this will be properly implemented later
        ctx.status = 200;
        ctx.body = { success: true };
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // DELETE /api/tenants/:tenantId/invitations/:invitationId - Delete invitation
  router.delete(
    '/tenants/:tenantId/invitations/:invitationId',
    koaGuard({
      params: z.object({ tenantId: z.string(), invitationId: z.string() }),
      status: [204, 403, 404],
    }),
    koaTenantMemberCreateInvitationsAuth(queries),
    async (ctx, next) => {
      const { tenantId, invitationId } = ctx.guard.params;

      try {
        // Delete invitation - this will be properly implemented later
        ctx.status = 204;
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  // POST /api/tenants/:tenantId/invitations/:invitationId/message - Resend invitation
  router.post(
    '/tenants/:tenantId/invitations/:invitationId/message',
    koaGuard({
      params: z.object({ tenantId: z.string(), invitationId: z.string() }),
      status: [200, 403, 404],
    }),
    koaTenantMemberCreateInvitationsAuth(queries),
    async (ctx, next) => {
      const { tenantId, invitationId } = ctx.guard.params;

      try {
        // Resend invitation - this will be properly implemented later
        ctx.status = 200;
        ctx.body = { success: true };
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );
}
