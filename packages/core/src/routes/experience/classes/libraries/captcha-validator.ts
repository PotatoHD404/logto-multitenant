import {
  CaptchaType,
  type CaptchaProvider,
  type RecaptchaEnterpriseConfig,
  type TurnstileConfig,
  type YandexSmartCaptchaConfig,
} from '@logto/schemas';
import ky from 'ky';
import { z } from 'zod';

import { type LogEntry } from '#src/middleware/koa-audit-log.js';

function isRecaptchaEnterprise(
  config: CaptchaProvider['config']
): config is RecaptchaEnterpriseConfig {
  return config.type === CaptchaType.RecaptchaEnterprise;
}

function isTurnstile(config: CaptchaProvider['config']): config is TurnstileConfig {
  return config.type === CaptchaType.Turnstile;
}

function isYandexSmartCaptcha(
  config: CaptchaProvider['config']
): config is YandexSmartCaptchaConfig {
  return config.type === CaptchaType.YandexSmartCaptcha;
}

export class CaptchaValidator {
  constructor(
    private readonly captchaProvider: CaptchaProvider,
    private readonly log: LogEntry
  ) {}

  public async verifyCaptcha(captchaToken: string): Promise<boolean> {
    const { config } = this.captchaProvider;

    if (isRecaptchaEnterprise(config)) {
      return this.verifyRecaptchaEnterprise(config, captchaToken);
    }

    if (isTurnstile(config)) {
      return this.verifyTurnstile(config, captchaToken);
    }

    if (isYandexSmartCaptcha(config)) {
      return this.verifyYandexSmartCaptcha(config, captchaToken);
    }

    throw new Error('Invalid captcha provider');
  }

  private async verifyTurnstile(config: TurnstileConfig, captchaToken: string) {
    try {
      const result = await ky
        .post('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: config.secretKey,
            response: captchaToken,
          }),
        })
        .json();

      const responseGuard = z.object({
        success: z.boolean(),
        'error-codes': z.array(z.string()).optional(),
      });

      const response = responseGuard.parse(result);

      this.log.append({
        success: response.success,
        errorMessage: response['error-codes']?.join(', '),
      });

      return response.success;
    } catch {
      this.log.append({
        success: false,
        errorMessage: 'Failed to get the result from Cloudflare Turnstile',
      });

      return false;
    }
  }

  private async verifyRecaptchaEnterprise(config: RecaptchaEnterpriseConfig, captchaToken: string) {
    try {
      const result = await ky
        .post(
          `https://recaptchaenterprise.googleapis.com/v1/projects/${config.projectId}/assessments?key=${config.secretKey}`,
          {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: {
                token: captchaToken,
                siteKey: config.siteKey,
                // We can't decide the action here, because the interaction event may change after the user interaction.
                // So we use a fixed action here.
                expectedAction: 'interaction',
              },
            }),
          }
        )
        .json();

      const responseGuard = z.object({
        tokenProperties: z.object({
          valid: z.boolean(),
        }),
        riskAnalysis: z.object({
          score: z.number(),
        }),
      });

      const {
        tokenProperties: { valid },
        riskAnalysis: { score },
      } = responseGuard.parse(result);

      // TODO: customize the score threshold
      const success = valid && score >= 0.5;

      this.log.append({
        success,
        score,
      });

      return success;
    } catch {
      this.log.append({
        success: false,
        errorMessage: 'Failed to get the result from Google Recaptcha Enterprise',
      });

      return false;
    }
  }

  private async verifyYandexSmartCaptcha(config: YandexSmartCaptchaConfig, captchaToken: string) {
    try {
      const result = await ky
        .post('https://smartcaptcha.yandexcloud.net/validate', {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: config.secretKey,
            token: captchaToken,
            ip: '', // Optional: can be added if client IP is available
          }),
        })
        .json();

      const responseGuard = z.object({
        status: z.string(),
        message: z.string().optional(),
      });

      const response = responseGuard.parse(result);

      const success = response.status === 'ok';

      this.log.append({
        success,
        message: response.message,
      });

      return success;
    } catch {
      this.log.append({
        success: false,
        errorMessage: 'Failed to get the result from Yandex SmartCaptcha',
      });

      return false;
    }
  }
}
