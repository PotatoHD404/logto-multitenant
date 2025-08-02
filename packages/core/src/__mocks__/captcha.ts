import { CaptchaType, type CaptchaProvider } from '@logto/schemas';

export const mockCaptchaProvider: CaptchaProvider = {
  id: 'captcha_provider_id',
  tenantId: 'fake_tenant',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  config: {
    type: CaptchaType.Turnstile,
    siteKey: 'captcha_site_key',
    secretKey: 'captcha_secret_key',
  },
};

export const mockYandexSmartCaptchaProvider: CaptchaProvider = {
  id: 'yandex_captcha_provider_id',
  tenantId: 'fake_tenant',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  config: {
    type: CaptchaType.YandexSmartCaptcha,
    siteKey: 'yandex_site_key',
    secretKey: 'yandex_secret_key',
  },
};
