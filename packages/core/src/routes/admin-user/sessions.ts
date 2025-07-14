import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';

import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

export default function adminUserSessionsRoutes<T extends ManagementApiRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  const {
    oidcModelInstances: { findSessionsByUserId, revokeSessionByUid, revokeOtherSessionsByUserId },
    users: { findUserById },
  } = queries;

  router.get(
    '/users/:userId/sessions',
    koaPagination({ defaultPageSize: 20 }),
    koaGuard({
      params: z.object({ userId: z.string() }),
      response: z.object({
        data: z.array(
          z.object({
            id: z.string(),
            sessionUid: z.string(),
            deviceInfo: z
              .object({
                userAgent: z.string().optional(),
                ip: z.string().optional(),
              })
              .optional(),
            createdAt: z.number(),
            lastActiveAt: z.number().optional(),
            expiresAt: z.number(),
          })
        ),
        totalCount: z.number(),
      }),
      status: [200, 404],
    }),
    async (ctx, next) => {
      const { userId } = ctx.guard.params;
      const { limit, offset } = ctx.pagination;

      // Ensure the user exists
      await findUserById(userId);

      // Fetch sessions from database
      const allSessions = await findSessionsByUserId(userId);

      // Apply pagination
      const totalCount = allSessions.length;
      const sessions = allSessions.slice(offset, offset + limit);

      // Transform sessions to response format
      const sessionData = sessions.map((session) => ({
        id: session.id,
        sessionUid: session.sessionUid,
        deviceInfo: {
          userAgent: session.lastSubmission?.userAgent as string | undefined,
          ip: session.lastSubmission?.ip as string | undefined,
        },
        createdAt: session.updatedAt ? new Date(session.updatedAt).getTime() : Date.now(),
        lastActiveAt: session.updatedAt ? new Date(session.updatedAt).getTime() : undefined,
        expiresAt: new Date(session.expiresAt).getTime(),
      }));

      ctx.pagination.totalCount = totalCount;
      ctx.body = {
        data: sessionData,
        totalCount,
      };

      return next();
    }
  );

  router.delete(
    '/users/:userId/sessions/:sessionUid',
    koaGuard({
      params: z.object({
        userId: z.string(),
        sessionUid: z.string(),
      }),
      status: [204, 404],
    }),
    async (ctx, next) => {
      const { userId, sessionUid } = ctx.guard.params;

      // Ensure the user exists
      await findUserById(userId);

      try {
        await revokeSessionByUid(sessionUid, userId);
        ctx.status = 204;
      } catch {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }

      return next();
    }
  );

  router.delete(
    '/users/:userId/sessions',
    koaGuard({
      params: z.object({
        userId: z.string(),
      }),
      status: [204, 404],
    }),
    async (ctx, next) => {
      const { userId } = ctx.guard.params;

      // Ensure the user exists
      await findUserById(userId);

      // Revoke all sessions for the user
      await revokeOtherSessionsByUserId(userId);

      ctx.status = 204;

      return next();
    }
  );
}
