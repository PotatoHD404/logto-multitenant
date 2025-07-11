import {
  OidcModelInstances,
  type OidcModelInstance,
  type OidcModelInstancePayload,
} from '@logto/schemas';
import { conditional, conditionalString, type Nullable } from '@silverhand/essentials';
import { sql, type CommonQueryMethods, type ValueExpression } from '@silverhand/slonik';
import { addSeconds, isBefore } from 'date-fns';

import { buildInsertIntoWithPool } from '#src/database/insert-into.js';
import { DeletionError } from '#src/errors/SlonikError/index.js';
import { convertToIdentifiers, convertToTimestamp } from '#src/utils/sql.js';

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

export const createOidcModelInstanceQueries = (pool: CommonQueryMethods) => {
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
   * Revoke a specific session by session UID for a user
   */
  const revokeSessionByUid = async (sessionUid: string, userId: string) => {
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
   * Revoke all sessions except the current one for a user
   */
  const revokeOtherSessionsByUserId = async (userId: string, currentSessionUid?: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName} = 'Session'
        and ${fields.payload}->>'accountId' = ${userId}
        ${currentSessionUid ? sql`and ${fields.payload}->>'uid' != ${currentSessionUid}` : sql``}
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
  };
};
