import { getManagementApiResourceIndicator, getTenantOrganizationId, adminTenantId } from '@logto/schemas';
import Koa from 'koa';
import Router from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import koaAuditLog from '#src/middleware/koa-audit-log.js';
import koaBodyEtag from '#src/middleware/koa-body-etag.js';
import { koaManagementApiHooks } from '#src/middleware/koa-management-api-hooks.js';
import koaTenantGuard from '#src/middleware/koa-tenant-guard.js';
import type TenantContext from '#src/tenants/TenantContext.js';

import koaAuth, { verifyBearerTokenFromRequest } from '../middleware/koa-auth/index.js';
import koaOidcAuth from '../middleware/koa-auth/koa-oidc-auth.js';
import koaCors from '../middleware/koa-cors.js';
import { buildOrganizationUrn } from '@logto/core-kit';
import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';
import type { WithAuthContext } from '../middleware/koa-auth/index.js';
import RequestError from '../errors/RequestError/index.js';
import assertThat from '../utils/assert-that.js';

import { accountApiPrefix } from './account/constants.js';
import accountRoutes from './account/index.js';
import accountCentersRoutes from './account-center/index.js';
import adminUserRoutes from './admin-user/index.js';
import applicationOrganizationRoutes from './applications/application-organization.js';
import applicationProtectedAppMetadataRoutes from './applications/application-protected-app-metadata.js';
import applicationRoleRoutes from './applications/application-role.js';
import applicationSecretRoutes from './applications/application-secret.js';
import applicationSignInExperienceRoutes from './applications/application-sign-in-experience.js';
import applicationUserConsentOrganizationRoutes from './applications/application-user-consent-organization.js';
import applicationUserConsentScopeRoutes from './applications/application-user-consent-scope.js';
import applicationRoutes from './applications/application.js';
import authnRoutes from './authn.js';
import captchaProviderRoutes from './captcha-provider/index.js';
import connectorRoutes from './connector/index.js';
import customPhraseRoutes from './custom-phrase.js';
import customProfileFieldsRoutes from './custom-profile-fields.js';
import dashboardRoutes from './dashboard.js';
import domainRoutes from './domain.js';
import emailTemplateRoutes from './email-template/index.js';
import experienceApiRoutes from './experience/index.js';
import googleOneTapRoutes, { googleOneTapApiPrefix } from './google-one-tap/index.js';
import hookRoutes from './hook.js';
import interactionRoutes from './interaction/index.js';
import logRoutes from './log.js';
import logtoConfigRoutes from './logto-config/index.js';
import oneTimeTokenRoutes from './one-time-tokens.js';
import organizationRoutes from './organization/index.js';
import publicWellKnownRoutes from './public-wellknown.js';
import resourceRoutes from './resource.js';
import resourceScopeRoutes from './resource.scope.js';
import roleRoutes from './role.js';
import roleScopeRoutes from './role.scope.js';
import samlApplicationAnonymousRoutes from './saml-application/anonymous.js';
import samlApplicationRoutes from './saml-application/index.js';
import sentinelActivitiesRoutes from './sentinel-activities.js';
import signInExperiencesRoutes from './sign-in-experience/index.js';
import ssoConnectors from './sso-connector/index.js';
import statusRoutes from './status.js';
import subjectTokenRoutes from './subject-token.js';
import swaggerRoutes from './swagger/index.js';
import systemRoutes from './system.js';
import tenantRoutes from './tenant.js';
import tenantMemberRoutes from './tenant-members.js';
import type { AnonymousRouter, ManagementApiRouter, UserRouter } from './types.js';
import userAssetsRoutes from './user-assets.js';
import verificationRoutes, { verificationApiPrefix } from './verification/index.js';
import verificationCodeRoutes from './verification-code.js';
import wellKnownRoutes from './well-known/index.js';
import wellKnownOpenApiRoutes from './well-known/well-known.openapi.js';

/**
 * Custom organization auth middleware for management API that accepts organization tokens
 * and validates tenant-specific access.
 */
function koaOrganizationManagementAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  tenant: TenantContext
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // For organization tokens, construct the expected audience for this tenant
    const expectedAudience = getTenantOrganizationId(tenant.id);
    const organizationAudience = buildOrganizationUrn(expectedAudience);
    
    // Verify JWT with the correct audience for this tenant
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      tenant.envSet,
      ctx.request,
      organizationAudience, // Validate audience matches tenant organization
      tenant // Pass tenant for blacklist check
    );

    // Validate scopes - organization tokens have specific scopes
    const hasValidScopes = scopes.some(scope => 
      scope === 'all' || 
      scope.includes('manage:') || 
      scope.includes('read:') || 
      scope.includes('write:') || 
      scope.includes('delete:')
    );

    assertThat(
      hasValidScopes,
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );

    ctx.auth = {
      type: sub === clientId ? 'app' : 'user',
      id: sub,
      scopes: new Set(scopes),
    };

    return next();
  };
}

/**
 * Management API auth middleware for cross-tenant operations.
 * Uses management API tokens with tenant management scopes.
 */
function koaCrossTenantManagementAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  tenant: TenantContext
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // For cross-tenant operations, use the admin tenant's management API resource indicator
    // This ensures tokens issued by the admin tenant are accepted for cross-tenant operations
    const managementApiAudience = getManagementApiResourceIndicator(adminTenantId);
    
    // Verify JWT with the admin tenant's management API audience
    // Skip tenant context to avoid blacklist check against wrong tenant
    // (JWT issued by admin tenant but processed in default tenant context)
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      tenant.envSet,
      ctx.request,
      managementApiAudience, // Validate audience matches admin tenant management API
      undefined // Skip blacklist check for cross-tenant operations
    );

    // Debug logging
    console.log('Cross-tenant auth debug:', {
      managementApiAudience,
      scopes,
      path: ctx.request.path,
      method: ctx.request.method
    });

    // Validate scopes - management API tokens should have tenant management scopes
    const hasValidScopes = scopes.some(scope => 
      scope === 'all' || 
      scope === 'create:tenant' ||
      scope === 'manage:tenant:self' ||
      scope.includes('tenant:') ||
      scope.includes('manage:tenant')
    );

    console.log('Scope validation result:', { hasValidScopes, scopes });

    assertThat(
      hasValidScopes,
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );

    ctx.auth = {
      type: sub === clientId ? 'app' : 'user',
      id: sub,
      scopes: new Set(scopes),
    };

    return next();
  };
}

/**
 * Create routers for admin tenant - organization-based multi-tenancy for managing all tenants
 */
const createAdminRouters = (tenant: TenantContext) => {
  // Admin tenant interaction router (for admin console auth flows)
  const interactionRouter: AnonymousRouter = new Router();
  /** @deprecated */
  interactionRoutes(interactionRouter, tenant);

  // Admin tenant experience router (for admin console sign-in experience)
  const experienceRouter: AnonymousRouter = new Router();
  experienceRouter.use(koaAuditLog(tenant.queries));
  experienceApiRoutes(experienceRouter, tenant);

  // Management API router - organization-based multi-tenancy
  const managementRouter: ManagementApiRouter = new Router();
  managementRouter.use(koaOrganizationManagementAuth(tenant));
  managementRouter.use(koaTenantGuard(tenant.id, tenant.queries));
  managementRouter.use(koaManagementApiHooks(tenant.libraries.hooks));

  // All management routes for tenant-specific operations (organization-based auth)
  applicationRoutes(managementRouter, tenant);
  applicationRoleRoutes(managementRouter, tenant);
  applicationProtectedAppMetadataRoutes(managementRouter, tenant);
  applicationOrganizationRoutes(managementRouter, tenant);
  applicationSecretRoutes(managementRouter, tenant);
  applicationUserConsentScopeRoutes(managementRouter, tenant);
  applicationSignInExperienceRoutes(managementRouter, tenant);
  applicationUserConsentOrganizationRoutes(managementRouter, tenant);
  logtoConfigRoutes(managementRouter, tenant);
  connectorRoutes(managementRouter, tenant);
  resourceRoutes(managementRouter, tenant);
  resourceScopeRoutes(managementRouter, tenant);
  signInExperiencesRoutes(managementRouter, tenant);
  adminUserRoutes(managementRouter, tenant);
  logRoutes(managementRouter, tenant);
  roleRoutes(managementRouter, tenant);
  roleScopeRoutes(managementRouter, tenant);
  dashboardRoutes(managementRouter, tenant);
  customPhraseRoutes(managementRouter, tenant);
  hookRoutes(managementRouter, tenant);
  verificationCodeRoutes(managementRouter, tenant);
  userAssetsRoutes(managementRouter, tenant);
  domainRoutes(managementRouter, tenant);
  organizationRoutes(managementRouter, tenant);
  ssoConnectors(managementRouter, tenant);
  systemRoutes(managementRouter, tenant);
  subjectTokenRoutes(managementRouter, tenant);
  accountCentersRoutes(managementRouter, tenant);
  samlApplicationRoutes(managementRouter, tenant);
  emailTemplateRoutes(managementRouter, tenant);
  oneTimeTokenRoutes(managementRouter, tenant);
  captchaProviderRoutes(managementRouter, tenant);
  sentinelActivitiesRoutes(managementRouter, tenant);
  if (EnvSet.values.isDevFeaturesEnabled) {
    customProfileFieldsRoutes(managementRouter, tenant);
  }
  // Remove only cross-tenant tenant listing routes from organization-based router
  // Tenant member management is tenant-specific and should use organization tokens
  // tenantRoutes(managementRouter, tenant); // Cross-tenant: listing all tenants
  tenantMemberRoutes(managementRouter, tenant); // Tenant-specific: managing members of current tenant

  // Cross-tenant API router - management API tokens for direct /api/... access
  const crossTenantRouter: ManagementApiRouter = new Router();
  crossTenantRouter.use(koaCrossTenantManagementAuth(tenant));
  crossTenantRouter.use(koaTenantGuard(tenant.id, tenant.queries));
  crossTenantRouter.use(koaManagementApiHooks(tenant.libraries.hooks));

  // Cross-tenant operations - only tenant listing routes 
  tenantRoutes(crossTenantRouter, tenant);
  // tenantMemberRoutes(crossTenantRouter, tenant); // This is tenant-specific, not cross-tenant

  // Anonymous routers for admin tenant
  const anonymousRouter: AnonymousRouter = new Router();
  const logtoAnonymousRouter: AnonymousRouter = new Router();

  // Admin tenant user router (for admin console profile management)
  const userRouter: UserRouter = new Router();
  userRouter.use(koaOidcAuth(tenant));
  userRouter.use(koaManagementApiHooks(tenant.libraries.hooks));
  accountRoutes(userRouter, tenant);
  verificationRoutes(userRouter, tenant);

  // Anonymous APIs for admin tenant
  wellKnownRoutes(anonymousRouter, tenant);
  statusRoutes(anonymousRouter, tenant);
  authnRoutes(anonymousRouter, tenant);
  samlApplicationAnonymousRoutes(anonymousRouter, tenant);
  googleOneTapRoutes(logtoAnonymousRouter, tenant);

  wellKnownOpenApiRoutes(anonymousRouter, {
    experienceRouters: [experienceRouter, interactionRouter],
    managementRouters: [managementRouter, crossTenantRouter, anonymousRouter, logtoAnonymousRouter],
    userRouters: [userRouter],
  });

  swaggerRoutes(anonymousRouter, [
    managementRouter,
    crossTenantRouter,
    anonymousRouter,
    logtoAnonymousRouter,
    experienceRouter,
    userRouter,
    interactionRouter,
  ]);

  return [
    experienceRouter,
    interactionRouter,
    managementRouter,
    crossTenantRouter,
    anonymousRouter,
    logtoAnonymousRouter,
    userRouter,
  ];
};

