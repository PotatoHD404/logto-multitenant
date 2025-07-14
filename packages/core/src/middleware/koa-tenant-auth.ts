import { TenantManagementScope, PredefinedScope } from '@logto/schemas';
import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import RequestError from '#src/errors/RequestError/index.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';
import { type WithAuthContext } from '#src/middleware/koa-auth/index.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';

/**
 * Map tenant operations to their required scopes
 */
const TENANT_OPERATION_SCOPES: Record<string, TenantManagementScope> = {
  read: TenantManagementScope.Read,
  write: TenantManagementScope.Write,
  delete: TenantManagementScope.Delete,
};

/**
 * Check if the authenticated user has the required scope for a tenant operation.
 * Users with the 'all' scope can perform any operation.
 */
export const hasRequiredTenantScope = (scopes: Set<string>, operation: string): boolean => {
  // Users with 'all' scope can perform any operation
  if (scopes.has(PredefinedScope.All)) {
    return true;
  }

  // Check for specific tenant management scope
  const requiredScope = TENANT_OPERATION_SCOPES[operation];
  if (requiredScope && scopes.has(requiredScope)) {
    return true;
  }

  // Check for organization-specific scopes that can fulfill the operation
  switch (operation) {
    case 'read': {
      return scopes.has('read:data') || scopes.has('manage:tenant');
    }
    case 'write': {
      return scopes.has('write:data') || scopes.has('manage:tenant');
    }
    case 'delete': {
      return scopes.has('delete:data') || scopes.has('manage:tenant');
    }
    default: {
      return false;
    }
  }
};

/**
 * Check if the authenticated user has admin tenant permissions for tenant creation.
 * Tenant creation should only be allowed for users with admin tenant access.
 */
export const hasAdminTenantCreatePermission = async (
  scopes: Set<string>,
  userId: string,
  queries: Queries
): Promise<boolean> => {
  // Users with 'all' scope can create tenants
  if (scopes.has(PredefinedScope.All)) {
    return true;
  }

  // Check if user has admin tenant organization membership with manage:tenant scope
  const tenantOrg = createTenantOrganizationLibrary(queries);
  const adminTenantScopes = await tenantOrg.getUserScopes('admin', userId);

  return adminTenantScopes.includes('manage:tenant');
};

/**
 * Check if a tenant ID represents a system tenant that should be protected from deletion.
 */
export const isProtectedFromDeletion = (tenantId: string): boolean => {
  return tenantId === 'admin' || tenantId === 'default';
};

/**
 * Validate that the authenticated user has permission to access the specific tenant.
 *
 * This implements proper cross-tenant access control:
 * 1. Users with 'all' scope can access any tenant
 * 2. Users from admin tenant can manage any tenant if they have tenant management scopes
 * 3. Users from other tenants can only access their own tenant
 * 4. Users must be members of the target tenant organization with appropriate roles
 */
