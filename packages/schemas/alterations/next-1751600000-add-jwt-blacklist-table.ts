import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

import { applyTableRls, dropTableRls } from './utils/1704934999-tables.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      create table jwt_blacklist (
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        id varchar(21) not null,
        jti varchar(128) not null,
        user_id varchar(12) not null
          references users (id) on update cascade on delete cascade,
        session_uid varchar(128) not null,
        expires_at timestamptz not null,
        revoked_at timestamptz not null default(now()),
        primary key (tenant_id, jti),
        unique (tenant_id, id)
      );
    `);

    await pool.query(sql`
      create index jwt_blacklist__jti on jwt_blacklist (jti);
    `);

    await pool.query(sql`
      create index jwt_blacklist__expires_at on jwt_blacklist (expires_at);
    `);

    await pool.query(sql`
      create index jwt_blacklist__user_id on jwt_blacklist (user_id);
    `);

    await pool.query(sql`
      create index jwt_blacklist__session_uid on jwt_blacklist (session_uid);
    `);

    await applyTableRls(pool, 'jwt_blacklist');
  },
  down: async (pool) => {
    await dropTableRls(pool, 'jwt_blacklist');

    await pool.query(sql`
      drop table jwt_blacklist;
    `);
  },
};

export default alteration; 