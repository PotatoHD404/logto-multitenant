import { MfaFactor, userMfaVerificationResponseGuard } from '@logto/schemas';
import { getUserDisplayName } from '@logto/shared';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { object, string, z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import assertThat from '#src/utils/assert-that.js';
import { transpileUserMfaVerifications } from '#src/utils/user.js';

import {
  generateBackupCodes,
  validateBackupCodes,
} from '../routes/interaction/utils/backup-code-validation.js';
import { generateTotpSecret, validateTotpSecret, validateTotpToken } from '../routes/interaction/utils/totp-validation.js';
import { generateWebAuthnRegistrationOptions } from '../routes/interaction/utils/webauthn.js';
import type { RouterInitArgs } from '../routes/types.js';

import type { AuthedMeRouter } from './types.js';

export default function mfaVerificationsRoutes<T extends AuthedMeRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  const {
    queries: {
      users: { findUserById, updateUserById },
    },
    libraries: {
      users: { addUserMfaVerification },
    },
  } = tenant;

  router.get(
    '/mfa-verifications',
    koaGuard({
      response: userMfaVerificationResponseGuard,
      status: [200, 404],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));
      
      ctx.body = transpileUserMfaVerifications(user.mfaVerifications);
      return next();
    }
  );

  router.post(
    '/mfa-verifications',
    koaGuard({
      body: z.discriminatedUnion('type', [
        z.object({
          type: z.literal(MfaFactor.TOTP),
          secret: z.string().optional(),
          code: z.string().optional(),
        }),
        z.object({
          type: z.literal(MfaFactor.BackupCode),
          codes: z.string().array().optional(),
        }),
        z.object({
          type: z.literal(MfaFactor.WebAuthn),
        }),
      ]),
      response: z.discriminatedUnion('type', [
        z.object({
          type: z.literal(MfaFactor.TOTP),
          secret: z.string(),
          secretQrCode: z.string(),
        }),
        z.object({
          type: z.literal(MfaFactor.BackupCode),
          codes: z.string().array(),
        }),
        z.object({
          type: z.literal(MfaFactor.WebAuthn),
          challenge: z.string(),
          options: z.object({
            challenge: z.string(),
            rp: z.object({
              name: z.string(),
              id: z.string(),
            }),
            user: z.object({
              id: z.string(),
              name: z.string(),
              displayName: z.string(),
            }),
            pubKeyCredParams: z.array(z.object({
              alg: z.number(),
              type: z.string(),
            })),
            timeout: z.number(),
            excludeCredentials: z.array(z.object({
              id: z.string(),
              type: z.string(),
              transports: z.array(z.string()).optional(),
            })).optional(),
            authenticatorSelection: z.object({
              residentKey: z.string().optional(),
            }).optional(),
          }),
        }),
      ]),
      status: [200, 404, 422],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const user = await findUserById(userId);
      const { id, mfaVerifications, username, primaryEmail, primaryPhone, name } = user;
      
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      const { type } = ctx.guard.body;

      if (type === MfaFactor.TOTP) {
        // A user can only bind one TOTP factor
        assertThat(
          mfaVerifications.every(({ type }) => type !== MfaFactor.TOTP),
          new RequestError({
            code: 'user.totp_already_in_use',
            status: 422,
          })
        );

        // Two-step process: if secret and code are provided, verify and save; otherwise just generate secret
        if (ctx.guard.body.secret && ctx.guard.body.code) {
          // Step 2: Verify the secret and code, then save to database
          assertThat(
            validateTotpSecret(ctx.guard.body.secret),
            new RequestError({
              code: 'user.totp_secret_invalid',
              status: 422,
            })
          );
          
          assertThat(
            validateTotpToken(ctx.guard.body.secret, ctx.guard.body.code),
            new RequestError({
              code: 'session.mfa.invalid_totp_code',
              status: 422,
            })
          );
          
          await addUserMfaVerification(id, { type: MfaFactor.TOTP, secret: ctx.guard.body.secret });
          ctx.body = {
            type: MfaFactor.TOTP,
            secret: ctx.guard.body.secret,
            secretQrCode: '', // Not needed for verification step
          };
        } else {
          // Step 1: Generate secret and QR code (don't save to database yet)
          const secret = generateTotpSecret();
          const service = ctx.URL.hostname;
          const user = getUserDisplayName({ username, primaryEmail, primaryPhone, name });
          const keyUri = authenticator.keyuri(user ?? 'Unnamed User', service, secret);
          ctx.body = {
            type: MfaFactor.TOTP,
            secret,
            secretQrCode: await qrcode.toDataURL(keyUri),
          };
        }
        return next();
      }

      if (type === MfaFactor.WebAuthn) {
        // A user can only bind one WebAuthn factor
        assertThat(
          mfaVerifications.every(({ type }) => type !== MfaFactor.WebAuthn),
          new RequestError({
            code: 'user.identity_already_in_use',
            status: 422,
          })
        );

        const options = await generateWebAuthnRegistrationOptions({
          rpId: ctx.URL.hostname,
          user: {
            id,
            name,
            username,
            primaryEmail,
            primaryPhone,
            mfaVerifications,
          },
        });

        ctx.body = {
          type: MfaFactor.WebAuthn,
          challenge: options.challenge,
          options,
        };
        return next();
      }

      // A user can only bind one available backup code factor
      assertThat(
        mfaVerifications.every(
          (verification) =>
            verification.type !== MfaFactor.BackupCode ||
            verification.codes.every(({ usedAt }) => usedAt)
        ),
        new RequestError({
          code: 'user.backup_code_already_in_use',
          status: 422,
        })
      );
      assertThat(
        mfaVerifications.some(({ type }) => type !== MfaFactor.BackupCode),
        new RequestError({
          code: 'session.mfa.backup_code_can_not_be_alone',
          status: 422,
        })
      );
      if (ctx.guard.body.codes) {
        assertThat(
          validateBackupCodes(ctx.guard.body.codes),
          new RequestError({
            code: 'user.wrong_backup_code_format',
            status: 422,
          })
        );
      }
      const codes = ctx.guard.body.codes ?? generateBackupCodes();
      await addUserMfaVerification(id, { type: MfaFactor.BackupCode, codes });
      ctx.body = { codes, type: MfaFactor.BackupCode };
      return next();
    }
  );

  router.delete(
    '/mfa-verifications/:verificationId',
    koaGuard({
      params: object({ verificationId: string() }),
      status: [204, 404],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { verificationId } = ctx.guard.params;

      const user = await findUserById(userId);
      assertThat(!user.isSuspended, new RequestError({ code: 'user.suspended', status: 401 }));

      const verification = user.mfaVerifications.find(({ id }) => id === verificationId);

      if (!verification) {
        throw new RequestError({
          code: 'entity.not_found',
          status: 404,
        });
      }

      await updateUserById(userId, {
        mfaVerifications: user.mfaVerifications.filter(({ id }) => id !== verification.id),
      });

      ctx.status = 204;

      return next();
    }
  );
} 