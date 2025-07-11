import {
  OidcModelInstances,
  type OidcModelInstance,
  type OidcModelInstancePayload,
} from '@logto/schemas';
import { conditional, conditionalString, type Nullable } from '@silverhand/essentials';
import { sql, type CommonQueryMethods, type ValueExpression } from '@silverhand/slonik';
import { addSeconds, isBefore } from 'date-fns';
import { generateStandardId } from '@logto/shared';

import { buildInsertIntoWithPool } from '#src/database/insert-into.js';
import { DeletionError } from '#src/errors/SlonikError/index.js';
import { convertToIdentifiers, convertToTimestamp } from '#src/utils/sql.js';
import { type EnvSet } from '#src/env-set/index.js';

export type WithConsumed<T> = T & { consumed?: boolean };
export type QueryResult = Pick<OidcModelInstance, 'payload' | 'consumedAt'>;

const { table, fields } = convertToIdentifiers(OidcModelInstances);

/**
 * This interval helps to avoid concurrency issues when exchanging the rotating refresh token multiple times within a given timeframe;
 * During the leeway window (in seconds), the consumed refresh token will be considered as valid.
 *
 * This is useful for distributed apps and serverless apps like Next.js, in which there is no shared memory.
 */
// Hard-code this value since 3 seconds is a reasonable number for concurrency and no need for further configuration
const refreshTokenReuseInterval = 3;

const isConsumed = (modelName: string, consumedAt: Nullable<number>): boolean => {
  if (!consumedAt) {
    return false;
  }

  if (modelName !== 'RefreshToken') {
    return Boolean(consumedAt);
  }

  return isBefore(addSeconds(consumedAt, refreshTokenReuseInterval), Date.now());
};

const withConsumed = <T>(
  data: T,
  modelName: string,
  consumedAt: Nullable<number>
): WithConsumed<T> => ({
  ...data,
  ...(isConsumed(modelName, consumedAt) ? { consumed: true } : undefined),
});

// eslint-disable-next-line @typescript-eslint/ban-types
const convertResult = (result: QueryResult | null, modelName: string) =>
  conditional(result && withConsumed(result.payload, modelName, result.consumedAt));

const findByModel = (modelName: string) => sql`
  select ${fields.payload}, ${fields.consumedAt}
  from ${table}
  where ${fields.modelName}=${modelName}
`;

/**
 * JWT Blacklist table structure for tracking revoked JWT tokens
 */
const jwtBlacklistTable = convertToIdentifiers({
  table: 'jwt_blacklist',
  fields: {
    id: 'id',
    jti: 'jti', // JWT ID from the token
    userId: 'user_id',
    sessionUid: 'session_uid',
    expiresAt: 'expires_at',
    revokedAt: 'revoked_at',
    tenantId: 'tenant_id'
  }
});

