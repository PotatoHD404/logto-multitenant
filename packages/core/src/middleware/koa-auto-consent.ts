import { buildDemoAppDataForTenant, demoAppApplicationId } from '@logto/schemas';
import { type MiddlewareType } from 'koa';
import { type IRouterParamContext } from 'koa-router';
import type { Provider } from 'oidc-provider';
import { errors } from 'oidc-provider';

import { consent, getMissingScopes } from '#src/libraries/session.js';
import type Queries from '#src/tenants/Queries.js';
import assertThat from '#src/utils/assert-that.js';

/**
 * Automatically consent for the first party apps.
 */

export default function koaAutoConsent<StateT, ContextT extends IRouterParamContext, ResponseBodyT>(
  provider: Provider,
  query: Queries
): MiddlewareType<StateT, ContextT, ResponseBodyT> {
  return async (ctx, next) => {
    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
    const {
      params: { client_id: clientId },
      prompt,
    } = interactionDetails;

    const {
      applications: { findApplicationById },
    } = query;

    assertThat(
      clientId && typeof clientId === 'string',
      new errors.InvalidClient('client must be available')
    );

    const application =
      clientId === demoAppApplicationId
        ? buildDemoAppDataForTenant('')
        : await findApplicationById(clientId);

    const shouldAutoConsent = !application.isThirdParty;

    console.log(`[DEBUG] koaAutoConsent: client=${clientId}, isThirdParty=${application.isThirdParty}, shouldAutoConsent=${shouldAutoConsent}`);

    if (shouldAutoConsent) {
      const { missingOIDCScope: missingOIDCScopes, missingResourceScopes: resourceScopesToGrant } =
        getMissingScopes(prompt);

      console.log(`[DEBUG] koaAutoConsent: missingOIDCScopes=${JSON.stringify(missingOIDCScopes)}`);
      console.log(`[DEBUG] koaAutoConsent: resourceScopesToGrant=${JSON.stringify(resourceScopesToGrant)}`);

      const redirectTo = await consent({
        ctx,
        provider,
        queries: query,
        interactionDetails,
        missingOIDCScopes,
        resourceScopesToGrant,
      });

      console.log(`[DEBUG] koaAutoConsent: Redirecting to ${redirectTo}`);
      ctx.redirect(redirectTo);
      return;
    }

    return next();
  };
}
