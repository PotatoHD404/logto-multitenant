import { useContext } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Region, { getRegionDisplayName } from '@/components/Region';
import { trustAndSecurityLink } from '@/consts';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import TextLink from '@/ds-components/TextLink';

import styles from './index.module.scss';

function TenantRegion() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { currentTenant } = useContext(TenantsContext);
  const regionName = currentTenant?.regionName;

  // Don't show region information for local development
  if (!isCloud || !regionName) {
    return null;
  }

  return (
    <div className={styles.container}>
      <Region className={styles.region} regionName={regionName} />
      <div className={styles.regionTip}>
        <Trans
          components={{
            a: <TextLink targetBlank="noopener" href={trustAndSecurityLink} />,
          }}
        >
          {t('tenants.settings.tenant_region_tip', { region: getRegionDisplayName(regionName) })}
        </Trans>
      </div>
    </div>
  );
}

export default TenantRegion;
