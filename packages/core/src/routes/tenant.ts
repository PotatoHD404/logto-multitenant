import { TenantTag, adminTenantId, TenantRole, createAdminDataInAdminTenant, getManagementApiResourceIndicator, PredefinedScope } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql } from '@silverhand/slonik';
import { object, string, nativeEnum, boolean } from 'zod';
import type { Next } from 'koa';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import { createTenantAuthMiddleware } from '#src/middleware/koa-tenant-auth.js';
import assertThat from '#src/utils/assert-that.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';

import type { ManagementApiRouter, RouterInitArgs, ManagementApiRouterContext } from './types.js';

/**
 * Create admin data for OSS installations - only includes resource and scopes,
 * no M2M role (which is only needed for Logto Cloud proxy).
 */
const createOssAdminData = (tenantId: string) => {
  const resource = {
    id: generateStandardId(),
    tenantId: adminTenantId,
    indicator: getManagementApiResourceIndicator(tenantId),
    name: `Management API for ${tenantId}`,
    accessTokenTtl: 3600,
    isDefault: false,
  };

  const scopes = [
    {
      id: generateStandardId(),
      tenantId: adminTenantId,
      resourceId: resource.id,
      name: PredefinedScope.All,
      description: 'Allow all actions on the tenant.',
    },
    {
      id: generateStandardId(),
      tenantId: adminTenantId,
      resourceId: resource.id,
      name: 'tenant:read',
      description: 'Allow reading tenant data.',
    },
    {
      id: generateStandardId(),
      tenantId: adminTenantId,
      resourceId: resource.id,
      name: 'tenant:write',
      description: 'Allow writing tenant data.',
    },
    {
      id: generateStandardId(),
      tenantId: adminTenantId,
      resourceId: resource.id,
      name: 'tenant:delete',
      description: 'Allow deleting tenant data.',
    },
  ];

  return { resource, scopes };
};

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
  ...[router, tenant]: RouterInitArgs<T>
) {
  const { isCloud } = EnvSet.values;

  // Skip tenant routes for cloud environment - use cloud API instead
  if (isCloud) {
    return;
  }

  const { queries } = tenant;
  const tenantOrg = createTenantOrganizationLibrary(queries);
  
  // Create tenant auth middleware with the ACTUAL current tenant ID from context
  // This allows each tenant to have its own management context
  const { koaTenantReadAuth, koaTenantWriteAuth, koaTenantDeleteAuth } = createTenantAuthMiddleware(queries, tenant.id);

  router.get(
    '/tenants',
    koaPagination({ isOptional: true }),
    koaGuard({
      response: tenantResponseGuard.array(),
      status: [200],
    }),
    koaTenantReadAuth,
    async (ctx: ManagementApiRouterContext, next: Next) => {
      const { limit, offset, disabled } = ctx.pagination;

      if (disabled) {
              const sharedPool = await EnvSet.sharedPool;
      const tenants = await sharedPool.any<TenantDatabaseRow>(sql`
        SELECT id, name, tag, created_at, is_suspended
        FROM tenants 
        ORDER BY created_at DESC
      `);
        ctx.body = tenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          tag: tenant.tag,
          createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
          isSuspended: tenant.is_suspended,
        }));
        return next();
      }

      const sharedPool = await EnvSet.sharedPool;
      const [countResult, tenants] = await Promise.all([
        sharedPool.one<CountResult>(
          sql`SELECT COUNT(*) as count FROM tenants`
        ),
        sharedPool.any<TenantDatabaseRow>(sql`
          SELECT id, name, tag, created_at, is_suspended
          FROM tenants 
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
      ]);

      ctx.pagination.totalCount = Number(countResult.count);
      ctx.body = tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        tag: tenant.tag,
        createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
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
    async (ctx: ManagementApiRouterContext, next: Next) => {
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

        // Create Management API resource for the new tenant
        try {
          const adminData = createOssAdminData(tenant.id);
          
          // Insert the Management API resource
          await sharedPool.query(sql`
            INSERT INTO resources (id, tenant_id, indicator, name, access_token_ttl, is_default)
            VALUES (${adminData.resource.id}, ${adminData.resource.tenantId}, ${adminData.resource.indicator}, ${adminData.resource.name}, ${adminData.resource.accessTokenTtl}, ${adminData.resource.isDefault})
          `);
          
          // Insert the Management API scopes
          for (const scope of adminData.scopes) {
            await sharedPool.query(sql`
              INSERT INTO scopes (id, tenant_id, resource_id, name, description)
              VALUES (${scope.id}, ${scope.tenantId}, ${scope.resourceId}, ${scope.name}, ${scope.description})
            `);
          }
          
          // Grant the admin tenant 'user' role access to the new tenant's Management API
          // This allows users in the admin tenant to manage the new tenant
          try {
            // Find the admin tenant 'user' role
            const userRole = await sharedPool.maybeOne<{ id: string }>(sql`
              SELECT id FROM roles WHERE tenant_id = ${adminTenantId} AND name = 'user'
            `);
            
            if (userRole) {
              // Assign all new tenant Management API scopes to the user role
              for (const scope of adminData.scopes) {
                // Check if assignment already exists to avoid constraint violation
                const existingAssignment = await sharedPool.maybeOne(sql`
                  SELECT id FROM roles_scopes 
                  WHERE tenant_id = ${adminTenantId} 
                  AND role_id = ${userRole.id} 
                  AND scope_id = ${scope.id}
                `);
                
                if (!existingAssignment) {
                  await sharedPool.query(sql`
                    INSERT INTO roles_scopes (id, tenant_id, role_id, scope_id)
                    VALUES (${generateStandardId()}, ${adminTenantId}, ${userRole.id}, ${scope.id})
                  `);
                }
              }
              console.log(`Successfully granted user role access to tenant ${tenant.id} Management API`);
            }
          } catch (error) {
            console.error(`Failed to grant user role access to tenant ${tenant.id} Management API:`, error);
            // Don't throw as this shouldn't block tenant creation
          }
          
          console.log(`Successfully created Management API resource for tenant ${tenant.id}`);
        } catch (error) {
          console.error(`Failed to create Management API resource for tenant ${tenant.id}:`, error);
          // Don't throw error as this shouldn't block tenant creation
        }

        // Initialize tenant organization in the admin tenant
        // This creates an organization in the admin tenant that represents this tenant
        // for user management purposes
        try {
          await tenantOrg.ensureTenantOrganization(tenant.id, tenant.name);
          
          // Assign the creating user as an admin of the new tenant
          const userId = ctx.auth.id;
          await tenantOrg.addUserToTenant(tenant.id, userId, TenantRole.Admin);
        } catch (error) {
          // If organization creation or user assignment fails, log the error but don't block tenant creation
          // The organization and user assignment can be created later when needed
          console.error(`Failed to initialize tenant organization or assign user for tenant ${tenant.id}:`, error);
        }

        ctx.status = 201;
        ctx.body = {
          id: tenant.id,
          name: tenant.name,
          tag: tenant.tag,
          createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
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
    async (ctx: ManagementApiRouterContext, next: Next) => {
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
        createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
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
    async (ctx: ManagementApiRouterContext, next: Next) => {
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
        createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
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
    async (ctx: ManagementApiRouterContext, next: Next) => {
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