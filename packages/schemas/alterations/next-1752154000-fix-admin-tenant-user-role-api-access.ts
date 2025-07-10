import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';
const defaultTenantId = 'default';

const alteration: AlterationScript = {
  up: async (pool) => {
    console.log('Fixing admin tenant user role to have admin management API access');

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

      // Get the 'all' scope from the admin tenant management API
      const allScope = await pool.maybeOne<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${adminResource.id}
        and name = 'all'
      `);

      if (!allScope) {
        console.log('Admin tenant management API "all" scope not found, skipping migration');
        return;
      }

      // Check if the user role already has this scope
      const existingScope = await pool.maybeOne(sql`
        select id from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${userRole.id}
        and scope_id = ${allScope.id}
      `);

      if (existingScope) {
        console.log('Admin tenant user role already has the "all" scope for admin management API');
        return;
      }

      // Add the "all" scope to the user role
      await pool.query(sql`
        insert into roles_scopes (tenant_id, id, role_id, scope_id)
        values (
          ${adminTenantId},
          ${generateStandardId()},
          ${userRole.id},
          ${allScope.id}
        )
      `);

      console.log('Successfully added admin management API "all" scope to admin tenant user role');
    } catch (error) {
      console.error('Error fixing admin tenant user role scopes:', error);
      throw error;
    }
  },
  down: async (pool) => {
    console.log('Reverting admin tenant user role admin management API access');

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

      // Get the 'all' scope from the admin tenant management API
      const allScope = await pool.maybeOne<{ id: string; name: string }>(sql`
        select id, name from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${adminResource.id}
        and name = 'all'
      `);

      if (!allScope) {
        console.log('Admin tenant management API "all" scope not found, skipping reversion');
        return;
      }

      // Remove the admin management API "all" scope from the user role
      await pool.query(sql`
        delete from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${userRole.id}
        and scope_id = ${allScope.id}
      `);

      console.log('Successfully removed admin management API "all" scope from admin tenant user role');
    } catch (error) {
      console.error('Error reverting admin tenant user role scopes:', error);
      throw error;
    }
  },
};

export default alteration; 