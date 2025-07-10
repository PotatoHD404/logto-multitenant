import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      alter table sign_in_experiences
        add column if not exists mfa jsonb not null default '{}'::jsonb;
    `);

    // Set default MFA config for default tenant (keep it as UserControlled with no factors)
    await pool.query(sql`
      update sign_in_experiences
        set mfa = '{"factors":[],"policy":"UserControlled"}'
        where id = 'default' and tenant_id = 'default';
    `);

    // Set MFA prompt config for admin tenant (enable all factors with prompt policy)
    await pool.query(sql`
      update sign_in_experiences
        set mfa = '{"factors":["Totp","WebAuthn","BackupCode"],"policy":"PromptAtSignInAndSignUp"}'
        where id = 'default' and tenant_id = 'admin';
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      alter table sign_in_experiences
        drop column mfa;
    `);
  },
};

export default alteration;
