import { z } from 'zod';

export enum CaptchaType {
  RecaptchaEnterprise = 'RecaptchaEnterprise',
  Turnstile = 'Turnstile',
  YandexSmartCaptcha = 'YandexSmartCaptcha',
}

export const turnstileConfigGuard = z.object({
  type: z.literal(CaptchaType.Turnstile),
  siteKey: z.string(),
  secretKey: z.string(),
});

export type TurnstileConfig = z.infer<typeof turnstileConfigGuard>;

export const recaptchaEnterpriseConfigGuard = z.object({
  type: z.literal(CaptchaType.RecaptchaEnterprise),
  siteKey: z.string(),
  secretKey: z.string(),
  projectId: z.string(),
});

export type RecaptchaEnterpriseConfig = z.infer<typeof recaptchaEnterpriseConfigGuard>;

export const yandexSmartCaptchaConfigGuard = z.object({
  type: z.literal(CaptchaType.YandexSmartCaptcha),
  siteKey: z.string(),
  secretKey: z.string(),
});

export type YandexSmartCaptchaConfig = z.infer<typeof yandexSmartCaptchaConfigGuard>;

export const captchaConfigGuard = z.discriminatedUnion('type', [
  turnstileConfigGuard,
  recaptchaEnterpriseConfigGuard,
  yandexSmartCaptchaConfigGuard,
]);

export type CaptchaConfig = z.infer<typeof captchaConfigGuard>;
