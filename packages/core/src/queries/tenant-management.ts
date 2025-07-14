import { TenantTag, adminTenantId, getTenantOrganizationId, TenantRole } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql, type CommonQueryMethods } from '@silverhand/slonik';

import { EnvSet } from '#src/env-set/index.js';
import { unknownConsole } from '#src/utils/console.js';
import { getTenantRole } from '@logto/schemas';

export type TenantData = {
  id: string;
  name: string;
  tag: TenantTag;
  dbUser: string | undefined;
  dbUserPassword: string | undefined;
  createdAt: Date;
  isSuspended: boolean;
};

export type CreateTenantData = {
  name: string;
  tag?: TenantTag;
};

export type UpdateTenantData = {
  name?: string;
  tag?: TenantTag;
};

const createTenantManagementQueries = (pool: CommonQueryMethods) => {
  const findAllTenants = async (limit?: number, offset?: number): Promise<TenantData[]> => {
    const query =
      limit && offset !== undefined
        ? sql`
          SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
          FROM tenants 
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
        : sql`
          SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
          FROM tenants 
          ORDER BY created_at DESC
        `;

    const result = await pool.any(query);
    return result.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      tag: row.tag as TenantTag,
      dbUser: row.db_user as string | undefined,
      dbUserPassword: row.db_user_password as string | undefined,
      createdAt: new Date(row.created_at as string),
      isSuspended: row.is_suspended as boolean,
    }));
  };

  const findTenantById = async (id: string): Promise<TenantData | undefined> => {
    const result = await pool.maybeOne(sql`
      SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
      FROM tenants 
      WHERE id = ${id}
    `);

    if (!result) {
      return undefined;
    }

    return {
      id: (result as any).id,
      name: (result as any).name,
      tag: (result as any).tag,
      dbUser: (result as any).db_user,
      dbUserPassword: (result as any).db_user_password,
      createdAt: (result as any).created_at,
      isSuspended: (result as any).is_suspended,
    };
  };

  const countTenants = async (): Promise<number> => {
    const result = await pool.one(sql`
      SELECT COUNT(*) as count FROM tenants
    `);
    return Number((result as any).count);
  };

  /**
   * Create a tenant organization in the admin tenant for the new tenant.
   * This allows admin users to manage the tenant through organization-based access control.
   */
  const createTenantOrganization = async (tenantId: string, tenantName: string) => {
    const { isCloud } = EnvSet.values;

    // Only create tenant organizations for local OSS multi-tenant setup
    if (isCloud) {
      return;
    }

    const organizationId = getTenantOrganizationId(tenantId);
    const organizationName = tenantId === adminTenantId ? 'Admin' : `Tenant ${tenantName}`;
    const organizationDescription = `Organization for tenant ${tenantId}`;

    try {
      // Create the tenant organization
      await pool.query(sql`
        INSERT INTO organizations (id, tenant_id, name, description)
        VALUES (${organizationId}, ${adminTenantId}, ${organizationName}, ${organizationDescription})
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description;
      `);

      // Get all existing admin users from the admin tenant
      const adminUsers = await pool.any<{ id: string }>(sql`
        SELECT DISTINCT u.id
        FROM users u
        JOIN users_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = ${adminTenantId}
        AND r.tenant_id = ${adminTenantId}
        AND r.type = 'User'
        AND (r.name LIKE '%admin%' OR r.name = ${`${adminTenantId}:admin`});
      `);

      if (adminUsers.length > 0) {
        // Add all admin users to the new tenant organization with admin role
        await pool.query(sql`
          INSERT INTO organization_user_relations (tenant_id, organization_id, user_id)
          VALUES ${sql.join(
            adminUsers.map((user) => sql`(${adminTenantId}, ${organizationId}, ${user.id})`),
            sql`, `
          )}
          ON CONFLICT (organization_id, user_id) DO NOTHING;
        `);

        await pool.query(sql`
          INSERT INTO organization_role_user_relations (tenant_id, organization_id, organization_role_id, user_id)
          VALUES ${sql.join(
            adminUsers.map(
              (user) => sql`(${adminTenantId}, ${organizationId}, 'admin', ${user.id})`
            ),
            sql`, `
          )}
          ON CONFLICT (organization_id, organization_role_id, user_id) DO NOTHING;
        `);

        unknownConsole.info(
          `Added ${adminUsers.length} admin users to tenant organization ${organizationId}`
        );
      }

      unknownConsole.info(`Created tenant organization ${organizationId} for tenant ${tenantId}`);
    } catch (error) {
      unknownConsole.error(`Failed to create tenant organization for ${tenantId}:`, error);
      // Don't throw error to avoid breaking tenant creation
    }
  };

  const createTenant = async (data: CreateTenantData): Promise<TenantData> => {
    const id = generateStandardId();
    // For local OSS, use Production tag (no dev/prod distinction)
    // For cloud, use Development tag as default
    const tag = data.tag || (EnvSet.values.isCloud ? TenantTag.Development : TenantTag.Production);
    const databaseUser = `logto_tenant_${id}`;
    const databaseUserPassword = generateStandardId(32);

    await pool.query(sql`
      INSERT INTO tenants (id, name, tag, db_user, db_user_password, created_at, is_suspended)
      VALUES (${id}, ${data.name}, ${tag}, ${databaseUser}, ${databaseUserPassword}, NOW(), false)
    `);

    const tenant = await findTenantById(id);
    if (!tenant) {
      throw new Error('Failed to create tenant');
    }

    // Automatically create tenant organization for multi-tenant access control
    await createTenantOrganization(id, data.name);

    return tenant;
  };

  const updateTenant = async (
    id: string,
    data: UpdateTenantData
  ): Promise<TenantData | undefined> => {
    const existing = await findTenantById(id);
    if (!existing) {
      return null;
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];

    if (data.name !== undefined) {
      updateFields.push(`name = $${updateValues.length + 1}`);
      updateValues.push(data.name);
    }

    if (data.tag !== undefined) {
      updateFields.push(`tag = $${updateValues.length + 1}`);
      updateValues.push(data.tag);
    }

    if (updateFields.length === 0) {
      return existing;
    }

    // Execute update
    if (data.name !== undefined && data.tag !== undefined) {
      await pool.query(sql`
        UPDATE tenants 
        SET name = ${data.name}, tag = ${data.tag}
        WHERE id = ${id}
      `);
    } else if (data.name !== undefined) {
      await pool.query(sql`
        UPDATE tenants 
        SET name = ${data.name}
        WHERE id = ${id}
      `);
    } else if (data.tag !== undefined) {
      await pool.query(sql`
        UPDATE tenants 
        SET tag = ${data.tag}
        WHERE id = ${id}
      `);
    }

    return findTenantById(id);
  };

  const deleteTenant = async (id: string): Promise<boolean> => {
    // Prevent deletion of system tenants
    if (id === 'admin' || id === 'default') {
      return false;
    }

    const tenant = await findTenantById(id);
    if (!tenant) {
      return false;
    }

    try {
      // Drop database role if it exists
      if (tenant.dbUser) {
        await pool.query(sql`
          DROP ROLE IF EXISTS ${sql.identifier([tenant.dbUser])}
        `);
      }

      // Delete tenant record
      await pool.query(sql`
        DELETE FROM tenants WHERE id = ${id}
      `);

      return true;
    } catch (error) {
      unknownConsole.error('Error deleting tenant:', error);
      return false;
    }
  };

  const tenantExists = async (id: string): Promise<boolean> => {
    const result = await pool.maybeOne(sql`
      SELECT id FROM tenants WHERE id = ${id}
    `);
    return result !== null;
  };

  return {
    findAllTenants,
    findTenantById,
    countTenants,
    createTenant,
    updateTenant,
    deleteTenant,
    tenantExists,
  };
};

export default createTenantManagementQueries;
