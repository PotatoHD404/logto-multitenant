import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    // Grant admin-console application access to Management API resources for all existing tenants
    // This fixes cross-tenant access for tenants created before this fix was implemented
    
    console.log('Granting admin-console application access to Management API resources...');
    
    // Find all Management API resources in the admin tenant (these represent different tenant APIs)
    const managementApiResources = await pool.any<{ id: string; indicator: string }>(sql`
      SELECT id, indicator 
      FROM resources 
      WHERE tenant_id = 'admin' 
      AND (
        indicator LIKE '%.logto.app/api' 
        OR indicator = 'https://admin.logto.app/api'
        OR indicator = 'https://admin.logto.app/me'
        OR indicator = 'https://profile.logto.app/api'
      )
    `);
    
    console.log(`Found ${managementApiResources.length} Management API resources`);
    
    // Find the admin-console application in the admin tenant
    const adminConsoleApp = await pool.maybeOne<{ id: string }>(sql`
      SELECT id FROM applications WHERE tenant_id = 'admin' AND id = 'admin-console'
    `);
    
    if (!adminConsoleApp) {
      console.log('Admin-console application not found in admin tenant');
      return;
    }
    
    console.log(`Found admin-console application: ${adminConsoleApp.id}`);
    
    let scopesGranted = 0;
    
    // For each Management API resource, grant all its scopes to admin-console
    for (const resource of managementApiResources) {
      console.log(`Processing resource: ${resource.indicator}`);
      
      // Get all scopes for this resource
      const scopes = await pool.any<{ id: string; name: string }>(sql`
        SELECT id, name FROM scopes WHERE resource_id = ${resource.id}
      `);
      
      for (const scope of scopes) {
        // Check if consent already exists
        const existingConsent = await pool.maybeOne(sql`
          SELECT application_id FROM application_user_consent_resource_scopes 
          WHERE tenant_id = 'admin'
          AND application_id = ${adminConsoleApp.id} 
          AND scope_id = ${scope.id}
        `);
        
        if (!existingConsent) {
          // Grant the scope to admin-console application
          await pool.query(sql`
            INSERT INTO application_user_consent_resource_scopes (tenant_id, application_id, scope_id)
            VALUES ('admin', ${adminConsoleApp.id}, ${scope.id})
          `);
          
          scopesGranted++;
          console.log(`Granted scope '${scope.name}' for resource '${resource.indicator}'`);
        } else {
          console.log(`Scope '${scope.name}' already granted for resource '${resource.indicator}'`);
        }
      }
    }
    
    console.log(`Granted ${scopesGranted} scopes to admin-console application`);
  },

  down: async (pool) => {
    // Remove admin-console application access to Management API resources
    console.log('Removing admin-console application access to Management API resources...');
    
    const result = await pool.query(sql`
      DELETE FROM application_user_consent_resource_scopes 
      WHERE tenant_id = 'admin' 
      AND application_id = 'admin-console'
      AND scope_id IN (
        SELECT s.id 
        FROM scopes s 
        JOIN resources r ON s.resource_id = r.id 
        WHERE r.tenant_id = 'admin' 
        AND (
          r.indicator LIKE '%.logto.app/api' 
          OR r.indicator = 'https://admin.logto.app/api'
          OR r.indicator = 'https://admin.logto.app/me'
          OR r.indicator = 'https://profile.logto.app/api'
        )
      )
    `);
    
    console.log(`Removed ${result.rowCount} scope grants from admin-console application`);
  },
};

export default alteration; 