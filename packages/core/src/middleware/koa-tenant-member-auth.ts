import { TenantScope, TenantManagementScope, PredefinedScope } from '@logto/schemas';
import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import RequestError from '#src/errors/RequestError/index.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';
import { type WithAuthContext } from '#src/middleware/koa-auth/index.js';
import {
  hasRequiredTenantScope,
  isProtectedFromDeletion,
} from '#src/middleware/koa-tenant-auth.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';

/**
 * Map tenant member operations to their required tenant scopes
 */
const TENANT_MEMBER_OPERATION_SCOPES: Record<string, TenantScope[]> = {
  read: [TenantScope.ReadMember],
  invite: [TenantScope.InviteMember],
  remove: [TenantScope.RemoveMember],
  'update-role': [TenantScope.UpdateMemberRole],
  'read-invitations': [TenantScope.ReadMember],
  'create-invitations': [TenantScope.InviteMember],
};

/**
 * Map tenant member operations to general tenant management scopes
 */
const TENANT_MEMBER_OPERATION_TENANT_SCOPES: Record<string, TenantManagementScope> =
  {
    read: TenantManagementScope.Read,
    invite: TenantManagementScope.Write,
    remove: TenantManagementScope.Write,
    'update-role': TenantManagementScope.Write,
    'read-invitations': TenantManagementScope.Read,
    'create-invitations': TenantManagementScope.Write,
  };

/**
 * Middleware factory to create tenant member authorization middleware for specific operations.
 * This middleware provides three levels of authorization:
 * 1. General tenant management permissions (TenantManagementScope)
 * 2. Tenant-specific access (user must be a member of the tenant organization)
 * 3. Granular member operation permissions (TenantScope)
 */
export default function koaTenantMemberAuth<
  StateT,
  ContextT extends IRouterParamContext,
  ResponseBodyT,
>(
  operation: string,
  queries: Queries
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  const tenantOrg = createTenantOrganizationLibrary(queries);

  return async (ctx, next) => {
    // Ensure the user is authenticated
    assertThat(ctx.auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { scopes, id: userId } = ctx.auth;
    const tenantId = ctx.params.tenantId!;

    assertThat(tenantId, new RequestError({ code: 'request.invalid_input', status: 400 }));

    // Level 1: Check general tenant management permissions
    const requiredTenantScope = TENANT_MEMBER_OPERATION_TENANT_SCOPES[operation];
    const hasTenantManagementScope = hasRequiredTenantScope(
      scopes,
      requiredTenantScope === TenantManagementScope.Read
        ? 'read'
        : requiredTenantScope === TenantManagementScope.Write
          ? 'write'
          : 'delete'
    );

    // If user has 'all' scope or appropriate tenant management scope, they can access any tenant
    if (scopes.has(PredefinedScope.All) || hasTenantManagementScope) {
      // Check for system tenant protection
      if (operation === 'remove' || operation === 'update-role') {
        assertThat(
          !isProtectedFromDeletion(tenantId),
          new RequestError({ code: 'auth.forbidden', status: 403 })
        );
      }

      return next();
    }

    // Level 2: Check if user is a member of the specific tenant organization
    // Level 3: Check tenant-specific member operation permissions
    const userScopes = await tenantOrg.getUserScopes(tenantId, userId);
    const requiredScopes = TENANT_MEMBER_OPERATION_SCOPES[operation];
    const hasSpecificPermission = requiredScopes ? requiredScopes.every((scope) => userScopes.includes(scope)) : false;

    assertThat(
      hasSpecificPermission,
      new RequestError({
        code: 'auth.forbidden',
        status: 403,
        data: {
          operation,
          tenantId,
          requiredScopes: TENANT_MEMBER_OPERATION_SCOPES[operation],
        },
      })
    );

    // Additional protection for system tenants
    if (operation === 'remove' || operation === 'update-role') {
      assertThat(
        !isProtectedFromDeletion(tenantId),
        new RequestError({ code: 'auth.forbidden', status: 403 })
      );
    }

    return next();
  };
}

/**
 * Middleware for reading tenant members and invitations
 */
export const koaTenantMemberReadAuth = (queries: Queries) => koaTenantMemberAuth('read', queries);

/**
 * Middleware for inviting members to tenant
 */
export const koaTenantMemberInviteAuth = (queries: Queries) =>
  koaTenantMemberAuth('invite', queries);

/**
 * Middleware for removing members from tenant
 */
export const koaTenantMemberRemoveAuth = (queries: Queries) =>
  koaTenantMemberAuth('remove', queries);

/**
 * Middleware for updating member roles in tenant
 */
export const koaTenantMemberUpdateRoleAuth = (queries: Queries) =>
  koaTenantMemberAuth('update-role', queries);

/**
 * Middleware for reading tenant invitations
 */
export const koaTenantMemberReadInvitationsAuth = (queries: Queries) =>
  koaTenantMemberAuth('read-invitations', queries);

/**
 * Middleware for creating tenant invitations
 */
export const koaTenantMemberCreateInvitationsAuth = (queries: Queries) =>
  koaTenantMemberAuth('create-invitations', queries);
