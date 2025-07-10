import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    console.log('Granting admin tenant management API scopes to admin tenant user role');

    try {
      // Get the admin tenant user role ID
      const userRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'user'
      `);

      if (!userRole) {
        console.log('Admin tenant user role not found, skipping migration');
        return;
      }

      console.log(`Found admin tenant user role: ${userRole.id}`);

      // Get the admin tenant management API resource
      const adminApiResource = await pool.maybeOne<{ id: string }>(sql`
        select id from resources
        where indicator = 'https://admin.logto.app/api'
      `);

      if (!adminApiResource) {
        console.log('Admin tenant management API resource not found, skipping migration');
        return;
      }

      console.log(`Found admin tenant management API resource: ${adminApiResource.id}`);

      // Get all scopes for the admin tenant management API
      const scopes = await pool.any<{ id: string; name: string }>(sql`
        select id, name from scopes
        where resource_id = ${adminApiResource.id}
      `);

      if (scopes.length === 0) {
        console.log('No scopes found for admin tenant management API, skipping migration');
        return;
      }

      console.log(`Found ${scopes.length} scopes for admin tenant management API`);

      // Add each scope to the admin tenant user role (if not already assigned)
      let addedScopes = 0;
      for (const scope of scopes) {
        const existing = await pool.maybeOne(sql`
          select role_id from roles_scopes
          where role_id = ${userRole.id}
          and scope_id = ${scope.id}
        `);

        if (!existing) {
          await pool.query(sql`
            insert into roles_scopes (tenant_id, id, role_id, scope_id)
            values (${adminTenantId}, ${generateStandardId()}, ${userRole.id}, ${scope.id})
          `);
          console.log(`Added scope "${scope.name}" to admin tenant user role`);
          addedScopes++;
        } else {
          console.log(`Scope "${scope.name}" already assigned to admin tenant user role`);
        }
      }

      console.log(`Successfully granted ${addedScopes} admin tenant management API scopes to admin tenant user role`);
    } catch (error) {
      console.error('Error granting admin tenant management API scopes:', error);
      throw error;
    }
  },
  down: async (pool) => {
    console.log('Removing admin tenant management API scopes from admin tenant user role');

    try {
      // Get the admin tenant user role ID
      const userRole = await pool.maybeOne<{ id: string }>(sql`
        select id from roles
        where tenant_id = ${adminTenantId}
        and name = 'user'
      `);

      if (!userRole) {
        console.log('Admin tenant user role not found, skipping rollback');
        return;
      }

      // Get the admin tenant management API resource
      const adminApiResource = await pool.maybeOne<{ id: string }>(sql`
        select id from resources
        where indicator = 'https://admin.logto.app/api'
      `);

      if (!adminApiResource) {
        console.log('Admin tenant management API resource not found, skipping rollback');
        return;
      }

      // Remove all admin tenant management API scopes from the user role
      const result = await pool.query(sql`
        delete from roles_scopes
        where role_id = ${userRole.id}
        and scope_id in (
          select id from scopes
          where resource_id = ${adminApiResource.id}
        )
      `);

      console.log(`Removed ${result.rowCount} admin tenant management API scopes from admin tenant user role`);
    } catch (error) {
      console.error('Error removing admin tenant management API scopes:', error);
      throw error;
    }
  },
};

export default alteration; 