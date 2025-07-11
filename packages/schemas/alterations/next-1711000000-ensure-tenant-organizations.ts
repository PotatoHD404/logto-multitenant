import { ConsoleLog } from '@logto/shared';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const consoleLog = new ConsoleLog();
const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    consoleLog.info('=== Ensuring tenant organizations are properly set up ===');

    // First, ensure tenant organization template exists (roles and scopes)
    consoleLog.info('Ensuring tenant organization template exists');
    
    // Ensure tenant roles exist in admin tenant
    await pool.query(sql`
      insert into organization_roles (id, tenant_id, name, description, type)
      values
        ('admin', ${adminTenantId}, 'admin', 'Admin of the tenant, who has all permissions.', 'User'),
        ('collaborator', ${adminTenantId}, 'collaborator', 'Collaborator of the tenant, who has permissions to operate the tenant data, but not the tenant settings.', 'User')
      on conflict (id) do update set
        description = excluded.description,
        type = excluded.type;
    `);

    // Ensure tenant scopes exist in admin tenant
    await pool.query(sql`
      insert into organization_scopes (id, tenant_id, name, description)
      values
        ('read-data', ${adminTenantId}, 'read:data', 'Read the tenant data.'),
        ('write-data', ${adminTenantId}, 'write:data', 'Write the tenant data.'),
        ('delete-data', ${adminTenantId}, 'delete:data', 'Delete data of the tenant.'),
        ('read-member', ${adminTenantId}, 'read:member', 'Read tenant member information.'),
        ('invite-member', ${adminTenantId}, 'invite:member', 'Invite members to the tenant.'),
        ('remove-member', ${adminTenantId}, 'remove:member', 'Remove members from the tenant.'),
        ('update-member-role', ${adminTenantId}, 'update:member:role', 'Update member roles in the tenant.'),
        ('manage-tenant', ${adminTenantId}, 'manage:tenant', 'Manage tenant settings and configuration.')
      on conflict (id) do update set
        description = excluded.description;
    `);

    // Link roles to scopes
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

    // Ensure organizations exist for all tenants (using t- prefix convention)
    consoleLog.info('Ensuring organizations exist for all tenants');
    const allTenants = await pool.any<{ id: string; name: string }>(sql`
      select id, coalesce(name, 'My Project') as name
      from tenants;
    `);

    if (allTenants.length > 0) {
      await pool.query(sql`
        insert into organizations (id, tenant_id, name, description)
        values 
          ${sql.join(
            allTenants.map(
              (tenant) => sql`(${`t-${tenant.id}`}, ${adminTenantId}, ${tenant.id === adminTenantId ? 'Admin' : `Tenant ${tenant.name}`}, ${`Organization for tenant ${tenant.id}`})`
            ),
            sql`, `
          )}
        on conflict (id) do update set
          name = excluded.name,
          description = excluded.description;
      `);
      consoleLog.info(`Created/updated ${allTenants.length} tenant organizations`);
    }

    // Associate first admin users with all tenant organizations
    consoleLog.info('Associating admin users with tenant organizations');
    
    // Find users with admin roles in the admin tenant
    const adminUsers = await pool.any<{ id: string }>(sql`
      select distinct u.id
      from users u
      join users_roles ur on ur.user_id = u.id
      join roles r on r.id = ur.role_id
      where u.tenant_id = ${adminTenantId}
      and r.tenant_id = ${adminTenantId}
      and r.type = 'User'
      and (r.name like '%admin%' or r.name = '${`${adminTenantId}:admin`}');
    `);

    if (adminUsers.length > 0 && allTenants.length > 0) {
      // Add each admin user to each tenant organization with admin role
      const userOrganizationPairs = adminUsers.flatMap(user => 
        allTenants.map(tenant => ({ userId: user.id, organizationId: `t-${tenant.id}` }))
      );

      // Insert user-organization relations
      await pool.query(sql`
        insert into organization_user_relations (tenant_id, organization_id, user_id)
        values 
          ${sql.join(
            userOrganizationPairs.map(
              ({ userId, organizationId }) => sql`(${adminTenantId}, ${organizationId}, ${userId})`
            ),
            sql`, `
          )}
        on conflict (organization_id, user_id) do nothing;
      `);

      // Insert user-organization-role relations
      await pool.query(sql`
        insert into organization_role_user_relations (tenant_id, organization_id, organization_role_id, user_id)
        values 
          ${sql.join(
            userOrganizationPairs.map(
              ({ userId, organizationId }) => sql`(${adminTenantId}, ${organizationId}, 'admin', ${userId})`
            ),
            sql`, `
          )}
        on conflict (organization_id, organization_role_id, user_id) do nothing;
      `);

      consoleLog.info(`Associated ${adminUsers.length} admin users with ${allTenants.length} tenant organizations`);
    }

    consoleLog.info('Tenant organization setup completed successfully');
  },
  down: async (pool) => {
    consoleLog.info('=== Rolling back tenant organization setup ===');
    
    // Remove user-organization associations
    await pool.query(sql`
      delete from organization_role_user_relations 
      where tenant_id = ${adminTenantId} 
      and organization_id like 't-%';
    `);
    
    await pool.query(sql`
      delete from organization_user_relations 
      where tenant_id = ${adminTenantId} 
      and organization_id like 't-%';
    `);
    
    // Remove tenant organizations (keep template roles/scopes)
    await pool.query(sql`
      delete from organizations 
      where tenant_id = ${adminTenantId} 
      and id like 't-%';
    `);
    
    consoleLog.info('Tenant organization rollback completed');
  },
};

export default alteration; 