import { createTenantDatabaseMetadata } from '@logto/core-kit';
import {
  type AdminData,
  type UpdateAdminData,
  type CreateScope,
  type CreateRolesScope,
  defaultTenantId,
  adminTenantId,
  Applications,
  ApplicationsRoles,
  getMapiProxyM2mApp,
  getMapiProxyRole,
  defaultManagementApiAdminName,
  Roles,
  PredefinedScope,
  getManagementApiResourceIndicator,
  TenantTag,
  TenantManagementScope,
  AdminTenantRole,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { assert } from '@silverhand/essentials';
import type { CommonQueryMethods, DatabaseTransactionConnection } from '@silverhand/slonik';
import { sql } from '@silverhand/slonik';

import { insertInto } from '../../../database.js';
import { getDatabaseName } from '../../../queries/database.js';
import { consoleLog } from '../../../utils.js';

export const createTenant = async (pool: CommonQueryMethods, tenantId: string, isCloud: boolean) => {
  const database = await getDatabaseName(pool, true);
  const { parentRole, role, password } = createTenantDatabaseMetadata(database, tenantId);
  const createTenant = {
    id: tenantId,
    dbUser: role,
    dbUserPassword: password,
    // For local OSS, use Production tag (no dev/prod distinction)
    // For cloud, use Development tag as default
    tag: isCloud ? TenantTag.Development : TenantTag.Production,
  };

  await pool.query(insertInto(createTenant, 'tenants'));
  await pool.query(sql`
    create role ${sql.identifier([role])} with inherit login
      password '${sql.raw(password)}'
      in role ${sql.identifier([parentRole])};
  `);
};

export const seedAdminData = async (
  pool: CommonQueryMethods,
  data: AdminData | UpdateAdminData,
  ...additionalScopes: CreateScope[]
) => {
  const { resource, scopes, role } = data;

  assert(
    scopes.every(
      (scope) => resource.tenantId === scope.tenantId && scope.tenantId === role.tenantId
    ),
    new Error('All data should have the same tenant ID')
  );

  const processRole = async () => {
    if ('id' in role) {
      await pool.query(insertInto(role, 'roles'));

      return role.id;
    }

    // Query by role name for existing roles
    const { id } = await pool.one<{ id: string }>(sql`
      select id from roles
      where name=${role.name}
      and tenant_id=${String(role.tenantId)}
    `);

    return id;
  };

  await pool.query(insertInto(resource, 'resources'));
  await Promise.all(
    [...scopes, ...additionalScopes].map(async (scope) => pool.query(insertInto(scope, 'scopes')))
  );

  const roleId = await processRole();
  await Promise.all(
    scopes.map(async ({ id }) =>
      pool.query(
        insertInto(
          {
            id: generateStandardId(),
            roleId,
            scopeId: id,
            tenantId: resource.tenantId,
          } satisfies CreateRolesScope,
          'roles_scopes'
        )
      )
    )
  );
};

export const assignScopesToRole = async (
  pool: CommonQueryMethods,
  tenantId: string,
  roleId: string,
  ...scopeIds: string[]
) => {
  await Promise.all(
    scopeIds.map(async (scopeId) =>
      pool.query(
        insertInto(
          {
            id: generateStandardId(),
            roleId,
            scopeId,
            tenantId,
          } satisfies CreateRolesScope,
          'roles_scopes'
        )
      )
    )
  );
};

/**
 * For each initial tenant (`default` and `admin`), create a machine-to-machine application for
 * Management API proxy and assign the corresponding proxy role to it.
 */
export const seedManagementApiProxyApplications = async (
  connection: DatabaseTransactionConnection
) => {
  const tenantIds = [defaultTenantId, adminTenantId];

  // Create machine-to-machine applications for Management API proxy
  await connection.query(
    insertInto(
      tenantIds.map((tenantId) => getMapiProxyM2mApp(tenantId)),
      Applications.table
    )
  );
  consoleLog.succeed('Created machine-to-machine applications for Management API proxy');

  // Assign the proxy roles to the applications
  await connection.query(
    insertInto(
      tenantIds.map((tenantId) => ({
        tenantId: adminTenantId,
        id: generateStandardId(),
        applicationId: getMapiProxyM2mApp(tenantId).id,
        roleId: getMapiProxyRole(tenantId).id,
      })),
      ApplicationsRoles.table
    )
  );
  consoleLog.succeed('Assigned the proxy roles to the applications');
};

/**
 * Seed the legacy user role for accessing default Management API, and assign the `all` scope to
 * it. Used in OSS only.
 */
export const seedLegacyManagementApiUserRole = async (
  connection: DatabaseTransactionConnection
) => {
  const roleId = generateStandardId();
  await connection.query(
    insertInto(
      {
        tenantId: adminTenantId,
        id: roleId,
        name: defaultManagementApiAdminName,
        description: 'Legacy user role for accessing default Management API. Used in OSS only.',
      },
      Roles.table
    )
  );
  
  // Assign the 'all' scope to the role
  await connection.query(sql`
    insert into roles_scopes (id, role_id, scope_id, tenant_id)
    values (
      ${generateStandardId()},
      ${roleId},
      (
        select scopes.id from scopes
        join resources on scopes.resource_id = resources.id
        where resources.indicator = ${getManagementApiResourceIndicator(defaultTenantId)}
        and scopes.name = ${PredefinedScope.All}
        and scopes.tenant_id = ${adminTenantId}
      ),
      ${adminTenantId}
    );
  `);
  
  // Assign tenant management scopes to the role for OSS tenant management
  const tenantManagementScopes = [
    TenantManagementScope.Read,
    TenantManagementScope.Write,
    TenantManagementScope.Delete,
  ];
  
  await Promise.all(
    tenantManagementScopes.map(async (scopeName) => {
      await connection.query(sql`
        insert into roles_scopes (id, role_id, scope_id, tenant_id)
        values (
          ${generateStandardId()},
          ${roleId},
          (
            select scopes.id from scopes
            join resources on scopes.resource_id = resources.id
            where resources.indicator = ${getManagementApiResourceIndicator(defaultTenantId)}
            and scopes.name = ${scopeName}
            and scopes.tenant_id = ${adminTenantId}
          ),
          ${adminTenantId}
        );
      `);
    })
  );
  
  consoleLog.succeed('Assigned tenant management scopes to legacy admin role');
};

/**
 * Seed admin tenant management API scopes to the admin tenant user role.
 * This allows the admin tenant user role to access the admin tenant management API.
 * Used in OSS only.
 */
export const seedAdminTenantManagementApiUserScopes = async (
  connection: DatabaseTransactionConnection
) => {
  const userRole = await connection.maybeOne<{ id: string }>(sql`
    select id from roles
    where tenant_id = ${adminTenantId}
    and name = ${AdminTenantRole.User}
  `);
  
  if (!userRole) {
    consoleLog.warn('Admin tenant user role not found, skipping admin tenant management API scope assignment');
    return;
  }

  // Check if admin tenant management API resource exists
  const adminApiResource = await connection.maybeOne<{ id: string }>(sql`
    select id from resources
    where indicator = ${getManagementApiResourceIndicator(adminTenantId)}
    and tenant_id = ${adminTenantId}
  `);
  
  if (!adminApiResource) {
    consoleLog.warn('Admin tenant management API resource not found, skipping scope assignment');
    return;
  }

  // Assign admin tenant management API scopes to the user role
  await connection.query(sql`
    insert into roles_scopes (id, role_id, scope_id, tenant_id)
    values (
      ${generateStandardId()},
      ${userRole.id},
      (
        select scopes.id from scopes
        join resources on scopes.resource_id = resources.id
        where resources.indicator = ${getManagementApiResourceIndicator(adminTenantId)}
        and scopes.name = ${PredefinedScope.All}
        and scopes.tenant_id = ${adminTenantId}
      ),
      ${adminTenantId}
    );
  `);
  
  // Assign tenant management scopes to the user role for admin tenant management
  const tenantManagementScopes = [
    TenantManagementScope.Read,
    TenantManagementScope.Write,
    TenantManagementScope.Delete,
  ];
  
  await Promise.all(
    tenantManagementScopes.map(async (scopeName) => {
      await connection.query(sql`
        insert into roles_scopes (id, role_id, scope_id, tenant_id)
        values (
          ${generateStandardId()},
          ${userRole.id},
          (
            select scopes.id from scopes
            join resources on scopes.resource_id = resources.id
            where resources.indicator = ${getManagementApiResourceIndicator(adminTenantId)}
            and scopes.name = ${scopeName}
            and scopes.tenant_id = ${adminTenantId}
          ),
          ${adminTenantId}
        );
      `);
    })
  );
  
  consoleLog.succeed('Assigned admin tenant management API scopes to admin tenant user role');
};
