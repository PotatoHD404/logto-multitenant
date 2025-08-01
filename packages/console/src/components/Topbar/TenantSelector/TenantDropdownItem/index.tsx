import { TenantTag } from '@logto/schemas';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import Tick from '@/assets/icons/tick.svg?react';
import { type TenantResponse } from '@/cloud/types/router';
import { RegionFlag } from '@/components/Region';
import SkuName from '@/components/SkuName';
import { isCloud } from '@/consts/env';
import { DropdownItem } from '@/ds-components/Dropdown';

import TenantStatusTag from './TenantStatusTag';
import styles from './index.module.scss';

type Props = {
  readonly tenantData: TenantResponse;
  readonly isSelected: boolean;
  readonly onClick: () => void;
};

function TenantDropdownItem({ tenantData, isSelected, onClick }: Props) {
  const {
    name,
    tag,
    regionName,
    subscription,
  } = tenantData;
  
  // Defensive check for subscription field
  const { planId, isEnterprisePlan } = subscription || { planId: 'development', isEnterprisePlan: false };
  
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  return (
    <DropdownItem className={styles.item} onClick={onClick}>
      <div className={styles.info}>
        <div className={styles.meta}>
          <div className={styles.name}>{name}</div>
          <TenantStatusTag tenantData={tenantData} className={styles.statusTag} />
        </div>
        <div className={styles.metadata}>
          {isCloud && (
            <div className={styles.region}>
              <RegionFlag regionName={regionName} width={12} />
              <span>{regionName}</span>
            </div>
          )}
          {isCloud && <span>{t(`tenants.full_env_tag.${tag}`)}</span>}
          {isCloud && tag !== TenantTag.Development && <SkuName skuId={planId} />}
          {!isCloud && <span className={styles.tenantId}>ID: {tenantData.id}</span>}
        </div>
      </div>
      <Tick className={classNames(styles.checkIcon, isSelected && styles.visible)} />
    </DropdownItem>
  );
}

export default TenantDropdownItem;
