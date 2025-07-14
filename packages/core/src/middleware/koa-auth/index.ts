import { adminTenantId, defaultManagementApi, PredefinedScope } from '@logto/schemas';
import type { Optional } from '@silverhand/essentials';
import type { JWK } from 'jose';
import { createLocalJWKSet, jwtVerify } from 'jose';
import type { MiddlewareType, Request } from 'koa';
import type { IMiddleware, IRouterParamContext } from 'koa-router';
import { HTTPError } from 'ky';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';
import { devConsole, debugConsole } from '#src/utils/console.js';

import { type WithAuthContext, type TokenInfo } from './types.js';
import { extractBearerTokenFromHeaders, getAdminTenantTokenValidationSet } from './utils.js';

export * from './types.js';
export * from './constants.js';

export const verifyBearerTokenFromRequest = async (
  envSet: EnvSet,
  request: Request,
  audience: Optional<string>,
  tenant?: TenantContext
): Promise<TokenInfo> => {
  const { isProduction, isIntegrationTest, developmentUserId } = EnvSet.values;
  const userId = request.headers['development-user-id']?.toString() ?? developmentUserId;

  if ((!isProduction || isIntegrationTest) && userId) {
    // This log is distracting in integration tests.
    if (!isIntegrationTest) {
      devConsole.warn(`Found dev user ID ${userId}, skip token validation.`);
    }

    return {
      sub: userId,
      clientId: undefined,
      scopes: defaultManagementApi.scopes.map(({ name }) => name),
    };
  }

  const [keys, issuer] = await getKeysAndIssuer(envSet);
  const bearerToken = extractBearerTokenFromHeaders(request.headers);

  return verifyJwtToken(bearerToken, keys, issuer, audience);
};

const getKeysAndIssuer = async (envSet: EnvSet): Promise<[JWK[], string[]]> => {
  const { publicJwks, issuer } = envSet.oidc;

  debugConsole.warn('envSet.tenantId:', envSet.tenantId);
  debugConsole.warn('adminTenantId:', adminTenantId);
  debugConsole.warn('publicJwks length:', publicJwks.length);
  debugConsole.warn('issuer:', issuer);

  if (envSet.tenantId === adminTenantId) {
    debugConsole.warn('Using admin tenant keys only');
    return [publicJwks, [issuer]];
  }

  const adminSet = await getAdminTenantTokenValidationSet();
  debugConsole.warn('adminSet keys length:', adminSet.keys.length);
  debugConsole.warn('adminSet issuer:', adminSet.issuer);

  return [
    [...publicJwks, ...adminSet.keys],
    [issuer, ...adminSet.issuer],
  ];
};

const verifyJwtToken = async (
  bearerToken: string,
  keys: JWK[],
  issuer: string[],
  audience: Optional<string>
): Promise<TokenInfo> => {
  debugConsole.warn('Bearer token length:', bearerToken.length);
  debugConsole.warn('Bearer token first 50 chars:', bearerToken.slice(0, 50));
  debugConsole.warn('Total keys for verification:', keys.length);
  debugConsole.warn('Issuers for verification:', issuer);
  debugConsole.warn('Audience for verification:', audience);

  try {
    const {
      payload: { sub, client_id: clientId, scope = '', jti },
    } = await jwtVerify(bearerToken, createLocalJWKSet({ keys }), {
      issuer,
      audience,
    });

    assertThat(sub, new RequestError({ code: 'auth.jwt_sub_missing', status: 401 }));

    // Check if the JWT token is blacklisted (revoked)
    // if (jti && tenant) {
    //   const isBlacklisted = await tenant.queries.oidcModelInstances.isJwtBlacklisted(String(jti));
    //   if (isBlacklisted) {
    //     throw new RequestError({ code: 'auth.jwt_revoked', status: 401 });
    //   }
    // }

    return { sub, clientId, scopes: z.string().parse(scope).split(' ') };
  } catch (error: unknown) {
    debugConsole.warn('JWT verification failed with error:', error);
    debugConsole.warn(
      'Error type:',
      error instanceof Error ? error.constructor.name : typeof error
    );
    debugConsole.warn('Error message:', error instanceof Error ? error.message : String(error));

    if (error instanceof RequestError) {
      throw error;
    }

    /**
     * Handle potential errors when ky makes requests during validation
     * This may occur when fetching OIDC configuration from the oidc-config endpoint
     * `TypeError`: typically thrown when the fetch operation fails (e.g., network issues)
     * `HTTPError`: thrown by ky for non-2xx responses
     */
    if (error instanceof TypeError || error instanceof HTTPError) {
      throw error;
    }

    throw new RequestError({ code: 'auth.unauthorized', status: 401 }, error);
  }
};

export const isKoaAuthMiddleware = <Type extends IMiddleware>(function_: Type) =>
  function_.name === 'authMiddleware';

export default function koaAuth<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  envSet: EnvSet,
  audience: string
): MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> {
  const authMiddleware: MiddlewareType<StateT, WithAuthContext<ContextT>, ResponseBodyT> = async (
    ctx,
    next
  ) => {
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      envSet,
      ctx.request,
      audience
    );

    assertThat(
      scopes.includes(PredefinedScope.All),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );

    ctx.auth = {
      type: sub === clientId ? 'app' : 'user',
      id: sub,
      scopes: new Set(scopes),
    };

    return next();
  };

  return authMiddleware;
}
