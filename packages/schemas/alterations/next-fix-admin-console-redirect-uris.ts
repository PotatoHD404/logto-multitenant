import { sql } from '@silverhand/slonik';
import { appendPath } from '@silverhand/essentials';

import type { AlterationScript } from '../lib/types/alteration.js';

const adminTenantId = 'admin';
const adminConsoleApplicationId = 'admin-console';

const alteration: AlterationScript = {
  up: async (pool) => {
    // Get environment variables for admin endpoints
    const adminEndpoint = process.env.ADMIN_ENDPOINT;
    const adminPort = process.env.ADMIN_PORT || '3002';
    const adminDisableLocalhost = process.env.ADMIN_DISABLE_LOCALHOST === '1';
    
    // Build admin URLs based on environment configuration
    const adminUrls: string[] = [];
    
    // Add custom admin endpoint if provided
    if (adminEndpoint) {
      adminUrls.push(adminEndpoint);
    }
    
    // Add localhost admin endpoint if not disabled
    if (!adminDisableLocalhost) {
      adminUrls.push(`http://localhost:${adminPort}`);
    }
    
    // If no admin URLs are configured, use default localhost
    if (adminUrls.length === 0) {
      adminUrls.push(`http://localhost:${adminPort}`);
    }
    
    // Generate redirect URIs and post logout redirect URIs
    const redirectUris = adminUrls.map(url => appendPath(new URL(url), '/console/callback').toString());
    const postLogoutRedirectUris = adminUrls.map(url => appendPath(new URL(url), '/console').toString());
    
    // Update the admin console application with proper redirect URIs
    await pool.query(sql`
      UPDATE applications 
      SET oidc_client_metadata = jsonb_set(
        jsonb_set(
          oidc_client_metadata,
          '{redirectUris}',
          ${sql.jsonb(redirectUris)}
        ),
        '{postLogoutRedirectUris}',
        ${sql.jsonb(postLogoutRedirectUris)}
      )
      WHERE id = ${adminConsoleApplicationId} 
      AND tenant_id = ${adminTenantId}
    `);
    
    console.log('Updated admin console redirect URIs:', { redirectUris, postLogoutRedirectUris });
  },
  down: async (pool) => {
    // Revert to empty redirect URIs
    await pool.query(sql`
      UPDATE applications 
      SET oidc_client_metadata = jsonb_set(
        jsonb_set(
          oidc_client_metadata,
          '{redirectUris}',
          '[]'::jsonb
        ),
        '{postLogoutRedirectUris}',
        '[]'::jsonb
      )
      WHERE id = ${adminConsoleApplicationId} 
      AND tenant_id = ${adminTenantId}
    `);
  },
};

export default alteration; 