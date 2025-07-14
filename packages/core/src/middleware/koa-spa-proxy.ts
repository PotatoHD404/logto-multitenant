import fs from 'node:fs/promises';
import path from 'node:path';

import type { MiddlewareType } from 'koa';
import proxy from 'koa-proxies';
import type { IRouterParamContext } from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import serveStatic from '#src/middleware/koa-serve-static.js';
import type Queries from '#src/tenants/Queries.js';
import { getConsoleLogFromContext } from '#src/utils/console.js';

import serveCustomUiAssets from './koa-serve-custom-ui-assets.js';

type Properties = {
  readonly mountedApps: string[];
  readonly queries: Queries;
  readonly packagePath?: string;
  readonly port?: number;
  readonly prefix?: string;
};

export default function koaSpaProxy<StateT, ContextT extends IRouterParamContext, ResponseBodyT>({
  mountedApps,
  packagePath = 'experience',
  port = 5001,
  prefix = '',
  queries,
}: Properties): MiddlewareType<StateT, ContextT, ResponseBodyT> {
  type Middleware = MiddlewareType<StateT, ContextT, ResponseBodyT>;

  const distributionPath = path.join('node_modules/@logto', packagePath, 'dist');

  const spaProxy: Middleware = EnvSet.values.isProduction
    ? serveStatic(distributionPath)
    : proxy('*', {
        target: `http://localhost:${port}`,
        changeOrigin: true,
        logs: (ctx, target) => {
          // Ignoring static file requests in development since vite will load a crazy amount of files
          if (path.basename(ctx.request.path).includes('.')) {
            return;
          }
          getConsoleLogFromContext(ctx).plain(`\tproxy --> ${target}`);
        },
        rewrite: (requestPath) => {
          return '/' + path.join(prefix, requestPath);
        },
      });

  // Break down complex function into smaller functions
  const shouldSkipRequest = (requestPath: string, prefix: string, mountedApps: string[]): boolean => {
    // Skip if the request is for another app
    if (!prefix && mountedApps.some((app) => app !== prefix && requestPath.startsWith(`/${app}`))) {
      return true;
    }

    // Skip API-related paths that should be handled by the main API server
    return (
      requestPath.startsWith('/api/') ||
      requestPath.startsWith('/m/') ||
      requestPath.startsWith('/my-account') ||
      requestPath.startsWith('/verifications') ||
      requestPath.startsWith('/oidc/') ||
      requestPath.startsWith('/me/') ||
      requestPath.startsWith('/.well-known/')
    );
  };

  const shouldServeCustomUi = async (
    queries: Queries,
    packagePath: string
  ): Promise<{ shouldServe: boolean; customUiAssets?: any }> => {
    if (packagePath !== 'experience') {
      return { shouldServe: false };
    }

    const { customUiAssets } = await queries.signInExperiences.findDefaultSignInExperience();
    return { shouldServe: Boolean(customUiAssets), customUiAssets };
  };

  const shouldFallbackToRoot = async (
    requestPath: string,
    distributionPath: string
  ): Promise<boolean> => {
    if (requestPath.startsWith('/assets/')) {
      return false;
    }

    const spaDistributionFiles = await fs.readdir(distributionPath);
    return !spaDistributionFiles.some((file) => requestPath.startsWith('/' + file));
  };

  return async (ctx, next) => {
    const requestPath = ctx.request.path;

    // Skip if the request should be handled by other middleware
    if (shouldSkipRequest(requestPath, prefix, mountedApps)) {
      return next();
    }

    // Check if we should serve custom UI assets
    const { shouldServe, customUiAssets } = await shouldServeCustomUi(queries, packagePath);
    if (shouldServe && customUiAssets) {
      const serve = serveCustomUiAssets(customUiAssets.id);
      return serve(ctx, next);
    }

    if (!EnvSet.values.isProduction) {
      return spaProxy(ctx, next);
    }

    // Fall back to root if the request is not for a SPA distribution file
    if (await shouldFallbackToRoot(requestPath, distributionPath)) {
      ctx.request.path = '/';
    }

    // Add a header to indicate which static package is being served
    ctx.set('Logto-Static-Package', packagePath);

    return spaProxy(ctx, next);
  };
}