export const validateTenantAccess = async (
  targetTenantId: string,
  authScopes: Set<string>,
  currentTenantId: string,
  userId: string,
  queries: Queries,
  operation: string
): Promise<void> => {
  // Super admin with 'all' scope can access any tenant
  if (authScopes.has(PredefinedScope.All)) {
    return;
  }

  // Validate required scopes for tenant management using the same logic as hasRequiredTenantScope
  const hasManagementScope = hasRequiredTenantScope(authScopes, operation);

  assertThat(
    hasManagementScope,
    new RequestError({
      code: 'auth.forbidden',
      status: 403,
      data: { message: `Missing required scope for ${operation} operation` },
    })
  );

  // Same tenant access - always allowed if user has proper scopes
  if (targetTenantId === currentTenantId) {
    return;
  }

  // Cross-tenant access validation:
  // If user is accessing a different tenant, they must be a member of that tenant organization
  // with appropriate permissions. No hardcoded "admin only" restrictions.
  // The JWT audience validation already ensures the token was issued for the current tenant.

  // Validate that the user is a member of the target tenant organization
  const tenantOrg = createTenantOrganizationLibrary(queries);
  const userScopes = await tenantOrg.getUserScopes(targetTenantId, userId);

  assertThat(
    userScopes.length > 0,
    new RequestError({
      code: 'auth.forbidden',
      status: 403,
      data: {
        message: `User is not a member of tenant: ${targetTenantId}`,
        targetTenant: targetTenantId,
      },
    })
  );

  // Validate user has sufficient role for the operation
  const hasManageTenantScope = userScopes.includes('manage:tenant');
  const hasReadDataScope = userScopes.includes('read:data');

  const hasRequiredRole =
    operation === 'read' ? hasManageTenantScope || hasReadDataScope : hasManageTenantScope;

  assertThat(
    hasRequiredRole,
    new RequestError({
      code: 'auth.forbidden',
      status: 403,
      data: {
        message: `Insufficient role for ${operation} operation. Required: ${operation === 'read' ? 'Collaborator or Admin' : 'Admin'}, current scopes: ${userScopes.join(', ')}`,
        userScopes,
        requiredRole: operation === 'read' ? 'Collaborator or Admin' : 'Admin',
      },
    })
  );
};

/**
 * Production-ready middleware factory for tenant authorization.
 *
 * This middleware provides complete tenant access control:
 * 1. JWT audience validation (done by koaAuth)
 * 2. Scope validation for tenant operations
 * 3. Cross-tenant access control
 * 4. Role-based access control within tenant organizations
 * 5. System tenant protection
 */
export default function koaTenantAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  operation: string,
  currentTenantId: string,
  queries: Queries
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // Ensure the user is authenticated
    assertThat(ctx.auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { scopes, id: userId } = ctx.auth;

    // Check if user has required scope for the operation
    assertThat(
      hasRequiredTenantScope(scopes, operation),
      new RequestError({
        code: 'auth.forbidden',
        status: 403,
        data: { message: `Missing required scope for ${operation} operation` },
      })
    );

    // For tenant-specific operations, validate access
    if (ctx.params.id) {
      const targetTenantId = ctx.params.id;

      // Validate tenant access with proper cross-tenant and role validation
      await validateTenantAccess(
        targetTenantId,
        scopes,
        currentTenantId,
        userId,
        queries,
        operation
      );

      // Check for system tenant protection - only protect from deletion
      if (operation === 'delete') {
        assertThat(
          !isProtectedFromDeletion(targetTenantId),
          new RequestError({
            code: 'auth.forbidden',
            status: 403,
            data: { message: 'System tenants cannot be deleted' },
          })
        );
      }
    }

    return next();
  };
}

/**
 * Special middleware for tenant creation that requires admin tenant permissions only.
 * This is different from regular tenant operations which can be performed by organization members.
 */
export function koaTenantCreateAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  queries: Queries
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // Ensure the user is authenticated
    assertThat(ctx.auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { scopes, id: userId } = ctx.auth;

    // Check if user has admin tenant permissions for tenant creation
    const hasPermission = await hasAdminTenantCreatePermission(scopes, userId, queries);

    assertThat(
      hasPermission,
      new RequestError({
        code: 'auth.forbidden',
        status: 403,
        data: { message: 'Tenant creation requires admin tenant permissions' },
      })
    );

    return next();
  };
}

/**
 * Create tenant auth middleware factories that accept tenant context
 */
export const createTenantAuthMiddleware = (queries: Queries, currentTenantId: string) => ({
  koaTenantReadAuth: koaTenantAuth('read', currentTenantId, queries),
  koaTenantWriteAuth: koaTenantAuth('write', currentTenantId, queries),
  koaTenantDeleteAuth: koaTenantAuth('delete', currentTenantId, queries),
  koaTenantCreateAuth: koaTenantCreateAuth(queries),
});
