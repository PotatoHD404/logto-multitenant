import type { CreateSignInExperience, SignInExperience } from '@logto/schemas';
import { SignInExperiences } from '@logto/schemas';
import type { CommonQueryMethods } from '@silverhand/slonik';
import { sql } from '@silverhand/slonik';

import { type WellKnownCache } from '#src/caches/well-known.js';
import { buildUpdateWhereWithPool } from '#src/database/update-where.js';
import { convertToIdentifiers } from '#src/utils/sql.js';

const id = 'default';

export const createSignInExperienceQueries = (
  pool: CommonQueryMethods,
  wellKnownCache: WellKnownCache,
  tenantId: string
) => {
  const updateSignInExperience = buildUpdateWhereWithPool(pool)(SignInExperiences, true);
  const { table, fields } = convertToIdentifiers(SignInExperiences);

  const updateDefaultSignInExperience = wellKnownCache.mutate(
    async (set: Partial<CreateSignInExperience>) =>
      updateSignInExperience({ set, where: { id, tenantId }, jsonbMode: 'replace' }),
    ['sie', () => tenantId]
  );

  const findDefaultSignInExperience = wellKnownCache.memoize(
    async () =>
      pool.one<SignInExperience>(sql`
      select ${sql.join(Object.values(fields), sql`, `)}
      from ${table}
      where ${fields.id} = ${id} and ${fields.tenantId} = ${tenantId}
    `),
    ['sie', () => tenantId]
  );

  return {
    updateDefaultSignInExperience,
    findDefaultSignInExperience,
  };
};
