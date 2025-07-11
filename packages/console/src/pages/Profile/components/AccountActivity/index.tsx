import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { format } from 'date-fns';

import FormCard from '@/components/FormCard';
import { meApi } from '@/consts';
import { useStaticApi } from '@/hooks/use-api';
import Table from '@/ds-components/Table';
import type { Column } from '@/ds-components/Table/types';
import { buildUrl } from '@/utils/url';

import styles from './index.module.scss';

type ActivityLog = {
  id: string;
  key: string;
  payload: {
    ip?: string;
    userAgent?: string;
    result?: string;
    error?: Record<string, unknown>;
    interactionEvent?: string;
    applicationId?: string;
  };
  createdAt: string;
};

type ActivityResponse = {
  data: ActivityLog[];
  totalCount: number;
};

const pageSize = 20;

export default function AccountActivity() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console.profile.account_activity' });
  const api = useStaticApi({ prefixUrl: meApi.indicator, resourceIndicator: 'me' });

  const { data, error, isLoading } = useSWR<ActivityResponse>(
    buildUrl('activities', {
      page: '1',
      page_size: String(pageSize),
    }),
    async (url) => api.get(url).json()
  );

  const activities = data?.data ?? [];

  const getActivityTitle = (key: string) => {
    // Map activity keys to human-readable titles
    const activityTitles: Record<string, string> = {
      'Interaction.Create': 'Session started',
      'Interaction.End': 'Session ended',
      'Interaction.SignIn.Submit': 'Sign in completed',
      'Interaction.Register.Submit': 'Registration completed',
      'Interaction.ForgotPassword.Submit': 'Password reset completed',
      'Interaction.SignIn.Profile.Update': 'Profile updated during sign in',
      'Interaction.Register.Profile.Update': 'Profile updated during registration',
      'Interaction.ForgotPassword.Profile.Update': 'Profile updated during password reset',
      'Interaction.SignIn.Identifier.Password.Submit': 'Password sign in',
      'Interaction.SignIn.Identifier.VerificationCode.Submit': 'Verification code sign in',
      'Interaction.SignIn.Identifier.Social.Submit': 'Social sign in',
      'Interaction.SignIn.Identifier.SingleSignOn.Submit': 'SSO sign in',
      'Interaction.Register.Identifier.VerificationCode.Submit': 'Verification code registration',
      'Interaction.ForgotPassword.Identifier.VerificationCode.Submit': 'Password reset verification',
    };

    return activityTitles[key] || key;
  };

  const getActivityStatus = (log: ActivityLog) => {
    if (log.payload.error) {
      return <span className={styles.statusError}>Failed</span>;
    }
    if (log.payload.result === 'Success') {
      return <span className={styles.statusSuccess}>Success</span>;
    }
    return <span className={styles.statusNeutral}>Pending</span>;
  };

  const columns: Column<ActivityLog>[] = [
    {
      title: 'Activity',
      dataIndex: 'key',
      colSpan: 5,
      render: (log) => (
        <div className={styles.activityCell}>
          <div className={styles.activityTitle}>{getActivityTitle(log.key)}</div>
          <div className={styles.activityMeta}>
            {log.payload.ip && <span>IP Address: {log.payload.ip}</span>}
            {log.payload.userAgent && (
              <span className={styles.userAgent}>
                {log.payload.userAgent.split(' ')[0] || 'Unknown Browser'}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      colSpan: 2,
      render: (log) => getActivityStatus(log),
    },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      colSpan: 3,
      render: (log) => (
        <div className={styles.timeCell}>
          <div>{format(new Date(log.createdAt), 'MMM dd, yyyy')}</div>
          <div className={styles.timeSecondary}>
            {format(new Date(log.createdAt), 'HH:mm:ss')}
          </div>
        </div>
      ),
    },
  ];

  const content = error ? (
    <div className={styles.error}>
      Error loading activities. Please try again.
    </div>
  ) : (
    <div className={styles.tableContainer}>
      <Table
        columns={columns}
        data={activities}
        isLoading={isLoading}
        placeholder={
          <div className={styles.emptyState}>
            <div>No activities found</div>
            <div className={styles.emptyStateDescription}>
              Your account activities will appear here once you start using the system.
            </div>
          </div>
        }
        pagination={{
          page: 1,
          pageSize,
          totalCount: data?.totalCount ?? 0,
          onChange: () => {
            // TODO: Implement pagination if needed
          },
        }}
      />
    </div>
  );

  return (
    <FormCard title="Account Activity" description="View recent activities and actions performed on your account.">
      {content}
    </FormCard>
  );
} 