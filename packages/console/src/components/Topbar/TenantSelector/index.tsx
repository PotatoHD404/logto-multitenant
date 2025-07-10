import { OrganizationInvitationStatus } from '@logto/schemas';
import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogto } from '@logto/react';

import KeyboardArrowDown from '@/assets/icons/keyboard-arrow-down.svg?react';
import PlusSign from '@/assets/icons/plus.svg?react';
import { type TenantResponse } from '@/cloud/types/router';
import CreateTenantModal from '@/components/CreateTenantModal';
import TenantEnvTag from '@/components/TenantEnvTag';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Divider from '@/ds-components/Divider';
import Dropdown from '@/ds-components/Dropdown';
import OverlayScrollbar from '@/ds-components/OverlayScrollbar';
import useUserDefaultTenantId from '@/hooks/use-user-default-tenant-id';
import useUserInvitations from '@/hooks/use-user-invitations';
import { onKeyDownHandler } from '@/utils/a11y';
import { refreshTokensForTenant } from '@/utils/tenant-token-refresh';

import TenantDropdownItem from './TenantDropdownItem';
import TenantInvitationDropdownItem from './TenantInvitationDropdownItem';
import styles from './index.module.scss';

export default function TenantSelector() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const {
    tenants,
    prependTenant,
    currentTenant: currentTenantInfo,
    currentTenantId,
    navigateTenant,
  } = useContext(TenantsContext);
  const { data: pendingInvitations } = useUserInvitations(OrganizationInvitationStatus.Pending);
  const logtoMethods = useLogto();

  const anchorRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateTenantModal, setShowCreateTenantModal] = useState(false);
  const { updateDefaultTenantId } = useUserDefaultTenantId();

  if (tenants.length === 0 || !currentTenantInfo) {
    return null;
  }

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={0}
        className={styles.currentTenantCard}
        role="button"
        onKeyDown={onKeyDownHandler(() => {
          setShowDropdown(true);
        })}
        onClick={() => {
          setShowDropdown(true);
        }}
      >
        <div className={styles.name}>{currentTenantInfo.name}</div>
        {isCloud && <TenantEnvTag tag={currentTenantInfo.tag} />}
        {!isCloud && <div className={styles.tenantId}>ID: {currentTenantId}</div>}
        {Boolean(pendingInvitations?.length) && <div className={styles.redDot} />}
        <KeyboardArrowDown className={styles.arrowIcon} />
      </div>
      <Dropdown
        hasOverflowContent
        className={styles.dropdown}
        anchorRef={anchorRef}
        isOpen={showDropdown}
        horizontalAlign="start"
        onClose={() => {
          setShowDropdown(false);
        }}
      >
        <OverlayScrollbar className={styles.scrollableContent}>
          {tenants.map((tenantData) => (
            <TenantDropdownItem
              key={tenantData.id}
              tenantData={tenantData}
              isSelected={tenantData.id === currentTenantId}
              onClick={async () => {
                // Navigate to the new tenant
                navigateTenant(tenantData.id);
                
                // Update default tenant ID
                void updateDefaultTenantId(tenantData.id);
                
                // Refresh tokens for the new tenant
                const refreshResult = await refreshTokensForTenant(
                  tenantData.id,
                  isCloud,
                  logtoMethods
                );
                
                if (!refreshResult.success) {
                  console.warn('Failed to refresh tokens for tenant:', tenantData.id, refreshResult.error);
                }
                
                setShowDropdown(false);
              }}
            />
          ))}
          {pendingInvitations?.map((invitation) => (
            <TenantInvitationDropdownItem key={invitation.id} data={invitation} />
          ))}
        </OverlayScrollbar>
        <Divider />
        <button
          tabIndex={0}
          className={styles.createTenantButton}
          onClick={() => {
            setShowCreateTenantModal(true);
          }}
          onKeyDown={onKeyDownHandler(() => {
            setShowCreateTenantModal(true);
          })}
        >
          <div>{t('cloud.tenant.create_tenant')}</div>
          <PlusSign />
        </button>
      </Dropdown>
      <CreateTenantModal
        isOpen={showCreateTenantModal}
        onClose={async (tenant?: TenantResponse) => {
          setShowCreateTenantModal(false);
          if (tenant) {
            prependTenant(tenant);
            navigateTenant(tenant.id);
          }
        }}
      />
    </>
  );
}
