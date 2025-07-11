/**
 * @fileoverview
 * Component for handling tenant invitation acceptance in local OSS environments.
 * This component manages the invitation acceptance flow for tenant-specific invitations.
 */

import { useLogto } from '@logto/react';
import { TenantRole } from '@logto/schemas';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';

import AppError from '@/components/AppError';
import AppLoading from '@/components/AppLoading';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useApi, { useAdminApi } from '@/hooks/use-api';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

import SwitchAccount from './SwitchAccount';

type InvitationDetails = {
  id: string;
  tenantId: string;
  tenantName?: string;
  inviterName?: string;
  role: TenantRole;
  email: string;
  status: string;
  expiresAt?: number;
  createdAt: number;
};

function LocalOssInvitationHandler() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { signIn, getIdTokenClaims } = useLogto();
  const redirectUri = useRedirectUri();
  const { invitationId = '' } = useParams();
  const api = useApi();
  const adminApi = useAdminApi();
  const { navigateTenant, resetTenants } = useContext(TenantsContext);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);

  // Fetch invitation details
  useEffect(() => {
    if (!invitationId) {
      setError('Invalid invitation ID');
      setIsLoading(false);
      return;
    }

    const fetchInvitation = async () => {
      try {
        const invitationData = await api.get(`api/invitation/${invitationId}`).json<InvitationDetails>();
        setInvitation(invitationData);
      } catch (error) {
        console.error('Failed to fetch invitation:', error);
        setError('invitation.invitation_not_found');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchInvitation();
  }, [invitationId, api]);

  // Auto-accept invitation if user is authenticated and invitation is valid
  useEffect(() => {
    if (!invitation || isAccepting) {
      return;
    }

    const acceptInvitation = async () => {
      setIsAccepting(true);
      try {
        const claims = await getIdTokenClaims();
        const userEmail = claims?.email;

        if (!userEmail) {
          setError('User email not found');
          return;
        }

        // Accept the invitation
        const result = await api.post('api/invitation/accept', {
          json: {
            invitationId: invitation.id,
            email: userEmail,
          },
        }).json<{ success: boolean; tenantId: string; role: TenantRole }>();

        if (result.success) {
          toast.success(t('invitation.invitation_accepted'));
          
          // Refresh tenant list and navigate to the new tenant
          const tenants = await adminApi.get('api/tenants').json();
          resetTenants(tenants);
          navigateTenant(result.tenantId);
        } else {
          setError('invitation.acceptance_failed');
        }
      } catch (error) {
        console.error('Failed to accept invitation:', error);
        setError('invitation.acceptance_failed');
      } finally {
        setIsAccepting(false);
      }
    };

    void acceptInvitation();
  }, [invitation, isAccepting, getIdTokenClaims, api, navigateTenant, resetTenants, t]);

  if (isLoading) {
    return <AppLoading />;
  }

  if (error === 'invitation.invitation_not_found') {
    return <AppError errorMessage={t('invitation.invitation_not_found')} />;
  }

  if (error === 'User email not found') {
    return (
      <SwitchAccount
        onClickSwitch={() => {
          saveRedirect();
          void signIn(redirectUri.href);
        }}
      />
    );
  }

  if (error) {
    return <AppError errorMessage={t(error)} />;
  }

  if (!invitation) {
    return <AppError errorMessage={t('invitation.invitation_not_found')} />;
  }

  if (invitation.status !== 'Pending') {
    return <AppError errorMessage={t('invitation.invalid_invitation_status')} />;
  }

  if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
    return <AppError errorMessage={t('invitation.expired')} />;
  }

  // Show accepting state
  if (isAccepting) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100vh',
        gap: '16px'
      }}>
        <AppLoading />
        <p>{t('invitation.accepting_invitation')}</p>
        <p>{t('invitation.joining_tenant', { tenantName: invitation.tenantName || invitation.tenantId })}</p>
      </div>
    );
  }

  return <AppLoading />;
}

export default LocalOssInvitationHandler; 