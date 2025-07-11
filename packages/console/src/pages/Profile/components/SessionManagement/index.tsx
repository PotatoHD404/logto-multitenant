import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { format } from 'date-fns';

import FormCard from '@/components/FormCard';
import { adminTenantEndpoint, meApi } from '@/consts';
import { useStaticApi } from '@/hooks/use-api';
import { useConfirmModal } from '@/hooks/use-confirm-modal';
import Button from '@/ds-components/Button';
import Table from '@/ds-components/Table';
import type { Column } from '@/ds-components/Table/types';

import styles from './index.module.scss';

type SessionData = {
  id: string;
  sessionUid: string;
  deviceInfo?: {
    userAgent?: string;
    ip?: string;
  };
  createdAt: number;
  lastActiveAt?: number;
  expiresAt: number;
};

type SessionsResponse = {
  data: SessionData[];
  totalCount: number;
};

const pageSize = 20;

export default function SessionManagement() {
  const { t } = useTranslation(undefined, { keyPrefix: 'profile.session_management' });
  const api = useStaticApi({ prefixUrl: adminTenantEndpoint, resourceIndicator: meApi.indicator });
  const { show } = useConfirmModal();

  const { data: sessionsData, error, mutate } = useSWR<SessionsResponse>(
    `sessions?page=1&page_size=${pageSize}`,
    async (url) => api.get(url).json()
  );

  const sessions = sessionsData?.data ?? [];
  const isLoading = !sessionsData && !error;

  const handleRevokeSession = async (sessionUid: string) => {
    const [confirmed] = await show({
      ModalContent: 'Are you sure you want to revoke this session? This will sign out the device.',
      title: 'Revoke session',
      confirmButtonText: 'Revoke',
      confirmButtonType: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`sessions/${sessionUid}`);
      void mutate();
    } catch (error) {
      console.error('Failed to revoke session:', error);
    }
  };

  const handleRevokeAllSessions = async () => {
    const [confirmed] = await show({
      ModalContent: 'Are you sure you want to revoke all other sessions? This will sign out all other devices except the current one.',
      title: 'Revoke all other sessions',
      confirmButtonText: 'Revoke all other sessions',
      confirmButtonType: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      await api.delete('sessions', { 
        searchParams: { except_current: 'true' } 
      });
      void mutate();
    } catch (error) {
      console.error('Failed to revoke all sessions:', error);
    }
  };

  const formatDeviceInfo = (deviceInfo?: SessionData['deviceInfo']) => {
    if (!deviceInfo) return 'Unknown Device';
    
    const parts = [];
    if (deviceInfo.userAgent) {
      const ua = deviceInfo.userAgent;
      // Simple browser detection
      if (ua.includes('Chrome')) parts.push('Chrome');
      else if (ua.includes('Firefox')) parts.push('Firefox');
      else if (ua.includes('Safari')) parts.push('Safari');
      else if (ua.includes('Edge')) parts.push('Edge');
      else parts.push('Unknown Browser');
    }
    
    if (deviceInfo.ip) {
      parts.push(`IP: ${deviceInfo.ip}`);
    }
    
    return parts.join(' • ') || 'Unknown Device';
  };

  const columns: Column<SessionData>[] = [
    {
      title: 'Device',
      dataIndex: 'deviceInfo',
      key: 'device',
      render: (deviceInfo) => (
        <div className={styles.deviceInfo}>
          <div className={styles.deviceName}>{formatDeviceInfo(deviceInfo)}</div>
          {deviceInfo?.ip && (
            <div className={styles.deviceDetails}>
              {deviceInfo.ip}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Last Active',
      dataIndex: 'lastActiveAt',
      key: 'lastActive',
      render: (lastActiveAt, record) => (
        <div className={styles.timeInfo}>
          {lastActiveAt 
            ? format(new Date(lastActiveAt), 'MMM d, yyyy HH:mm')
            : format(new Date(record.createdAt), 'MMM d, yyyy HH:mm')
          }
        </div>
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      key: 'expires',
      render: (expiresAt) => (
        <div className={styles.timeInfo}>
          {format(new Date(expiresAt), 'MMM d, yyyy HH:mm')}
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => (
        <Button
          size="small"
          type="text"
          title="Revoke"
          onClick={() => handleRevokeSession(record.sessionUid)}
        />
      ),
    },
  ];

  return (
    <FormCard title="Session Management">
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.description}>
            Manage your active sessions and sign out from devices you no longer use.
          </p>
          <Button
            type="outline"
            size="small"
            title="Revoke all other sessions"
            onClick={handleRevokeAllSessions}
          />
        </div>
        
        <div className={styles.tableContainer}>
          <Table
            columns={columns}
            rowGroups={[{ key: 'sessions', data: sessions }]}
            rowIndexKey="id"
            isLoading={isLoading}
            placeholder={
              <div className={styles.empty}>
                <p>No active sessions</p>
                <p>You will see your active sessions here once you sign in on other devices.</p>
              </div>
            }
          />
        </div>
      </div>
    </FormCard>
  );
} 