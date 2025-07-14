import { emailRegEx, PasswordPolicyChecker, usernameRegEx } from '@logto/core-kit';
import {
  userInfoSelectFields,
  jsonObjectGuard,
  interaction,
  saml,
  jwtCustomizer,
} from '@logto/schemas';
import { condArray, conditional, pick } from '@silverhand/essentials';
import { literal, object, string, number } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import { encryptUserPassword } from '#src/libraries/user.utils.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import type { AllowedKeyPrefix } from '#src/queries/log.js';
import assertThat from '#src/utils/assert-that.js';

import type { RouterInitArgs } from '../routes/types.js';
import { checkPasswordPolicyForUser } from '../utils/password.js';

import type { AuthedMeRouter } from './types.js';

export default function userRoutes<T extends AuthedMeRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  const {
    queries: {
      users: { findUserById, updateUserById, deleteUserById },
      signInExperiences: { findDefaultSignInExperience },
      logs: { findLogs, countLogs },
    },
    libraries: {
      users: { checkIdentifierCollision, verifyUserPassword, signOutUser },
      verificationStatuses: { createVerificationStatus, checkVerificationStatus },
    },
  } = tenant;

  router.get('/', async (ctx, next) => {
    const { id: userId } = ctx.auth;

    const user = await findUserById(userId);

    const responseData = {
      ...pick(user, ...userInfoSelectFields),
      ...conditional(user.passwordEncrypted && { hasPassword: Boolean(user.passwordEncrypted) }),
    };

    ctx.body = responseData;

    return next();
  });

  router.patch(
    '/',
    koaGuard({
      body: object({
        username: string().regex(usernameRegEx), // OSS only
        primaryEmail: string().regex(emailRegEx), // Cloud only
        name: string().or(literal('')).nullable(),
        avatar: string().url().or(literal('')).nullable(),
      }).partial(),
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { body } = ctx.guard;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      const { primaryEmail } = body;
      if (primaryEmail) {
        // Check if user has verified email within 10 minutes.
        await checkVerificationStatus(userId, primaryEmail);
      }

      await checkIdentifierCollision(body, userId);

      const updatedUser = await updateUserById(userId, body);
      ctx.body = pick(updatedUser, ...userInfoSelectFields);

      return next();
    }
  );

  router.delete('/', async (ctx, next) => {
    const { id: userId } = ctx.auth;

    const user = await findUserById(userId);
    assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

    // Sign out the user before deleting the account
    await signOutUser(userId);

    // Delete the user account
    await deleteUserById(userId);

    ctx.status = 204;

    return next();
  });

  router.get('/custom-data', async (ctx, next) => {
    const { id: userId } = ctx.auth;
    const user = await findUserById(userId);
    assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

    ctx.body = user.customData;

    return next();
  });

  router.patch(
    '/custom-data',
    koaGuard({
      body: jsonObjectGuard,
      response: jsonObjectGuard,
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { body: customData } = ctx.guard;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      const updatedUser = await updateUserById(userId, {
        customData,
      });

      ctx.body = updatedUser.customData;

      return next();
    }
  );

  router.post(
    '/password/verify',
    koaGuard({
      body: object({ password: string() }),
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { password } = ctx.guard.body;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      await verifyUserPassword(user, password);
      await createVerificationStatus(userId, null);

      ctx.status = 204;

      return next();
    }
  );

  router.post(
    '/password',
    koaGuard({ body: object({ password: string().min(1) }), status: [204, 400, 401] }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { password } = ctx.guard.body;

      const user = await findUserById(userId);

      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      const [signInExperience] = await Promise.all([
        findDefaultSignInExperience(),
        ...condArray(user.passwordEncrypted && [checkVerificationStatus(userId, null)]),
      ]);
      const passwordPolicyChecker = new PasswordPolicyChecker(signInExperience.passwordPolicy);
      const issues = await checkPasswordPolicyForUser(passwordPolicyChecker, password, user);

      if (issues.length > 0) {
        throw new RequestError('password.rejected', { issues });
      }

      const { passwordEncrypted, passwordEncryptionMethod } = await encryptUserPassword(password);
      await updateUserById(userId, { passwordEncrypted, passwordEncryptionMethod });

      ctx.status = 204;

      return next();
    }
  );

  router.get(
    '/activities',
    koaPagination(),
    koaGuard({
      query: object({
        page: number().optional(),
        page_size: number().optional(),
      }),
      response: object({
        data: object({
          id: string(),
          key: string(),
          payload: object({}).passthrough(),
          createdAt: string(),
        }).array(),
        totalCount: number(),
      }),
      status: 200,
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { limit, offset } = ctx.pagination;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      // Define allowed activity log prefixes - exclude sensitive operations like token issuing
      const allowedKeyPrefixes: AllowedKeyPrefix[] = [
        interaction.prefix, // User interactions (login, register, password reset, etc.)
        saml.prefix, // SAML activities
        jwtCustomizer.prefix, // JWT customizations (less sensitive)
      ];

      // Query logs for the specific user
      const [{ count }, logs] = await Promise.all([
        countLogs({
          payload: { userId },
          includeKeyPrefix: allowedKeyPrefixes,
        }),
        findLogs(limit, offset, {
          payload: { userId },
          includeKeyPrefix: allowedKeyPrefixes,
        }),
      ]);

      // Filter out sensitive payload information
      const filteredLogs = logs.map((log) => {
        const safePayload: Record<string, unknown> = {};

        // Include non-sensitive information
        if (log.payload.ip) {
          safePayload.ip = log.payload.ip;
        }
        if (log.payload.userAgent) {
          safePayload.userAgent = log.payload.userAgent;
        }
        if (log.payload.result) {
          safePayload.result = log.payload.result;
        }
        if (log.payload.error) {
          safePayload.error = log.payload.error;
        }
        if (log.payload.interactionEvent) {
          safePayload.interactionEvent = log.payload.interactionEvent;
        }
        if (log.payload.applicationId) {
          safePayload.applicationId = log.payload.applicationId;
        }

        return {
          id: log.id,
          key: log.key,
          payload: safePayload,
          createdAt: log.createdAt,
        };
      });

      // Return totalCount to pagination middleware
      const responseBody = {
        data: filteredLogs,
        totalCount: count,
      };

      // Set the totalCount for pagination middleware
      Object.defineProperty(ctx.pagination, 'totalCount', {
        value: count,
        writable: false,
        configurable: true,
      });

      ctx.body = responseBody;

      return next();
    }
  );
}
