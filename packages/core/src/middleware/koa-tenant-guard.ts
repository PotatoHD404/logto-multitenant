import type { Middleware } from 'koa';
import { type IRouterParamContext } from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type Queries from '#src/tenants/Queries.js';

export default function koaTenantGuard<StateT, ContextT extends IRouterParamContext, BodyT>(
  tenantId: string,
  { tenants }: Queries
): Middleware<StateT, ContextT, BodyT> {
  return async (ctx, next) => {
    const { isCloud } = EnvSet.values;

    if (!isCloud) {
      return next();
    }

    // Use the target tenant ID if available (for /m/{tenantId}/api routes)
    // or fall back to the current tenant ID
    const targetTenantId = (ctx as any).targetTenantId || tenantId;
    
    try {
      const { isSuspended } = await tenants.findTenantSuspendStatusById(targetTenantId);

      if (isSuspended) {
        throw new RequestError('subscription.tenant_suspended', 403);
      }
    } catch (error) {
      // If tenant doesn't exist, throw 404
      if (error instanceof Error && error.message.includes('not found')) {
        throw new RequestError('entity.not_found', 404);
      }
      throw error;
    }

    await next();
  };
}
