import { type TenantResponse } from '@/cloud/types/router';
import DynamicT from '@/ds-components/DynamicT';
import Tag from '@/ds-components/Tag';
import { isPaidPlan } from '@/utils/subscription';

type Props = {
  readonly tenantData: TenantResponse;
  readonly className?: string;
};

function TenantStatusTag({ tenantData, className }: Props) {
  const { usage, quota, openInvoices, isSuspended, subscription } = tenantData;

  // Defensive checks for all fields that might be undefined in OSS
  const { planId, isEnterprisePlan } = subscription || {
    planId: 'development',
    isEnterprisePlan: false,
  };
  const safeUsage = usage || { activeUsers: 0, tokenUsage: 0 };
  const safeQuota = quota || { mauLimit: null, tokenLimit: null };
  const safeOpenInvoices = openInvoices || [];

  /**
   * Tenant status priority:
   * 1. suspend
   * 2. overdue
   * 3. mau exceeded
   * 4. token exceeded
   */

  if (isSuspended) {
    return (
      <Tag className={className}>
        <DynamicT forKey="user_details.suspended" />
      </Tag>
    );
  }

  if (safeOpenInvoices.length > 0) {
    return (
      <Tag className={className}>
        <DynamicT forKey="tenants.status.overdue" />
      </Tag>
    );
  }

  const isPaidTenant = isPaidPlan(planId, isEnterprisePlan);

  const { activeUsers, tokenUsage } = safeUsage;

  const { mauLimit, tokenLimit } = safeQuota;

  const isMauExceeded = mauLimit !== null && activeUsers >= mauLimit;
  const isTokenExceeded = tokenLimit !== null && !isPaidTenant && tokenUsage >= tokenLimit;

  if (isMauExceeded) {
    return (
      <Tag className={className}>
        <DynamicT forKey="tenants.status.mau_exceeded" />
      </Tag>
    );
  }

  if (isTokenExceeded) {
    return (
      <Tag className={className}>
        <DynamicT forKey="tenants.status.token_exceeded" />
      </Tag>
    );
  }

  return null;
}

export default TenantStatusTag;
