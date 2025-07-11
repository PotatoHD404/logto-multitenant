/* init_order = 2 */

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

create index jwt_blacklist__jti on jwt_blacklist (jti);
create index jwt_blacklist__expires_at on jwt_blacklist (expires_at);
create index jwt_blacklist__user_id on jwt_blacklist (user_id);
create index jwt_blacklist__session_uid on jwt_blacklist (session_uid); 