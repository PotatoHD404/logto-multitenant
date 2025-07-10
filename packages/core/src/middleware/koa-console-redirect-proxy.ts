import path from 'node:path';

import { ossConsolePath } from '@logto/schemas';
import type { MiddlewareType } from 'koa';
import type { IRouterParamContext } from 'koa-router';

import type Queries from '#src/tenants/Queries.js';

export default function koaConsoleRedirectProxy<
  StateT,
  ContextT extends IRouterParamContext,
  ResponseBodyT,
>(queries: Queries): MiddlewareType<StateT, ContextT, ResponseBodyT> {
  const { hasActiveUsers } = queries.users;

  return async (ctx, next) => {
    const hasUser = await hasActiveUsers();

    // Check for authentication more robustly
    const hasAuthHeader = Boolean(ctx.headers.authorization?.startsWith('Bearer '));
    const hasSessionCookie = Boolean(
      ctx.cookies.get('logto:admin') || 
      ctx.cookies.get('_interaction') ||
      ctx.cookies.get('_session')
    );
    const isAuthenticated = hasAuthHeader || hasSessionCookie;

    // Root path or console path handling
    if (ctx.path === '/' || ctx.path === ossConsolePath) {
      if (!hasUser) {
        // No users exist, show welcome page for account creation
      ctx.redirect(path.join(ossConsolePath, '/welcome'));
        return;
      }

      if (isAuthenticated) {
        // User exists and is authenticated, redirect to console
        ctx.redirect(path.join(ossConsolePath, '/default'));
      return;
    }

      // User exists but not authenticated, redirect to sign-in
      ctx.redirect('/sign-in?app_id=admin-console');
      return;
    }

    // Welcome page handling
    if (ctx.path === path.join(ossConsolePath, '/welcome')) {
      if (hasUser) {
        if (isAuthenticated) {
          // User exists and is authenticated, redirect to console
          ctx.redirect(path.join(ossConsolePath, '/default'));
          return;
        }
        // User exists but not authenticated, redirect to sign-in
        ctx.redirect('/sign-in?app_id=admin-console');
        return;
      }
      // No users exist, stay on welcome page
    }

    return next();
  };
}
