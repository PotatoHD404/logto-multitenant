import { TenantTag } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { sql, type CommonQueryMethods } from '@silverhand/slonik';

import { EnvSet } from '#src/env-set/index.js';

export type TenantData = {
  id: string;
  name: string;
  tag: TenantTag;
  dbUser: string | null;
  dbUserPassword: string | null;
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
    const query = limit && offset !== undefined
      ? sql`
          SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
          FROM tenants 
          WHERE id != 'admin'
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : sql`
          SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
          FROM tenants 
          WHERE id != 'admin'
          ORDER BY created_at DESC
        `;

    const result = await pool.any(query);
    return result.map((row: any) => ({
      id: row.id,
      name: row.name,
      tag: row.tag,
      dbUser: row.db_user,
      dbUserPassword: row.db_user_password,
      createdAt: row.created_at,
      isSuspended: row.is_suspended,
    }));
  };

  const findTenantById = async (id: string): Promise<TenantData | null> => {
    const result = await pool.maybeOne(sql`
      SELECT id, name, tag, db_user, db_user_password, created_at, is_suspended
      FROM tenants 
      WHERE id = ${id} AND id != 'admin'
    `);

    if (!result) {
      return null;
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
      SELECT COUNT(*) as count FROM tenants WHERE id != 'admin'
    `);
    return Number((result as any).count);
  };

  const createTenant = async (data: CreateTenantData): Promise<TenantData> => {
    const id = generateStandardId();
    // For local OSS, use Production tag (no dev/prod distinction)
    // For cloud, use Development tag as default
    const tag = data.tag || (EnvSet.values.isCloud ? TenantTag.Development : TenantTag.Production);
    const dbUser = `logto_tenant_${id}`;
    const dbUserPassword = generateStandardId(32);

    await pool.query(sql`
      INSERT INTO tenants (id, name, tag, db_user, db_user_password, created_at, is_suspended)
      VALUES (${id}, ${data.name}, ${tag}, ${dbUser}, ${dbUserPassword}, NOW(), false)
    `);

    const tenant = await findTenantById(id);
    if (!tenant) {
      throw new Error('Failed to create tenant');
    }

    return tenant;
  };

  const updateTenant = async (id: string, data: UpdateTenantData): Promise<TenantData | null> => {
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

    return await findTenantById(id);
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
      console.error('Error deleting tenant:', error);
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