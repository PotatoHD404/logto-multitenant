import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';
import { TenantManagementScope, PredefinedScope } from '@logto/schemas';

import RequestError from '#src/errors/RequestError/index.js';
import { type WithAuthContext } from '#src/middleware/koa-auth/index.js';
import assertThat from '#src/utils/assert-that.js';

export type TenantOperation = 'read' | 'write' | 'delete';

/**
 * Map tenant operations to their required scopes
 */
const TENANT_OPERATION_SCOPES: Record<TenantOperation, TenantManagementScope> = {
  read: TenantManagementScope.Read,
  write: TenantManagementScope.Write,
  delete: TenantManagementScope.Delete,
};

/**
 * Check if the authenticated user has the required scope for a tenant operation.
 * Users with the 'all' scope can perform any operation.
 */
export const hasRequiredTenantScope = (
  scopes: Set<string>,
  operation: TenantOperation
): boolean => {
  // Users with 'all' scope can perform any operation
  if (scopes.has(PredefinedScope.All)) {
    return true;
  }

  // Check for specific tenant management scope
  const requiredScope = TENANT_OPERATION_SCOPES[operation];
  return scopes.has(requiredScope);
};

/**
 * Check if a tenant ID represents a system tenant that should be protected from deletion.
 */
export const isProtectedFromDeletion = (tenantId: string): boolean => {
  return tenantId === 'admin' || tenantId === 'default';
};

/**
 * Middleware factory to create tenant authorization middleware for specific operations.
 * This middleware checks if the authenticated user has the required permissions for tenant operations.
 */
export default function koaTenantAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  operation: TenantOperation
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // Ensure the user is authenticated
    assertThat(ctx.auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { scopes } = ctx.auth;

    // Check if user has required scope for the operation
    assertThat(
      hasRequiredTenantScope(scopes, operation),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );

    // Check for system tenant protection - only protect from deletion
    if (ctx.params?.id && operation === 'delete') {
      const tenantId = ctx.params.id as string;
      
      // Both 'admin' and 'default' cannot be deleted
      assertThat(
        !isProtectedFromDeletion(tenantId),
        new RequestError({ code: 'auth.forbidden', status: 403 })
      );
    }

    return next();
  };
}

/**
 * Middleware for tenant read operations (GET /tenants, GET /tenants/:id)
 */
export const koaTenantReadAuth = koaTenantAuth('read');

/**
 * Middleware for tenant write operations (POST /tenants, PATCH /tenants/:id)
 */
export const koaTenantWriteAuth = koaTenantAuth('write');

/**
 * Middleware for tenant delete operations (DELETE /tenants/:id)
 */
export const koaTenantDeleteAuth = koaTenantAuth('delete'); 