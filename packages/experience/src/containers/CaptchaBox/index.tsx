import { CaptchaType } from '@logto/schemas';
import { useContext } from 'react';

import CaptchaContext from '@/Providers/CaptchaContextProvider/CaptchaContext';

import styles from './index.module.scss';

const CaptchaBox = () => {
  const { captchaConfig, widgetRef, isCaptchaRequired } = useContext(CaptchaContext);

  // Currently only Turnstile and Yandex SmartCaptcha need a widget to be rendered
  if (!isCaptchaRequired || (captchaConfig?.type !== CaptchaType.Turnstile && captchaConfig?.type !== CaptchaType.YandexSmartCaptcha)) {
    return null;
  }

  return <div ref={widgetRef} className={styles.captchaBox} />;
};

export default CaptchaBox;
