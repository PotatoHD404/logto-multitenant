import { CaptchaType } from '@logto/schemas';

import { type SignInExperienceResponse } from '@/types';

export const getScript = (config: SignInExperienceResponse['captchaConfig']) => {
  // Not supposed to happen
  if (!config) {
    throw new Error('Captcha config is not found');
  }

  if (config.type === CaptchaType.Turnstile) {
    return `https://challenges.cloudflare.com/turnstile/v0/api.js`;
  }

  if (config.type === CaptchaType.YandexSmartCaptcha) {
    return `https://smartcaptcha.yandexcloud.net/captcha.js`;
  }

  return `https://www.google.com/recaptcha/enterprise.js?render=${config.siteKey}`;
};