export const createOidcModelInstanceQueries = (pool: CommonQueryMethods, envSet?: EnvSet) => {
  const upsertInstance = buildInsertIntoWithPool(pool)(OidcModelInstances, {
    onConflict: {
      fields: [fields.tenantId, fields.modelName, fields.id],
      setExcludedFields: [fields.payload, fields.expiresAt],
    },
  });

  const findPayloadById = async (modelName: string, id: string) => {
    const result = await pool.maybeOne<QueryResult>(sql`
      ${findByModel(modelName)}
      and ${fields.id}=${id}
    `);

    return convertResult(result, modelName);
  };

  const findPayloadByPayloadField = async <
    T extends ValueExpression,
    Field extends keyof OidcModelInstancePayload,
  >(
    modelName: string,
    field: Field,
    value: T
  ) => {
    const result = await pool.maybeOne<QueryResult>(sql`
      ${findByModel(modelName)}
      and ${fields.payload}->>${field}=${value}
    `);

    return convertResult(result, modelName);
  };

  const consumeInstanceById = async (modelName: string, id: string) => {
    await pool.query(sql`
      update ${table}
      set ${fields.consumedAt}=${convertToTimestamp()}
      where ${fields.modelName}=${modelName}
      and ${fields.id}=${id}
    `);
  };

  const destroyInstanceById = async (modelName: string, id: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.id}=${id}
    `);
  };

  const revokeInstanceByGrantId = async (modelName: string, grantId: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.payload}->>'grantId'=${grantId}
    `);
  };

  const revokeInstanceByUserId = async (modelName: string, userId: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.payload}->>'accountId'=${userId}
    `);
  };

  /**
   * Find active sessions for a specific user with metadata from session extensions
   */
  const findSessionsByUserId = async (userId: string) => {
    const { table: sessionExtTable, fields: sessionExtFields } = convertToIdentifiers({ 
      table: 'oidc_session_extensions', 
      fields: {
        sessionUid: 'session_uid',
        accountId: 'account_id', 
        lastSubmission: 'last_submission',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      }
    });

    return pool.any<{
      id: string;
      sessionUid: string;
      payload: OidcModelInstancePayload;
      expiresAt: Date;
      lastSubmission?: Record<string, unknown>;
      updatedAt?: Date;
    }>(sql`
      select 
        s.${fields.id},
        s.${fields.payload}->>'uid' as session_uid,
        s.${fields.payload},
        s.${fields.expiresAt} as expires_at,
        ext.${sessionExtFields.lastSubmission} as last_submission,
        ext.${sessionExtFields.updatedAt} as updated_at
      from ${table} s
      left join ${sessionExtTable} ext on s.${fields.payload}->>'uid' = ext.${sessionExtFields.sessionUid}
      where s.${fields.modelName} = 'Session'
        and s.${fields.payload}->>'accountId' = ${userId}
        and s.${fields.expiresAt} > now()
        and s.${fields.consumedAt} is null
      order by ext.${sessionExtFields.createdAt} desc, s.${fields.expiresAt} desc
    `);
  };

  /**
   * Add a JWT token to the blacklist
   */
  const addToJwtBlacklist = async (jti: string, userId: string, sessionUid: string, expiresAt: Date, tenantId?: string) => {
    await pool.query(sql`
      insert into ${jwtBlacklistTable.table} (
        ${jwtBlacklistTable.fields.id},
        ${jwtBlacklistTable.fields.jti},
        ${jwtBlacklistTable.fields.userId},
        ${jwtBlacklistTable.fields.sessionUid},
        ${jwtBlacklistTable.fields.expiresAt},
        ${jwtBlacklistTable.fields.revokedAt},
        ${jwtBlacklistTable.fields.tenantId}
      ) values (
        ${generateStandardId()},
        ${jti},
        ${userId},
        ${sessionUid},
        ${convertToTimestamp(expiresAt)},
        ${convertToTimestamp()},
        ${tenantId ?? 'default'}
      )
      on conflict (${jwtBlacklistTable.fields.jti}, ${jwtBlacklistTable.fields.tenantId}) do nothing
    `);
  };

  /**
   * Check if a JWT token is blacklisted
   */
  const isJwtBlacklisted = async (jti: string) => {
    const result = await pool.maybeOne<{ count: string }>(sql`
      select count(*) as count
      from ${jwtBlacklistTable.table}
      where ${jwtBlacklistTable.fields.jti} = ${jti}
        and ${jwtBlacklistTable.fields.expiresAt} > now()
    `);
    
    return (result?.count ?? '0') !== '0';
  };

  /**
   * Revoke all JWT tokens associated with a specific session
   */
  const revokeJwtTokensBySessionId = async (sessionId: string, userId: string) => {
    // Find all JWT tokens associated with this session that are still valid
    const tokens = await pool.any<{
      jti: string;
      expiresAt: Date;
    }>(sql`
      select 
        ${fields.payload}->>'jti' as jti,
        ${fields.expiresAt} as expires_at
      from ${table}
      where ${fields.modelName} in ('AccessToken', 'RefreshToken')
        and ${fields.payload}->>'sessionUid' = ${sessionId}
        and ${fields.payload}->>'accountId' = ${userId}
        and ${fields.expiresAt} > now()
        and ${fields.consumedAt} is null
    `);

    // Add each token to the blacklist
    await Promise.all(
      tokens.map(token => 
        addToJwtBlacklist(token.jti, userId, sessionId, token.expiresAt, envSet?.tenantId)
      )
    );
  };

  /**
   * Revoke all tokens associated with a specific session
   */
  const revokeTokensBySessionId = async (sessionId: string) => {
    await Promise.all([
      // Revoke access tokens associated with this session
      pool.query(sql`
        delete from ${table}
        where ${fields.modelName} = 'AccessToken'
          and ${fields.payload}->>'sessionUid' = ${sessionId}
      `),
      // Revoke refresh tokens associated with this session
      pool.query(sql`
        delete from ${table}
        where ${fields.modelName} = 'RefreshToken'
          and ${fields.payload}->>'sessionUid' = ${sessionId}
      `),
    ]);
  };

  /**
   * Revoke a specific session by session UID for a user, including associated tokens
   */
  const revokeSessionByUid = async (sessionUid: string, userId: string) => {
    // First, blacklist all JWT tokens associated with this session
    await revokeJwtTokensBySessionId(sessionUid, userId);
    
    // Then revoke all tokens associated with this session
    await revokeTokensBySessionId(sessionUid);
    
    // Finally revoke the session itself
    const result = await pool.query(sql`
      delete from ${table}
      where ${fields.modelName} = 'Session'
        and ${fields.payload}->>'uid' = ${sessionUid}
        and ${fields.payload}->>'accountId' = ${userId}
    `);

    if (result.rowCount === 0) {
      throw new DeletionError('Session not found or already revoked');
    }
  };

  /**
   * Revoke all sessions except the current one for a user, including associated tokens
   */
  const revokeOtherSessionsByUserId = async (userId: string, currentSessionUid?: string) => {
    // First, find all sessions to be revoked to get their UIDs
    const sessionsToRevoke = await pool.any<{ sessionUid: string }>(sql`
      select ${fields.payload}->>'uid' as session_uid
      from ${table}
      where ${fields.modelName} = 'Session'
        and ${fields.payload}->>'accountId' = ${userId}
        ${currentSessionUid ? sql`and ${fields.payload}->>'uid' != ${currentSessionUid}` : sql``}
    `);

    // Blacklist JWT tokens and revoke tokens for each session
    await Promise.all(
      sessionsToRevoke.map(async ({ sessionUid }) => {
        await revokeJwtTokensBySessionId(sessionUid, userId);
        await revokeTokensBySessionId(sessionUid);
      })
    );

    // Then revoke the sessions themselves
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName} = 'Session'
        and ${fields.payload}->>'accountId' = ${userId}
        ${currentSessionUid ? sql`and ${fields.payload}->>'uid' != ${currentSessionUid}` : sql``}
    `);
  };

  /**
   * Clean up expired JWT blacklist entries
   */
  const cleanupExpiredBlacklistEntries = async () => {
    await pool.query(sql`
      delete from ${jwtBlacklistTable.table}
      where ${jwtBlacklistTable.fields.expiresAt} <= now()
    `);
  };

  return {
    upsertInstance,
    findPayloadById,
    findPayloadByPayloadField,
    consumeInstanceById,
    destroyInstanceById,
    revokeInstanceByGrantId,
    revokeInstanceByUserId,
    findSessionsByUserId,
    revokeSessionByUid,
    revokeOtherSessionsByUserId,
    revokeTokensBySessionId,
    revokeJwtTokensBySessionId,
    addToJwtBlacklist,
    isJwtBlacklisted,
    cleanupExpiredBlacklistEntries,
  };
};
