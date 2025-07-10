import { TenantTag, adminTenantId } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql } from '@silverhand/slonik';
import { object, string, nativeEnum, boolean } from 'zod';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import { koaTenantReadAuth, koaTenantWriteAuth, koaTenantDeleteAuth } from '#src/middleware/koa-tenant-auth.js';
import assertThat from '#src/utils/assert-that.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';

import type { ManagementApiRouter, RouterInitArgs } from './types.js';

type TenantDatabaseRow = {
  id: string;
  name: string;
  tag: TenantTag;
  created_at: Date;
  is_suspended: boolean;
};

type CountResult = {
  count: string;
};

type TenantWithDatabaseUser = {
  id: string;
  db_user: string;
};

const tenantResponseGuard = object({
  id: string(),
  name: string(),
  tag: nativeEnum(TenantTag),
  createdAt: string(),
  isSuspended: boolean().optional(),
});

const createTenantGuard = object({
  name: string().min(1).max(128),
  // For local OSS, use Production tag (no dev/prod distinction)
  // For cloud, use Development tag as default
  tag: nativeEnum(TenantTag).optional().default(
    EnvSet.values.isCloud ? TenantTag.Development : TenantTag.Production
  ),
});

const updateTenantGuard = object({
  name: string().min(1).max(128).optional(),
  tag: nativeEnum(TenantTag).optional(),
});



