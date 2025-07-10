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
import assertThat from '#src/utils/assert-that.js';
import { devConsole } from '#src/utils/console.js';

import { type WithAuthContext, type TokenInfo } from './types.js';
import { extractBearerTokenFromHeaders, getAdminTenantTokenValidationSet } from './utils.js';

export * from './types.js';
export * from './constants.js';

export const verifyBearerTokenFromRequest = async (
  envSet: EnvSet,
  request: Request,
  audience: Optional<string>
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

  const getKeysAndIssuer = async (): Promise<[JWK[], string[]]> => {
    const { publicJwks, issuer } = envSet.oidc;
    
    devConsole.warn('DEBUG: envSet.tenantId:', envSet.tenantId);
    devConsole.warn('DEBUG: adminTenantId:', adminTenantId);
    devConsole.warn('DEBUG: publicJwks length:', publicJwks.length);
    devConsole.warn('DEBUG: issuer:', issuer);

    if (envSet.tenantId === adminTenantId) {
      devConsole.warn('DEBUG: Using admin tenant keys only');
      return [publicJwks, [issuer]];
    }

    const adminSet = await getAdminTenantTokenValidationSet();
    devConsole.warn('DEBUG: adminSet keys length:', adminSet.keys.length);
    devConsole.warn('DEBUG: adminSet issuer:', adminSet.issuer);

    return [
      [...publicJwks, ...adminSet.keys],
      [issuer, ...adminSet.issuer],
    ];
  };

  try {
    const bearerToken = extractBearerTokenFromHeaders(request.headers);
    devConsole.warn('DEBUG: Bearer token length:', bearerToken.length);
    devConsole.warn('DEBUG: Bearer token first 50 chars:', bearerToken.substring(0, 50));
    
    const [keys, issuer] = await getKeysAndIssuer();
    devConsole.warn('DEBUG: Total keys for verification:', keys.length);
    devConsole.warn('DEBUG: Issuers for verification:', issuer);
    devConsole.warn('DEBUG: Audience for verification:', audience);
    
    const {
      payload: { sub, client_id: clientId, scope = '' },
    } = await jwtVerify(
      bearerToken,
      createLocalJWKSet({ keys }),
      {
        issuer,
        audience,
      }
    );

    assertThat(sub, new RequestError({ code: 'auth.jwt_sub_missing', status: 401 }));

    return { sub, clientId, scopes: z.string().parse(scope).split(' ') };
  } catch (error: unknown) {
    devConsole.warn('DEBUG: JWT verification failed with error:', error);
    devConsole.warn('DEBUG: Error type:', error instanceof Error ? error.constructor.name : typeof error);
    devConsole.warn('DEBUG: Error message:', error instanceof Error ? error.message : String(error));
    
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
