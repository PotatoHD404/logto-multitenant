import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    // Set up organization-based access for admin-console application
    // This creates organizations for each tenant and grants admin-console access to them
    
    console.log('Setting up organization-based access for admin-console application...');
    
    // Get all tenants
    const tenants = await pool.any<{ id: string; name: string }>(sql`
      SELECT id, name FROM tenants
    `);
    
    console.log(`Found ${tenants.length} tenants`);
    
    // Create organizations for each tenant (using tenant ID as organization ID)
    console.log('Creating organizations for tenants...');
    let organizationsCreated = 0;
    
    for (const tenant of tenants) {
      // Check if organization already exists
      const existingOrg = await pool.maybeOne(sql`
        SELECT id FROM organizations WHERE tenant_id = 'admin' AND id = ${tenant.id}
      `);
      
      if (!existingOrg) {
        await pool.query(sql`
          INSERT INTO organizations (tenant_id, id, name, description, created_at)
          VALUES ('admin', ${tenant.id}, ${'Tenant ' + tenant.name}, ${'Organization for tenant ' + tenant.id}, NOW())
        `);
        organizationsCreated++;
        console.log(`Created organization for tenant: ${tenant.id}`);
      } else {
        console.log(`Organization already exists for tenant: ${tenant.id}`);
      }
    }
    
    console.log(`Created ${organizationsCreated} organizations`);
    
    // Create default organization role for tenant management
    console.log('Creating tenant admin roles...');
    let rolesCreated = 0;
    
    const organizations = await pool.any<{ id: string }>(sql`
      SELECT id FROM organizations WHERE tenant_id = 'admin'
    `);
    
    for (const org of organizations) {
      const roleId = org.id + '-admin';
      
      // Check if role already exists
      const existingRole = await pool.maybeOne(sql`
        SELECT id FROM organization_roles WHERE tenant_id = 'admin' AND id = ${roleId}
      `);
      
      if (!existingRole) {
        await pool.query(sql`
          INSERT INTO organization_roles (tenant_id, id, name, description, organization_id, created_at)
          VALUES ('admin', ${roleId}, 'Tenant Admin', 'Full administrative access to tenant resources', ${org.id}, NOW())
        `);
        rolesCreated++;
        console.log(`Created tenant admin role for organization: ${org.id}`);
      } else {
        console.log(`Tenant admin role already exists for organization: ${org.id}`);
      }
    }
    
    console.log(`Created ${rolesCreated} tenant admin roles`);
    
    // Get all organization scopes for tenant management
    const orgScopes = await pool.any<{ id: string; name: string }>(sql`
      SELECT id, name FROM organization_scopes 
      WHERE tenant_id = 'admin'
      AND name IN ('delete:data', 'invite:member', 'manage:tenant', 'read:data', 'read:member', 'remove:member', 'update:member:role', 'write:data')
    `);
    
    console.log(`Found ${orgScopes.length} organization scopes for tenant management`);
    
    // Assign organization scopes to tenant admin roles
    console.log('Assigning organization scopes to tenant admin roles...');
    let scopeAssignments = 0;
    
    const tenantAdminRoles = await pool.any<{ id: string; organization_id: string }>(sql`
      SELECT id, organization_id FROM organization_roles 
      WHERE tenant_id = 'admin' AND name = 'Tenant Admin'
    `);
    
    for (const role of tenantAdminRoles) {
      for (const scope of orgScopes) {
        // Check if scope assignment already exists
        const existingAssignment = await pool.maybeOne(sql`
          SELECT organization_role_id FROM organization_role_scope_relations 
          WHERE tenant_id = 'admin'
          AND organization_role_id = ${role.id}
          AND organization_scope_id = ${scope.id}
        `);
        
        if (!existingAssignment) {
          await pool.query(sql`
            INSERT INTO organization_role_scope_relations (tenant_id, organization_role_id, organization_scope_id)
            VALUES ('admin', ${role.id}, ${scope.id})
          `);
          scopeAssignments++;
        }
      }
    }
    
    console.log(`Created ${scopeAssignments} scope assignments`);
    
    // Find the admin-console application in the admin tenant
    const adminConsoleApp = await pool.maybeOne<{ id: string }>(sql`
      SELECT id FROM applications WHERE tenant_id = 'admin' AND id = 'admin-console'
    `);
    
    if (!adminConsoleApp) {
      console.log('Admin-console application not found in admin tenant');
      return;
    }
    
    console.log(`Found admin-console application: ${adminConsoleApp.id}`);
    
    // Associate admin-console application with all organizations
    console.log('Associating admin-console with organizations...');
    let appAssociations = 0;
    
    for (const org of organizations) {
      // Check if association already exists
      const existingAssociation = await pool.maybeOne(sql`
        SELECT organization_id FROM organization_application_relations 
        WHERE tenant_id = 'admin'
        AND organization_id = ${org.id}
        AND application_id = ${adminConsoleApp.id}
      `);
      
      if (!existingAssociation) {
        await pool.query(sql`
          INSERT INTO organization_application_relations (tenant_id, organization_id, application_id, created_at)
          VALUES ('admin', ${org.id}, ${adminConsoleApp.id}, NOW())
        `);
        appAssociations++;
        console.log(`Associated admin-console with organization: ${org.id}`);
      } else {
        console.log(`Admin-console already associated with organization: ${org.id}`);
      }
    }
    
    console.log(`Created ${appAssociations} organization associations`);
    
    // Assign tenant admin role to admin-console application in each organization
    console.log('Assigning tenant admin roles to admin-console...');
    let roleAssignments = 0;
    
    for (const role of tenantAdminRoles) {
      // Check if role assignment already exists
      const existingRoleAssignment = await pool.maybeOne(sql`
        SELECT organization_id FROM organization_application_role_relations 
        WHERE tenant_id = 'admin'
        AND organization_id = ${role.organization_id}
        AND application_id = ${adminConsoleApp.id}
        AND organization_role_id = ${role.id}
      `);
      
      if (!existingRoleAssignment) {
        await pool.query(sql`
          INSERT INTO organization_application_role_relations (tenant_id, organization_id, application_id, organization_role_id, created_at)
          VALUES ('admin', ${role.organization_id}, ${adminConsoleApp.id}, ${role.id}, NOW())
        `);
        roleAssignments++;
        console.log(`Assigned tenant admin role to admin-console in organization: ${role.organization_id}`);
      } else {
        console.log(`Tenant admin role already assigned to admin-console in organization: ${role.organization_id}`);
      }
    }
    
    console.log(`Created ${roleAssignments} role assignments`);
    
    // Update existing OIDC grants to include organization resources
    console.log('Updating existing OIDC grants to include organization resources...');
    
    let grantsUpdated = 0;
    
    // Find all active grants for admin-console
    const activeGrants = await pool.any<{ id: string; payload: any }>(sql`
      SELECT id, payload 
      FROM oidc_model_instances 
      WHERE tenant_id = 'admin'
      AND model_name = 'Grant'
      AND payload->>'clientId' = 'admin-console'
      AND expires_at > NOW()
    `);
    
    for (const grant of activeGrants) {
      const payload = grant.payload;
      let grantModified = false;
      
      // Initialize resources if not present
      if (!payload.resources) {
        payload.resources = {};
        grantModified = true;
      }
      
      // Add all organization resources to the grant
      for (const org of organizations) {
        const orgUrn = `urn:logto:organization:${org.id}`;
        if (!payload.resources[orgUrn]) {
          payload.resources[orgUrn] = 'delete:data invite:member manage:tenant read:data read:member remove:member update:member:role write:data';
          grantModified = true;
        }
      }
      
      // Update the grant in the database if modified
      if (grantModified) {
        await pool.query(sql`
          UPDATE oidc_model_instances 
          SET payload = ${JSON.stringify(payload)}
          WHERE id = ${grant.id}
        `);
        
        grantsUpdated++;
        console.log(`Updated grant ${grant.id} to include ${Object.keys(payload.resources).length} organization resources`);
      }
    }
    
    console.log(`Updated ${grantsUpdated} existing grants to include organization resources`);
    console.log('Organization-based access setup complete!');
  },

  down: async (pool) => {
    // Remove organization-based access for admin-console application
    console.log('Removing organization-based access for admin-console application...');
    
    // Remove admin-console application from organizations
    const roleAssignments = await pool.query(sql`
      DELETE FROM organization_application_role_relations 
      WHERE tenant_id = 'admin' AND application_id = 'admin-console'
    `);
    
    console.log(`Removed ${roleAssignments.rowCount} role assignments from admin-console`);
    
    const appAssociations = await pool.query(sql`
      DELETE FROM organization_application_relations 
      WHERE tenant_id = 'admin' AND application_id = 'admin-console'
    `);
    
    console.log(`Removed ${appAssociations.rowCount} organization associations from admin-console`);
    
    // Remove organization roles and scope relations
    const scopeRelations = await pool.query(sql`
      DELETE FROM organization_role_scope_relations 
      WHERE tenant_id = 'admin' AND organization_role_id IN (
        SELECT id FROM organization_roles WHERE tenant_id = 'admin' AND name = 'Tenant Admin'
      )
    `);
    
    console.log(`Removed ${scopeRelations.rowCount} scope relations from tenant admin roles`);
    
    const roles = await pool.query(sql`
      DELETE FROM organization_roles 
      WHERE tenant_id = 'admin' AND name = 'Tenant Admin'
    `);
    
    console.log(`Removed ${roles.rowCount} tenant admin roles`);
    
    // Remove organizations that were created for tenants
    const organizations = await pool.query(sql`
      DELETE FROM organizations 
      WHERE tenant_id = 'admin' AND id IN (SELECT id FROM tenants)
    `);
    
    console.log(`Removed ${organizations.rowCount} organizations`);
  },
};

export default alteration;