export default function tenantRoutes<T extends ManagementApiRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  const { isCloud } = EnvSet.values;

  // Skip tenant routes for cloud environment - use cloud API instead
  if (isCloud) {
    return;
  }

  const tenantOrg = createTenantOrganizationLibrary(queries);

  router.get(
    '/tenants',
    koaPagination({ isOptional: true }),
    koaGuard({
      response: tenantResponseGuard.array(),
      status: [200],
    }),
    koaTenantReadAuth,
    async (ctx, next) => {
      const { limit, offset, disabled } = ctx.pagination;

      if (disabled) {
              const sharedPool = await EnvSet.sharedPool;
      const tenants = await sharedPool.any<TenantDatabaseRow>(sql`
        SELECT id, name, tag, created_at, is_suspended
        FROM tenants 
        WHERE id != 'admin'
        ORDER BY created_at DESC
      `);
        ctx.body = tenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          tag: tenant.tag,
          createdAt: tenant.created_at.toISOString(),
          isSuspended: tenant.is_suspended,
        }));
        return next();
      }

      const sharedPool = await EnvSet.sharedPool;
      const [countResult, tenants] = await Promise.all([
        sharedPool.one<CountResult>(
          sql`SELECT COUNT(*) as count FROM tenants WHERE id != 'admin'`
        ),
        sharedPool.any<TenantDatabaseRow>(sql`
          SELECT id, name, tag, created_at, is_suspended
          FROM tenants 
          WHERE id != 'admin'
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
      ]);

      ctx.pagination.totalCount = Number(countResult.count);
      ctx.body = tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        tag: tenant.tag,
        createdAt: tenant.created_at.toISOString(),
        isSuspended: tenant.is_suspended,
      }));

      return next();
    }
  );

  router.post(
    '/tenants',
    koaGuard({
      body: createTenantGuard,
      response: tenantResponseGuard,
      status: [201, 400, 409],
    }),
    koaTenantWriteAuth,
    async (ctx, next) => {
      const { name, tag } = ctx.guard.body;
      const id = generateStandardId();

      // Generate database credentials for the tenant
      const databaseUser = `logto_tenant_${id}`;
      const databaseUserPassword = generateStandardId(32);

      try {
        // Use the shared admin pool for tenant management operations
        // This ensures we have the necessary permissions to create tenants
        const sharedPool = await EnvSet.sharedPool;
        
        // Create tenant record using shared admin pool
        const tenant = await sharedPool.one<TenantDatabaseRow>(sql`
          INSERT INTO tenants (id, name, tag, db_user, db_user_password, created_at, is_suspended)
          VALUES (${id}, ${name}, ${tag}, ${databaseUser}, ${databaseUserPassword}, NOW(), false)
          RETURNING id, name, tag, created_at, is_suspended
        `);

        // Initialize tenant organization in the admin tenant
        // This creates an organization in the admin tenant that represents this tenant
        // for user management purposes
        try {
          await tenantOrg.ensureTenantOrganization(tenant.id, tenant.name);
        } catch (error) {
          // If organization creation fails, log the error but don't block tenant creation
          // The organization can be created later when needed
          console.error(`Failed to initialize tenant organization for tenant ${tenant.id}:`, error);
        }

        ctx.status = 201;
        ctx.body = {
          id: tenant.id,
          name: tenant.name,
          tag: tenant.tag,
          createdAt: tenant.created_at.toISOString(),
          isSuspended: tenant.is_suspended,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('duplicate key')) {
          throw new RequestError({
            code: 'entity.create_failed',
            status: 409,
          });
        }
        throw error;
      }

      return next();
    }
  );

  router.get(
    '/tenants/:id',
    koaGuard({
      params: object({ id: string().min(1) }),
      response: tenantResponseGuard,
      status: [200, 403, 404],
    }),
    koaTenantReadAuth,
    async (ctx, next) => {
      const { id } = ctx.guard.params;

      const sharedPool = await EnvSet.sharedPool;
      const tenant = await sharedPool.maybeOne<TenantDatabaseRow>(sql`
        SELECT id, name, tag, created_at, is_suspended
        FROM tenants 
        WHERE id = ${id}
      `);

      assertThat(
        tenant,
        new RequestError({
          code: 'entity.not_found',
          status: 404,
        })
      );

      ctx.body = {
        id: tenant.id,
        name: tenant.name,
        tag: tenant.tag,
        createdAt: tenant.created_at.toISOString(),
        isSuspended: tenant.is_suspended,
      };

      return next();
    }
  );

  router.patch(
    '/tenants/:id',
    koaGuard({
      params: object({ id: string().min(1) }),
      body: updateTenantGuard,
      response: tenantResponseGuard,
      status: [200, 400, 403, 404],
    }),
    koaTenantWriteAuth,
    async (ctx, next) => {
      const { id } = ctx.guard.params;
      const updates = ctx.guard.body;

      assertThat(
        Object.keys(updates).length > 0,
        new RequestError({
          code: 'request.invalid_input',
          status: 400,
        })
      );

      // Check if tenant exists
      const sharedPool = await EnvSet.sharedPool;
      const existingTenant = await sharedPool.maybeOne<{ id: string }>(sql`
        SELECT id FROM tenants WHERE id = ${id}
      `);

      assertThat(
        existingTenant,
        new RequestError({
          code: 'entity.not_found',
          status: 404,
        })
      );

      // Build update query dynamically
      if (updates.name !== undefined && updates.tag !== undefined) {
        await sharedPool.query(sql`
          UPDATE tenants 
          SET name = ${updates.name}, tag = ${updates.tag}
          WHERE id = ${id}
        `);
      } else if (updates.name !== undefined) {
        await sharedPool.query(sql`
          UPDATE tenants 
          SET name = ${updates.name}
          WHERE id = ${id}
        `);
      } else if (updates.tag !== undefined) {
        await sharedPool.query(sql`
          UPDATE tenants 
          SET tag = ${updates.tag}
          WHERE id = ${id}
        `);
      }

      const tenant = await sharedPool.one<TenantDatabaseRow>(sql`
        SELECT id, name, tag, created_at, is_suspended
        FROM tenants 
        WHERE id = ${id}
      `);

      ctx.body = {
        id: tenant.id,
        name: tenant.name,
        tag: tenant.tag,
        createdAt: tenant.created_at.toISOString(),
        isSuspended: tenant.is_suspended,
      };

      return next();
    }
  );

  router.delete(
    '/tenants/:id',
    koaGuard({
      params: object({ id: string().min(1) }),
      status: [204, 403, 404],
    }),
    koaTenantDeleteAuth,
    async (ctx, next) => {
      const { id } = ctx.guard.params;

      // Check if tenant exists
      const sharedPool = await EnvSet.sharedPool;
      const tenant = await sharedPool.maybeOne<TenantWithDatabaseUser>(sql`
        SELECT id, db_user FROM tenants WHERE id = ${id}
      `);

      assertThat(
        tenant,
        new RequestError({
          code: 'entity.not_found',
          status: 404,
        })
      );

      try {
        // Drop the database role if it exists
        if (tenant.db_user) {
          await sharedPool.query(sql`
            DROP ROLE IF EXISTS ${sql.identifier([tenant.db_user])}
          `);
        }

        // Delete tenant record
        await sharedPool.query(sql`
          DELETE FROM tenants WHERE id = ${id}
        `);

        ctx.status = 204;
      } catch {
        throw new RequestError({
          code: 'request.general',
          status: 500,
        });
      }

      return next();
    }
  );
}
