import { adminTenantId } from '@logto/schemas';
import Koa from 'koa';
import Router from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type { WithAuthContext } from '#src/middleware/koa-auth/index.js';
import koaAuth from '#src/middleware/koa-auth/index.js';
import koaCors from '#src/middleware/koa-cors.js';
import { type WithI18nContext } from '#src/middleware/koa-i18next.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';

import mfaVerificationsRoutes from './mfa-verifications.js';
import sessionsRoutes from './sessions.js';
import socialRoutes from './social.js';
import userAssetsRoutes from './user-assets.js';
import userRoutes from './user.js';
import verificationCodeRoutes from './verification-code.js';

/**
 * Get the profile API resource indicator that matches the cloud version format.
 * This ensures consistency between cloud and local OSS deployments.
 */
const getProfileApiResourceIndicator = () => 'https://admin.logto.app/me';

export default function initMeApis(tenant: TenantContext): Koa {
  if (tenant.id !== adminTenantId) {
    throw new Error('`/me` routes should only be initialized in the admin tenant.');
  }

  const meRouter = new Router<unknown, WithAuthContext & WithI18nContext>();

  meRouter.use(
    koaAuth(tenant.envSet, getProfileApiResourceIndicator()),
    async (ctx, next) => {
      assertThat(
        ctx.auth.type === 'user',
        new RequestError({ code: 'auth.forbidden', status: 403 })
      );

      return next();
    }
  );

  userRoutes(meRouter, tenant);
  socialRoutes(meRouter, tenant);
  verificationCodeRoutes(meRouter, tenant);
  userAssetsRoutes(meRouter, tenant);
  mfaVerificationsRoutes(meRouter, tenant);
  sessionsRoutes(meRouter, tenant);

  const meApp = new Koa();
  meApp.use(koaCors([EnvSet.values.cloudUrlSet]));
  meApp.use(meRouter.routes()).use(meRouter.allowedMethods());

  return meApp;
}
