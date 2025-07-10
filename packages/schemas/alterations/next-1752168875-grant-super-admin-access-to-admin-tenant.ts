import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    console.log('Granting super admin users access to admin tenant management');

    try {
      // Get the admin tenant's user role ID
      const userRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'user'
      `);

      if (!userRole) {
        console.log('Admin tenant user role not found, skipping migration');
        return;
      }

      // Get the admin tenant management API resource ID
      const adminResource = await pool.maybeOne<{ id: string }>(sql`
        select id from resources
        where tenant_id = ${adminTenantId}
        and indicator = 'https://admin.logto.app/api'
      `);

      if (!adminResource) {
        console.log('Admin tenant management API resource not found, skipping migration');
        return;
      }

      // Get the required tenant management scopes from the admin tenant management API
      const tenantScopes = await pool.any<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${adminResource.id}
        and name in ('tenant:read', 'tenant:write', 'tenant:delete')
      `);

      if (tenantScopes.length === 0) {
        console.log('Tenant management scopes not found in admin tenant management API, skipping migration');
        return;
      }

      // Check which scopes are already assigned to avoid duplicates
      const existingScopes = await pool.any<{ scope_id: string }>(sql`
        select scope_id from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${userRole.id}
        and scope_id in (${sql.join(tenantScopes.map(s => s.id), sql`, `)})
      `);

      const existingScopeIds = new Set(existingScopes.map(s => s.scope_id));

      // Add missing tenant management scopes to the user role
      let addedScopes = 0;
      for (const scope of tenantScopes) {
        if (!existingScopeIds.has(scope.id)) {
          await pool.query(sql`
            insert into roles_scopes (tenant_id, id, role_id, scope_id)
            values (
              ${adminTenantId},
              ${generateStandardId()},
              ${userRole.id},
              ${scope.id}
            )
          `);
          addedScopes++;
        }
      }

      console.log(`Successfully added ${addedScopes} tenant management scopes to admin tenant user role`);
      console.log('Super admin users can now access admin tenant management via console');
    } catch (error) {
      console.error('Error granting super admin access to admin tenant:', error);
      throw error;
    }
  },
  down: async (pool) => {
    console.log('Revoking super admin access to admin tenant management');

    try {
      // Get the admin tenant's user role ID
      const userRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'user'
      `);

      if (!userRole) {
        console.log('Admin tenant user role not found, skipping reversion');
        return;
      }

      // Get the admin tenant management API resource ID
      const adminResource = await pool.maybeOne<{ id: string }>(sql`
        select id from resources
        where tenant_id = ${adminTenantId}
        and indicator = 'https://admin.logto.app/api'
      `);

      if (!adminResource) {
        console.log('Admin tenant management API resource not found, skipping reversion');
        return;
      }

      // Get the tenant management scopes from the admin tenant management API
      const tenantScopes = await pool.any<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${adminResource.id}
        and name in ('tenant:read', 'tenant:write', 'tenant:delete')
      `);

      if (tenantScopes.length === 0) {
        console.log('Tenant management scopes not found in admin tenant management API, skipping reversion');
        return;
      }

      // Remove the tenant management scopes from the user role
      await pool.query(sql`
        delete from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${userRole.id}
        and scope_id in (${sql.join(tenantScopes.map(s => s.id), sql`, `)})
      `);

      console.log('Successfully removed tenant management scopes from admin tenant user role');
      console.log('Super admin users no longer have access to admin tenant management');
    } catch (error) {
      console.error('Error revoking super admin access to admin tenant:', error);
      throw error;
    }
  },
};

export default alteration; 