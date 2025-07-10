import { ConsoleLog } from '@logto/shared';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const consoleLog = new ConsoleLog();
const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    consoleLog.info('=== Ensuring tenant organizations are properly set up ===');

    // Ensure admin and collaborator roles exist in admin tenant
    consoleLog.info('Ensuring tenant roles exist in admin tenant');
    await pool.query(sql`
      insert into organization_roles (id, tenant_id, name, description, type)
      values
        ('admin', ${adminTenantId}, 'admin', 'Admin of the tenant, who has all permissions.', 'User'),
        ('collaborator', ${adminTenantId}, 'collaborator', 'Collaborator of the tenant, who has permissions to operate the tenant data, but not the tenant settings.', 'User')
      on conflict (id) do update set
        description = excluded.description,
        type = excluded.type;
    `);

    // Ensure all tenant scopes exist in admin tenant
    consoleLog.info('Ensuring tenant scopes exist in admin tenant');
    await pool.query(sql`
      insert into organization_scopes (id, tenant_id, name, description)
      values
        ('read-data', ${adminTenantId}, 'read:data', 'Read the tenant data.'),
        ('write-data', ${adminTenantId}, 'write:data', 'Write the tenant data, including creating and updating the tenant.'),
        ('delete-data', ${adminTenantId}, 'delete:data', 'Delete data of the tenant.'),
        ('read-member', ${adminTenantId}, 'read:member', 'Read members of the tenant.'),
        ('invite-member', ${adminTenantId}, 'invite:member', 'Invite members to the tenant.'),
        ('remove-member', ${adminTenantId}, 'remove:member', 'Remove members from the tenant.'),
        ('update-member-role', ${adminTenantId}, 'update:member:role', 'Update the role of a member in the tenant.'),
        ('manage-tenant', ${adminTenantId}, 'manage:tenant', 'Manage the tenant settings, including name, billing, etc.')
      on conflict (id) do update set
        description = excluded.description;
    `);

    // Set up role-scope relations
    consoleLog.info('Setting up role-scope relations');
    await pool.query(sql`
      insert into organization_role_scope_relations (tenant_id, organization_role_id, organization_scope_id)
      values
        -- Admin role gets all scopes
        (${adminTenantId}, 'admin', 'read-data'),
        (${adminTenantId}, 'admin', 'write-data'),
        (${adminTenantId}, 'admin', 'delete-data'),
        (${adminTenantId}, 'admin', 'read-member'),
        (${adminTenantId}, 'admin', 'invite-member'),
        (${adminTenantId}, 'admin', 'remove-member'),
        (${adminTenantId}, 'admin', 'update-member-role'),
        (${adminTenantId}, 'admin', 'manage-tenant'),
        -- Collaborator role gets limited scopes
        (${adminTenantId}, 'collaborator', 'read-data'),
        (${adminTenantId}, 'collaborator', 'write-data'),
        (${adminTenantId}, 'collaborator', 'delete-data'),
        (${adminTenantId}, 'collaborator', 'read-member')
      on conflict (tenant_id, organization_role_id, organization_scope_id) do nothing;
    `);

    // Ensure admin tenant has proper name
    consoleLog.info('Ensuring admin tenant has proper name');
    await pool.query(sql`
      update tenants 
      set name = 'Admin tenant' 
      where id = ${adminTenantId} and (name is null or name = 'My Project');
    `);

    // Ensure organizations exist for all tenants
    consoleLog.info('Ensuring organizations exist for all tenants');
    const tenants = await pool.any<{ id: string; name: string }>(sql`
      select id, name
      from tenants
      where id != ${adminTenantId};
    `);

    if (tenants.length > 0) {
      await pool.query(sql`
        insert into organizations (id, tenant_id, name, description)
        values 
          ${sql.join(
            tenants.map(
              (tenant) => sql`(${`t-${tenant.id}`}, ${adminTenantId}, ${`Tenant ${tenant.name || tenant.id}`}, ${`Organization for tenant ${tenant.id}`})`
            ),
            sql`, `
          )}
        on conflict (id) do update set
          name = excluded.name,
          description = excluded.description;
      `);
      consoleLog.info(`Created/updated organizations for ${tenants.length} tenants`);
    }

    consoleLog.info('=== Tenant organizations setup complete ===');
  },

  down: async (pool) => {
    consoleLog.info('=== Reverting tenant organizations setup ===');
    
    // Revert admin tenant name
    await pool.query(sql`
      update tenants 
      set name = 'My Project' 
      where id = ${adminTenantId} and name = 'Admin tenant';
    `);
    
    // Remove organizations for user tenants (but keep admin tenant org structure)
    await pool.query(sql`
      delete from organizations 
      where tenant_id = ${adminTenantId} 
      and id like 't-%';
    `);

    // Remove role-scope relations
    await pool.query(sql`
      delete from organization_role_scope_relations
      where tenant_id = ${adminTenantId}
      and organization_role_id in ('admin', 'collaborator');
    `);

    // Remove tenant-specific scopes (be careful not to remove other scopes)
    await pool.query(sql`
      delete from organization_scopes
      where tenant_id = ${adminTenantId}
      and id in ('read-data', 'write-data', 'delete-data', 'read-member', 'invite-member', 'remove-member', 'update-member-role', 'manage-tenant');
    `);

    // Note: We don't remove the roles as they might be used elsewhere
    consoleLog.info('=== Tenant organizations setup reverted ===');
  },
};

export default alteration; 