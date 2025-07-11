import { TenantTag, adminTenantId, TenantRole, createAdminDataInAdminTenant, createAdminData, getManagementApiResourceIndicator, PredefinedScope, getTenantOrganizationId } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql } from '@silverhand/slonik';
import { object, string, nativeEnum, boolean } from 'zod';
import type { Next, MiddlewareType } from 'koa';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import { createTenantAuthMiddleware } from '#src/middleware/koa-tenant-auth.js';
import { type WithAuthContext } from '#src/middleware/koa-auth/index.js';
import assertThat from '#src/utils/assert-that.js';
import { createTenantOrganizationLibrary } from '#src/libraries/tenant-organization.js';

// Import OIDC seeding functionality
import { seedOidcConfigs } from '@logto/cli/lib/commands/database/seed/oidc-config.js';

import type { ManagementApiRouter, RouterInitArgs, ManagementApiRouterContext } from './types.js';

const tenantResponseGuard = object({
  id: string(),
  name: string(),
  tag: nativeEnum(TenantTag),
  createdAt: string(),
  isSuspended: boolean().optional(),
});

// Helper function to convert tenant database row to LocalTenantResponse format
const convertTenantToLocalTenantResponse = (tenant: any) => ({
  id: tenant.id,
  name: tenant.name,
  tag: tenant.tag,
  createdAt: tenant.createdAt ? new Date(tenant.createdAt).toISOString() : new Date().toISOString(),
  isSuspended: tenant.isSuspended || false,
});

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
  
  // Create flexible tenant management auth middleware
  const koaTenantManagementAuth: MiddlewareType<unknown, WithAuthContext<ManagementApiRouterContext>, unknown> = async (ctx, next) => {
    // Ensure the user is authenticated
    assertThat(ctx.auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));

    const { scopes } = ctx.auth;

    // Check if user has any tenant management scope
    // This allows cross-tenant access for users with appropriate permissions
    const hasTenantManagementScope = 
      scopes.has(PredefinedScope.All) ||
      scopes.has('manage:tenant') ||
      scopes.has('read:data') ||
      scopes.has('write:data') ||
      scopes.has('delete:data');

    assertThat(
      hasTenantManagementScope,
      new RequestError({ 
        code: 'auth.forbidden', 
        status: 403,
        data: { message: 'Missing required tenant management scopes' }
      })
    );

    return next();
  };

  const { koaTenantWriteAuth, koaTenantDeleteAuth } = createTenantAuthMiddleware(queries, tenant.id);

  // List all tenants that the authenticated user has access to
  // Accepts organization tokens from any tenant, checks tenant management scopes
  router.get(
    '/tenants',
    koaPagination({ isOptional: true }),
    koaGuard({
      response: tenantResponseGuard.array(),
      status: [200, 401, 403],
    }),
    koaTenantManagementAuth,
    async (ctx: ManagementApiRouterContext, next: Next) => {
      const { limit, offset, disabled } = ctx.pagination;
      const { auth } = ctx;
      
      assertThat(auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));
      
      const { id: userId } = auth;
      
      // Get all tenants from database
      const sharedPool = await EnvSet.sharedPool;
      const allTenants = await sharedPool.any<TenantDatabaseRow>(sql`
        SELECT id, name, tag, created_at, is_suspended
        FROM tenants 
        ORDER BY created_at DESC
      `);
      
      // Filter tenants based on user's organization membership
      const accessibleTenants = [];
      for (const tenant of allTenants) {
        try {
          // Check if user is a member of this tenant's organization
          const organizationId = getTenantOrganizationId(tenant.id);
          const isMember = await queries.organizations.relations.users.exists({
            organizationId,
            userId,
          });
          
          if (isMember) {
            accessibleTenants.push(tenant);
          }
        } catch {
          // If we can't check membership, skip this tenant
          continue;
        }
      }
      
      // Apply pagination to filtered results
      const totalCount = accessibleTenants.length;
      const paginatedTenants = accessibleTenants.slice(offset, offset + limit);
      
      ctx.body = paginatedTenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        tag: tenant.tag,
        createdAt: tenant.created_at ? tenant.created_at.toISOString() : new Date().toISOString(),
        isSuspended: tenant.is_suspended,
      }));
      ctx.pagination = { limit, offset, totalCount };

      return next();
    }
  );

  // Create new tenant - requires write access to current tenant
  router.post(
    '/tenants',
    koaGuard({
      body: createTenantGuard,
      response: tenantResponseGuard,
      status: [201, 400, 403, 422],
    }),
    koaTenantWriteAuth,
    async (ctx: ManagementApiRouterContext, next: Next) => {
      const { name, tag } = ctx.guard.body;
      const id = generateStandardId();

      // Generate database credentials for the tenant
      const databaseUser = `logto_tenant_${id}`;
      const databaseUserPassword = generateStandardId(32);

      // Use the shared admin pool for tenant management operations
      // This ensures we have the necessary permissions to create tenants
      const sharedPool = await EnvSet.sharedPool;
      
      // Create tenant record using shared admin pool
      const newTenant = await sharedPool.one<TenantDatabaseRow>(sql`
        INSERT INTO tenants (id, name, tag, db_user, db_user_password, created_at, is_suspended)
        VALUES (${id}, ${name}, ${tag}, ${databaseUser}, ${databaseUserPassword}, NOW(), false)
        RETURNING id, name, tag, created_at, is_suspended
      `);

      // Seed OIDC configuration for the new tenant (privateKeys, cookieKeys)
      try {
        await seedOidcConfigs(sharedPool, newTenant.id);
        console.log(`Successfully seeded OIDC configuration for tenant ${newTenant.id}`);
      } catch (error) {
        console.error(`Failed to seed OIDC configuration for tenant ${newTenant.id}:`, error);
        // Don't throw error as this shouldn't block tenant creation
      }

      try {
        // Create Management API resource in admin tenant (for admin management)
        const adminData = createOssAdminData(newTenant.id);
        
        // Insert resource in admin tenant
        await sharedPool.query(sql`
          INSERT INTO resources (id, tenant_id, name, indicator, access_token_ttl)
          VALUES (${adminData.resource.id}, ${adminData.resource.tenantId}, ${adminData.resource.name}, ${adminData.resource.indicator}, ${3600})
        `);

        // Insert scopes in admin tenant
        for (const scope of adminData.scopes) {
          await sharedPool.query(sql`
            INSERT INTO scopes (id, tenant_id, resource_id, name, description)
            VALUES (${scope.id}, ${scope.tenantId}, ${scope.resourceId}, ${scope.name}, ${scope.description})
          `);
        }

        // Create Management API resource in the new tenant's own context (for its OIDC provider)
        const tenantOwnData = createAdminData(newTenant.id);
        
        // Insert resource in new tenant's own context
        await sharedPool.query(sql`
          INSERT INTO resources (id, tenant_id, name, indicator, access_token_ttl)
          VALUES (${tenantOwnData.resource.id}, ${tenantOwnData.resource.tenantId}, ${tenantOwnData.resource.name}, ${tenantOwnData.resource.indicator}, ${3600})
        `);

        // Insert scopes in new tenant's own context
        for (const scope of tenantOwnData.scopes) {
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
            console.log(`Successfully granted user role access to tenant ${newTenant.id} Management API`);
          }
        } catch (error) {
          console.error(`Failed to grant user role access to tenant ${newTenant.id} Management API:`, error);
          // Don't throw as this shouldn't block tenant creation
        }
        
        console.log(`Successfully created Management API resource for tenant ${newTenant.id}`);
      } catch (error) {
        console.error(`Failed to create Management API resource for tenant ${newTenant.id}:`, error);
        // Don't throw error as this shouldn't block tenant creation
      }

      // Initialize tenant organization in the admin tenant
      // This creates an organization in the admin tenant that represents this tenant
      // for user management purposes
      try {
        await tenantOrg.ensureTenantOrganization(newTenant.id, newTenant.name);
        
        // Assign the creating user as an admin of the new tenant
        const userId = ctx.auth.id;
        await tenantOrg.addUserToTenant(newTenant.id, userId, TenantRole.Admin);
      } catch (error) {
        // If organization creation or user assignment fails, log the error but don't block tenant creation
        // The organization and user assignment can be created later when needed
        console.error(`Failed to initialize tenant organization or assign user for tenant ${newTenant.id}:`, error);
      }

      ctx.status = 201;
      ctx.body = {
        id: newTenant.id,
        name: newTenant.name,
        tag: newTenant.tag,
        createdAt: newTenant.created_at ? newTenant.created_at.toISOString() : new Date().toISOString(),
        isSuspended: newTenant.is_suspended,
      };

      return next();
    }
  );

  // Get single tenant - use tenant management auth
  router.get(
    '/tenants/:id',
    koaGuard({
      params: object({ id: string().min(1) }),
      response: tenantResponseGuard,
      status: [200, 401, 403, 404],
    }),
    koaTenantManagementAuth,
    async (ctx: ManagementApiRouterContext, next: Next) => {
      const { id } = ctx.guard.params;
      const { auth } = ctx;
      
      assertThat(auth, new RequestError({ code: 'auth.unauthorized', status: 401 }));
      const { id: userId } = auth;
      
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

      // Check if user has access to this specific tenant (must be a member)
      try {
        const organizationId = getTenantOrganizationId(id);
        const isMember = await queries.organizations.relations.users.exists({
          organizationId,
          userId,
        });
        
        assertThat(
          isMember,
          new RequestError({
            code: 'auth.forbidden',
            status: 403,
            data: { message: `Access denied to tenant: ${id}` }
          })
        );
      } catch (error) {
        if (error instanceof RequestError) {
          throw error;
        }
        // If we can't check membership, deny access
        throw new RequestError({
          code: 'auth.forbidden',
          status: 403,
          data: { message: `Access denied to tenant: ${id}` }
        });
      }

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

  // Update tenant - use current tenant auth
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

  // Delete tenant - use current tenant auth
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