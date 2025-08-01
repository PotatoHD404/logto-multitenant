import { useContext } from 'react';
import { Outlet } from 'react-router-dom';

import { logtoCloud, TenantSettingsTabs } from '@/consts';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import CardTitle from '@/ds-components/CardTitle';
import DynamicT from '@/ds-components/DynamicT';
import TabNav, { TabNavItem } from '@/ds-components/TabNav';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';

import DevTenantNotification from './DevTenantNotification';
import styles from './index.module.scss';

function TenantSettings() {
  const { isDevTenant } = useContext(TenantsContext);
  const {
    access: { canManageTenant },
  } = useCurrentTenantScopes();

  return (
    <div className={styles.container}>
      <CardTitle
        className={styles.cardTitle}
        title="tenants.title"
        subtitle="tenants.description"
        learnMoreLink={{ href: logtoCloud }}
      />
      {isDevTenant && <DevTenantNotification className={styles.notification} />}
      <TabNav className={styles.tabs}>
        <TabNavItem href={`/tenant-settings/${TenantSettingsTabs.Settings}`}>
          <DynamicT forKey="tenants.tabs.settings" />
        </TabNavItem>
        <TabNavItem href={`/tenant-settings/${TenantSettingsTabs.Members}`}>
          <DynamicT forKey="tenants.tabs.members" />
        </TabNavItem>
        <TabNavItem href={`/tenant-settings/${TenantSettingsTabs.Domains}`}>
          <DynamicT forKey="tenants.tabs.domains" />
        </TabNavItem>
        {isCloud && !isDevTenant && canManageTenant && (
          <>
            <TabNavItem href={`/tenant-settings/${TenantSettingsTabs.Subscription}`}>
              <DynamicT forKey="tenants.tabs.subscription" />
            </TabNavItem>
            <TabNavItem href={`/tenant-settings/${TenantSettingsTabs.BillingHistory}`}>
              <DynamicT forKey="tenants.tabs.billing_history" />
            </TabNavItem>
          </>
        )}
      </TabNav>
      <Outlet />
    </div>
  );
}

export default TenantSettings;
