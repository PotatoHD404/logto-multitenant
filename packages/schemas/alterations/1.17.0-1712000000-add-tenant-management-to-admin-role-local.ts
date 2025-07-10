import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    console.log('Adding tenant management scopes to admin role for local development');

    // Get the cloud API resource ID
    const { id: resourceId } = await pool.one<{ id: string }>(sql`
      select id from resources
      where tenant_id = ${adminTenantId}
      and indicator = 'https://cloud.logto.io/api'
    `);

    // Get the admin role ID
    const { id: roleId } = await pool.one<{ id: string }>(sql`
      select id from roles
      where tenant_id = ${adminTenantId}
      and name = 'admin:admin'
    `);

    // Create tenant management scopes if they don't exist
    const scopes = [
      {
        name: 'create:tenant',
        description: 'Allow creating new tenants.',
      },
      {
        name: 'manage:tenant',
        description: 'Allow managing existing tenants, including create without limitation, update, and delete.',
      },
      {
        name: 'manage:tenant:self',
        description: 'Allow managing tenant itself, including update and delete.',
      },
    ];

    for (const scope of scopes) {
      // Check if scope already exists
      const existingScope = await pool.maybeOne<{ id: string }>(sql`
        select id from scopes
        where tenant_id = ${adminTenantId}
        and name = ${scope.name}
        and resource_id = ${resourceId}
      `);

      let scopeId: string;
      if (existingScope) {
        scopeId = existingScope.id;
      } else {
        // Create the scope
        scopeId = generateStandardId();
        await pool.query(sql`
          insert into scopes (tenant_id, id, name, description, resource_id)
          values (
            ${adminTenantId},
            ${scopeId},
            ${scope.name},
            ${scope.description},
            ${resourceId}
          )
        `);
      }

      // Check if role-scope relation already exists
      const existingRoleScope = await pool.maybeOne<{ id: string }>(sql`
        select id from roles_scopes
        where tenant_id = ${adminTenantId}
        and role_id = ${roleId}
        and scope_id = ${scopeId}
      `);

      if (!existingRoleScope) {
        // Add scope to admin role
        await pool.query(sql`
          insert into roles_scopes (tenant_id, id, role_id, scope_id)
          values (
            ${adminTenantId},
            ${generateStandardId()},
            ${roleId},
            ${scopeId}
          )
        `);
      }
    }

    console.log('Successfully added tenant management scopes to admin role');
  },
  down: async (pool) => {
    console.log('Removing tenant management scopes from admin role');

    // Get the cloud API resource ID
    const { id: resourceId } = await pool.one<{ id: string }>(sql`
      select id from resources
      where tenant_id = ${adminTenantId}
      and indicator = 'https://cloud.logto.io/api'
    `);

    // Get the admin role ID
    const { id: roleId } = await pool.one<{ id: string }>(sql`
      select id from roles
      where tenant_id = ${adminTenantId}
      and name = 'admin:admin'
    `);

    // Remove role-scope relations for tenant management scopes
    await pool.query(sql`
      delete from roles_scopes
      where tenant_id = ${adminTenantId}
      and role_id = ${roleId}
      and scope_id in (
        select id from scopes
        where tenant_id = ${adminTenantId}
        and resource_id = ${resourceId}
        and name in ('create:tenant', 'manage:tenant', 'manage:tenant:self')
      )
    `);

    console.log('Successfully removed tenant management scopes from admin role');
  },
};

export default alteration; 