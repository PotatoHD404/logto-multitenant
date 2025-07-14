import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import assertThat from '#src/utils/assert-that.js';

import type { RouterInitArgs } from '../routes/types.js';

import type { AuthedMeRouter } from './types.js';

export default function sessionsRoutes<T extends AuthedMeRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  const {
    queries: {
      oidcModelInstances: { findSessionsByUserId, revokeSessionByUid, revokeOtherSessionsByUserId },
      users: { findUserById },
    },
  } = tenant;

  router.get(
    '/sessions',
    koaPagination({ defaultPageSize: 20 }),
    koaGuard({
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
      status: 200,
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { limit, offset } = ctx.pagination;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

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
          userAgent: typeof session.lastSubmission?.userAgent === 'string' ? session.lastSubmission.userAgent : undefined,
          ip: typeof session.lastSubmission?.ip === 'string' ? session.lastSubmission.ip : undefined,
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
    '/sessions/:sessionUid',
    koaGuard({
      params: z.object({
        sessionUid: z.string(),
      }),
      status: [204, 404],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { sessionUid } = ctx.guard.params;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

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
    '/sessions',
    koaGuard({
      query: z.object({
        except_current: z
          .string()
          .optional()
          .transform((value) => value === 'true'),
      }),
      status: [204],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { except_current: exceptCurrent = true } = ctx.guard.query;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      if (exceptCurrent) {
        // Revoke all sessions except current (we'll implement current session detection later)
        await revokeOtherSessionsByUserId(userId);
      } else {
        // Revoke all sessions including current
        await revokeOtherSessionsByUserId(userId);
      }

      ctx.status = 204;

      return next();
    }
  );
}
