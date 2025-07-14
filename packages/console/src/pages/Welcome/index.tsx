import { useLogto } from '@logto/react';
import { defaultTenantId } from '@logto/schemas';
import classNames from 'classnames';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Logo from '@/assets/images/logo.svg?react';
import AppLoading from '@/components/AppLoading';
import { adminTenantEndpoint, meApi } from '@/consts';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Button from '@/ds-components/Button';
import { useStaticApi } from '@/hooks/use-api';
import useRedirectUri from '@/hooks/use-redirect-uri';
import useTenantPathname from '@/hooks/use-tenant-pathname';
import useTheme from '@/hooks/use-theme';

import styles from './index.module.scss';

function Welcome() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { isAuthenticated, signIn } = useLogto();
  const { navigateTenant, isInitComplete, tenants } = useContext(TenantsContext);
  const theme = useTheme();
  const redirectUri = useRedirectUri();
  const [hasActiveUsers, setHasActiveUsers] = useState<boolean>();
  const [checkingUsers, setCheckingUsers] = useState(true);

  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  useEffect(() => {
    // Check if there are active users
    const checkActiveUsers = async () => {
      try {
        const response = await api.get('api/status').json<{ hasActiveUsers: boolean }>();
        setHasActiveUsers(response.hasActiveUsers);
      } catch (error) {
        console.error('Failed to check active users:', error);
        setHasActiveUsers(false);
      } finally {
        setCheckingUsers(false);
      }
    };

    void checkActiveUsers();
  }, [api]);

  useEffect(() => {
    // If authenticated, navigate away from welcome page
    if (isAuthenticated) {
      if (isCloud) {
        // For cloud, need to wait for tenants to be loaded
        if (isInitComplete) {
          navigate('/');
        }
      } else {
        // For OSS, navigate to the first available tenant or default
        const firstTenant = tenants[0];
        const tenantIdToNavigate = firstTenant?.id || defaultTenantId;
        navigateTenant(tenantIdToNavigate);
      }
    }
  }, [isAuthenticated, isInitComplete, navigate, navigateTenant, tenants]);

  // For cloud: if authenticated but tenants still loading, show loading
  if (isCloud && isAuthenticated && !isInitComplete) {
    return <AppLoading />;
  }

  // If checking users, show loading
  if (checkingUsers) {
    return <AppLoading />;
  }

  // If there are active users and we're not authenticated, redirect to sign in
  if (hasActiveUsers && !isAuthenticated) {
    void signIn(redirectUri.href);
    return <AppLoading />;
  }

  // Only show welcome form for unauthenticated users when no active users exist
  return (
    <div className={classNames(styles.container, styles[theme])}>
      <div className={styles.header}>
        <Logo className={styles.logo} />
      </div>
      <main>
        <div className={styles.placeholderTop} />
        <div className={styles.content}>
          <div className={styles.title}>{t('welcome.title')}</div>
          <div className={styles.description}>{t('welcome.description')}</div>
          <Button
            className={styles.button}
            size="large"
            type="branding"
            title="welcome.create_account"
            onClick={() => {
              void signIn(redirectUri.href);
            }}
          />
        </div>
        <div className={styles.placeholderBottom} />
      </main>
    </div>
  );
}

export default Welcome;
