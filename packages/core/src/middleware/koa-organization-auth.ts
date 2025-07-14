import { getOrganizationIdFromUrn } from '@logto/core-kit';
import type { MiddlewareType, Request } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import RequestError from '#src/errors/RequestError/index.js';
import type { WithAuthContext } from '#src/middleware/koa-auth/index.js';
import type Queries from '#src/tenants/Queries.js';
import { debugConsole } from '#src/utils/console.js';

/**
 * Middleware to validate organization membership at runtime for organization tokens.
 * This ensures that users who have been removed from an organization cannot continue
 * using their existing organization tokens.
 *
 * Supports multi-tenancy by properly extracting organization IDs from JWT audiences.
 */
export default function koaOrganizationAuth<
  StateT,
  ContextT extends IRouterParamContext,
  ResponseBodyT,
>(queries: Queries): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  return async (ctx, next) => {
    // Skip if user is not authenticated
    if (!ctx.auth) {
      return next();
    }

    const { id: userId } = ctx.auth;

    // Extract organization ID from JWT audience or request context
    const organizationId = getOrganizationIdFromRequest(ctx.request, ctx.auth);

    if (!organizationId) {
      // Not an organization-scoped request, proceed normally
      return next();
    }

    debugConsole.info(
      `Validating organization membership for user ${userId} in organization ${organizationId}`
    );

    try {
      // Validate that user is still a member of the organization
      const isMember = await queries.organizations.relations.users.exists({
        organizationId,
        userId,
      });

      if (!isMember) {
        throw new RequestError({
          code: 'auth.forbidden',
          message: 'User is no longer a member of the organization',
          status: 403,
        });
      }

      // Validate MFA requirements using the existing getMfaStatus method
      const { isMfaRequired, hasMfaConfigured } = await queries.organizations.getMfaStatus(
        organizationId,
        userId
      );

      if (isMfaRequired && !hasMfaConfigured) {
        throw new RequestError({
          code: 'auth.forbidden',
          message: 'Organization requires MFA but user has not configured it',
          status: 403,
        });
      }

      debugConsole.info(
        `Organization membership validated for user ${userId} in organization ${organizationId}`
      );

      await next();
    } catch (error) {
      if (error instanceof RequestError) {
        throw error;
      }

      // Log unexpected errors but treat as access denied for security
      debugConsole.warn(`Unexpected error during organization membership validation:`, error);
      throw new RequestError({
        code: 'auth.forbidden',
        message: 'Organization access validation failed',
        status: 403,
      });
    }
  };
}

/**
 * Extract organization ID from various request contexts:
 * 1. From JWT audience (urn:logto:organization:xxx) - primary method for organization tokens
 * 2. From request parameters (organization_id)
 * 3. From route parameters (/organizations/:id)
 * 4. From auth context audience
 */
function getOrganizationIdFromRequest(request: Request, auth: any): string | undefined {
  // Method 1: Extract from JWT audience in auth context
  // This is the primary method for organization tokens
  if (auth?.audience) {
    const audience = Array.isArray(auth.audience) ? auth.audience[0] : auth.audience;
    if (typeof audience === 'string' && audience.startsWith('urn:logto:organization:')) {
      const organizationId = getOrganizationIdFromUrn(audience);
      if (organizationId) {
        return organizationId;
      }
    }
  }

  // Method 2: From Authorization header (extract from JWT directly)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Simple JWT payload extraction without verification (since it's already verified)
      const parts = token.split('.');
      if (parts.length === 3 && parts[1]) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (
          payload.aud &&
          typeof payload.aud === 'string' &&
          payload.aud.startsWith('urn:logto:organization:')
        ) {
          const organizationId = getOrganizationIdFromUrn(payload.aud);
          if (organizationId) {
            return organizationId;
          }
        }
      }
    } catch {
      // Ignore JWT parsing errors, continue with other methods
    }
  }

  // Method 3: From query parameters or body
  const params = request.method === 'GET' ? request.query : (request as any).body;
  if (params && typeof params === 'object' && 'organization_id' in params) {
    return String(params.organization_id);
  }

  // Method 4: From route parameters (for /organizations/:id routes)
  if (request.url.includes('/organizations/')) {
    const match = /\/organizations\/([^/?]+)/.exec(request.url);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}
