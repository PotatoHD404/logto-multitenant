/**
 * @fileoverview
 * Notification system for tenant invitation events.
 * Handles notifications for invitation sent, accepted, expired, and other events.
 */

import { ConnectorType, TemplateType } from '@logto/connector-kit';
import { TenantRole } from '@logto/schemas';

import type { ConnectorLibrary } from '#src/libraries/connector.js';
import type Queries from '#src/tenants/Queries.js';
import { unknownConsole } from '#src/utils/console.js';

/**
 * Get pending invitations that are about to expire (within 24 hours).
 */
async function getPendingExpiredInvitations(): Promise<
  Array<{
    id: string;
    invitee: string;
    inviterId: string;
    organizationId: string;
    expiresAt: number;
  }>
> {
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

  try {
    // This would query the database for invitations expiring soon
    // For now, return empty array as we don't have direct database access here
    return [];
  } catch (error) {
    unknownConsole.error('Failed to get pending expired invitations:', error);
    return [];
  }
}

/**
 * Process expired invitations and send notifications.
 */
async function processExpiredInvitations(
  tenantId: string,
  queries: Queries,
  connectorLibrary: ConnectorLibrary
): Promise<void> {
  const expiredInvitations = await getPendingExpiredInvitations();

  await Promise.all(
    expiredInvitations.map(async (invitation) => {
      try {
        // Get tenant and inviter details
        const tenant = await queries.tenants.findTenantSuspendStatusById(
          invitation.organizationId.replace(/^t-/, '')
        );
        const inviter = await queries.users.findUserById(invitation.inviterId);

        if (tenant && inviter) {
          await sendNotificationToInviter(
            {
              inviterEmail: inviter.primaryEmail ?? undefined,
              type: 'invitation_expired', // Assuming a fixed type for this context
              tenantName: `Tenant ${tenantId}`, // Use tenant ID as fallback name
              inviteeEmail: invitation.invitee,
              role: TenantRole.Collaborator, // Default role, should be determined from invitation
              accepterName: undefined, // No accepter for expired invitations
              accepterEmail: undefined, // No accepter for expired invitations
            },
            connectorLibrary
          );
        }
      } catch (error) {
        unknownConsole.error('Failed to process expired invitation:', invitation.id, error);
      }
    })
  );
}

/**
 * Send notification email to the inviter.
 */
async function sendNotificationToInviter(
  context: {
    inviterEmail?: string;
    type: string;
    tenantName: string;
    inviteeEmail: string;
    role: TenantRole;
    accepterName?: string;
    accepterEmail?: string;
  },
  connectorLibrary: ConnectorLibrary
): Promise<void> {
  const { inviterEmail, type, tenantName, inviteeEmail, role, accepterName, accepterEmail } =
    context;

  if (!inviterEmail) {
    return; // Skip if no inviter email
  }

  try {
    const emailConnector = await connectorLibrary.getMessageConnector(ConnectorType.Email);

    const subject = getNotificationSubject(type as any, tenantName); // Assuming type is string here
    const content = getNotificationContent(context);

    await emailConnector.sendMessage({
      to: inviterEmail,
      type: TemplateType.Generic,
      payload: {
        subject,
        content,
        tenantName,
        inviteeEmail,
        role: role === TenantRole.Admin ? 'Administrator' : 'Collaborator',
        accepterName,
        accepterEmail,
      },
    });
  } catch (error) {
    // Log error but don't throw to avoid breaking the main flow
    unknownConsole.error('Failed to send invitation notification:', error);
  }
}

/**
 * Log notification event for audit purposes.
 */
async function logNotificationEvent(context: {
  type: string;
  tenantId: string;
  invitationId: string;
  inviteeEmail: string;
  timestamp: number;
}): Promise<void> {
  try {
    // This would typically log to a notifications table or audit log
    // For now, we'll just log to console in development
    if (process.env.NODE_ENV === 'development') {
      unknownConsole.info('Invitation notification event:', {
        type: context.type,
        tenantId: context.tenantId,
        invitationId: context.invitationId,
        inviteeEmail: context.inviteeEmail,
        timestamp: new Date(context.timestamp).toISOString(),
      });
    }
  } catch (error) {
    unknownConsole.error('Failed to log notification event:', error);
  }
}

/**
 * Get notification subject based on event type.
 */
function getNotificationSubject(type: string, tenantName: string): string {
  switch (type) {
    case 'invitation_sent': {
      return `Invitation sent for ${tenantName}`;
    }
    case 'invitation_accepted': {
      return `Invitation accepted for ${tenantName}`;
    }
    case 'invitation_expired': {
      return `Invitation expired for ${tenantName}`;
    }
    case 'invitation_revoked': {
      return `Invitation revoked for ${tenantName}`;
    }
    case 'invitation_resent': {
      return `Invitation resent for ${tenantName}`;
    }
    default: {
      return `Notification for ${tenantName}`;
    }
  }
}

/**
 * Get notification content based on event type.
 */
function getNotificationContent(context: {
  type: string;
  tenantName: string;
  inviteeEmail: string;
  role: TenantRole;
  accepterName?: string;
  accepterEmail?: string;
}): string {
  const { type, tenantName, inviteeEmail, role, accepterName, accepterEmail } = context;
  const roleText = role === TenantRole.Admin ? 'Administrator' : 'Collaborator';

  switch (type) {
    case 'invitation_sent': {
      return `You have successfully sent an invitation to ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
    }

    case 'invitation_accepted': {
      const accepterInfo = accepterName ? `${accepterName} (${accepterEmail})` : accepterEmail;
      return `${accepterInfo} has accepted your invitation to join ${tenantName} as a ${roleText}.`;
    }

    case 'invitation_expired': {
      return `The invitation sent to ${inviteeEmail} to join ${tenantName} as a ${roleText} has expired.`;
    }

    case 'invitation_revoked': {
      return `You have revoked the invitation for ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
    }

    case 'invitation_resent': {
      return `You have resent the invitation to ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
    }
    default: {
      return `Notification for ${tenantName}`;
    }
  }
}
