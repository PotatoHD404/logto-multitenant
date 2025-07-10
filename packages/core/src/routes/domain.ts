import { Domains, domainResponseGuard, domainSelectFields } from '@logto/schemas';
import { pick, trySafe } from '@silverhand/essentials';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { createTenantAuthMiddleware } from '#src/middleware/koa-tenant-auth.js';
import assertThat from '#src/utils/assert-that.js';

import type { ManagementApiRouter, RouterInitArgs } from './types.js';

export default function domainRoutes<T extends ManagementApiRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  const { id: tenantId, queries, libraries } = tenant;
  
  // Create tenant auth middleware with the actual current tenant ID from context
  const { koaTenantReadAuth, koaTenantWriteAuth } = createTenantAuthMiddleware(queries, tenant.id);
  
  const {
    domains: { findAllDomains, findDomainById },
  } = queries;
  const {
    domains: { syncDomainStatus, addDomain, deleteDomain },
    samlApplications: { syncCustomDomainsToSamlApplicationRedirectUrls },
  } = libraries;

  router.get(
    '/domains',
    koaGuard({ response: domainResponseGuard.array(), status: [200, 403] }),
    koaTenantReadAuth,
    async (ctx, next) => {
      const domains = await findAllDomains();
      const syncedDomains = await Promise.all(
        domains.map(async (domain) => syncDomainStatus(domain))
      );

      void trySafe(async () =>
        syncCustomDomainsToSamlApplicationRedirectUrls(tenantId, [...syncedDomains])
      );

      ctx.body = syncedDomains.map((domain) => pick(domain, ...domainSelectFields));

      return next();
    }
  );

  router.get(
    '/domains/:id',
    koaGuard({
      params: z.object({ id: z.string() }),
      response: domainResponseGuard,
      status: [200, 403, 404],
    }),
    koaTenantReadAuth,
    async (ctx, next) => {
      const {
        params: { id },
      } = ctx.guard;

      const domain = await findDomainById(id);
      const syncedDomain = await syncDomainStatus(domain);

      void trySafe(async () => {
        const domains = await findAllDomains();
        const syncedDomains = await Promise.all(
          domains.map(async (domain) => syncDomainStatus(domain))
        );
        await syncCustomDomainsToSamlApplicationRedirectUrls(tenantId, [...syncedDomains]);
      });

      ctx.body = pick(syncedDomain, ...domainSelectFields);

      return next();
    }
  );

  router.post(
    '/domains',
    koaGuard({
      body: Domains.createGuard.pick({ domain: true }),
      response: domainResponseGuard,
      status: [201, 400, 403, 422],
    }),
    koaTenantWriteAuth,
    async (ctx, next) => {
      const existingDomains = await findAllDomains();
      assertThat(
        existingDomains.length === 0,
        new RequestError({
          code: 'domain.limit_to_one_domain',
          status: 422,
        })
      );

      // Throw 400 error if domain is invalid
      const syncedDomain = await addDomain(ctx.guard.body.domain);

      ctx.status = 201;
      ctx.body = pick(syncedDomain, ...domainSelectFields);

      return next();
    }
  );

  router.delete(
    '/domains/:id',
    koaGuard({ params: z.object({ id: z.string() }), status: [204, 403, 404] }),
    koaTenantWriteAuth,
    async (ctx, next) => {
      const { id } = ctx.guard.params;
      await deleteDomain(id);

      await trySafe(async () => {
        const domains = await findAllDomains();
        const syncedDomains = await Promise.all(
          domains.map(async (domain) => syncDomainStatus(domain))
        );
        await syncCustomDomainsToSamlApplicationRedirectUrls(tenantId, [...syncedDomains]);
      });

      ctx.status = 204;

      return next();
    }
  );
}