/**
 * Create routers for regular tenants - true multi-tenancy with tenant-scoped operations
 */
const createRegularRouters = (tenant: TenantContext) => {
  // Regular tenant interaction router (for tenant-specific auth flows)
  const interactionRouter: AnonymousRouter = new Router();
  interactionRoutes(interactionRouter, tenant);

  // Regular tenant experience router (for tenant-specific sign-in experience)
  const experienceRouter: AnonymousRouter = new Router();
  experienceRouter.use(koaAuditLog(tenant.queries));
  experienceApiRoutes(experienceRouter, tenant);

  // Anonymous routers for regular tenants
  const anonymousRouter: AnonymousRouter = new Router();
  const logtoAnonymousRouter: AnonymousRouter = new Router();

  // Regular tenant user router (for end-user profile management)
  const userRouter: UserRouter = new Router();
  userRouter.use(koaOidcAuth(tenant));
  userRouter.use(koaManagementApiHooks(tenant.libraries.hooks));
  accountRoutes(userRouter, tenant);
  verificationRoutes(userRouter, tenant);

  // Anonymous APIs for regular tenants
  wellKnownRoutes(anonymousRouter, tenant);
  statusRoutes(anonymousRouter, tenant);
  authnRoutes(anonymousRouter, tenant);
  samlApplicationAnonymousRoutes(anonymousRouter, tenant);
  googleOneTapRoutes(logtoAnonymousRouter, tenant);

  wellKnownOpenApiRoutes(anonymousRouter, {
    experienceRouters: [experienceRouter, interactionRouter],
    managementRouters: [anonymousRouter, logtoAnonymousRouter], // No management APIs
    userRouters: [userRouter],
  });

  swaggerRoutes(anonymousRouter, [
    anonymousRouter,
    logtoAnonymousRouter,
    experienceRouter,
    userRouter,
    interactionRouter,
  ]);

  return [
    experienceRouter,
    interactionRouter,
    anonymousRouter,
    logtoAnonymousRouter,
    userRouter,
  ];
};

export default function initApis(tenant: TenantContext): Koa {
  const apisApp = new Koa();
  const { adminUrlSet, cloudUrlSet, urlSet } = EnvSet.values;
  apisApp.use(
    koaCors(
      [adminUrlSet, cloudUrlSet, urlSet],
      [accountApiPrefix, verificationApiPrefix, googleOneTapApiPrefix]
    )
  );
  apisApp.use(koaBodyEtag());

  // Use different router creation functions for admin vs regular tenants
  const routers = tenant.id === adminTenantId 
    ? createAdminRouters(tenant)
    : createRegularRouters(tenant);

  for (const router of routers) {
    apisApp.use(router.routes()).use(router.allowedMethods());
  }

  return apisApp;
}

export function initPublicWellKnownApis(tenant: TenantContext): Koa {
  const globalApisApp = new Koa();
  const anonymousRouter: AnonymousRouter = new Router();
  publicWellKnownRoutes(anonymousRouter, tenant);
  globalApisApp.use(anonymousRouter.routes()).use(anonymousRouter.allowedMethods());

  return globalApisApp;
}
