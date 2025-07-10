import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';
const defaultTenantId = 'default';

const alteration: AlterationScript = {
  up: async (pool) => {
    console.log('Fixing admin tenant default:admin role to point to correct management API');

    try {
      // Get the admin tenant's default:admin role ID
      const adminRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'default:admin'
      `);

      if (!adminRole) {
        console.log('Admin tenant default:admin role not found, skipping migration');
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

      // Get the required scopes from the admin tenant management API
      const requiredScopes = await pool.any<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${adminResource.id}
        and name in ('all', 'tenant:read', 'tenant:write', 'tenant:delete')
      `);

      if (requiredScopes.length === 0) {
        console.log('Required scopes not found in admin tenant management API, skipping migration');
        return;
      }

      // Remove existing role-scope assignments for this role
      await pool.query(sql`
        delete from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${adminRole.id}
      `);

      // Add new role-scope assignments pointing to admin tenant management API
      for (const scope of requiredScopes) {
        await pool.query(sql`
          insert into roles_scopes (tenant_id, id, role_id, scope_id)
          values (
            ${adminTenantId},
            ${generateStandardId()},
            ${adminRole.id},
            ${scope.id}
          )
        `);
      }

      console.log(`Successfully fixed admin tenant default:admin role scope assignments (${requiredScopes.length} scopes)`);
    } catch (error) {
      console.error('Error fixing admin tenant default:admin role scopes:', error);
      throw error;
    }
  },
  down: async (pool) => {
    console.log('Reverting admin tenant default:admin role scope fix');

    try {
      // Get the admin tenant's default:admin role ID
      const adminRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'default:admin'
      `);

      if (!adminRole) {
        console.log('Admin tenant default:admin role not found, skipping reversion');
        return;
      }

      // Get the default tenant management API resource ID
      const defaultResource = await pool.maybeOne<{ id: string }>(sql`
        select id from resources
        where tenant_id = ${defaultTenantId}
        and indicator = 'https://default.logto.app/api'
      `);

      if (!defaultResource) {
        console.log('Default tenant management API resource not found, skipping reversion');
        return;
      }

      // Get the required scopes from the default tenant management API
      const requiredScopes = await pool.any<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${defaultTenantId}
        and resource_id = ${defaultResource.id}
        and name in ('all', 'tenant:read', 'tenant:write', 'tenant:delete')
      `);

      if (requiredScopes.length === 0) {
        console.log('Required scopes not found in default tenant management API, skipping reversion');
        return;
      }

      // Remove current role-scope assignments
      await pool.query(sql`
        delete from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${adminRole.id}
      `);

      // Add back the original role-scope assignments pointing to default tenant management API
      for (const scope of requiredScopes) {
        await pool.query(sql`
          insert into roles_scopes (tenant_id, id, role_id, scope_id)
          values (
            ${adminTenantId},
            ${generateStandardId()},
            ${adminRole.id},
            ${scope.id}
          )
        `);
      }

      console.log(`Successfully reverted admin tenant default:admin role scope assignments (${requiredScopes.length} scopes)`);
    } catch (error) {
      console.error('Error reverting admin tenant default:admin role scopes:', error);
      throw error;
    }
  },
};

export default alteration; 