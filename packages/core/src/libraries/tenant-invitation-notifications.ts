/**
 * @fileoverview
 * Notification system for tenant invitation events.
 * Handles notifications for invitation sent, accepted, expired, and other events.
 */

import { ConnectorType, TemplateType } from '@logto/connector-kit';
import { TenantRole } from '@logto/schemas';

import type { ConnectorLibrary } from '#src/libraries/connector.js';
import type Queries from '#src/tenants/Queries.js';

export enum InvitationNotificationType {
  InvitationSent = 'invitation_sent',
  InvitationAccepted = 'invitation_accepted',
  InvitationExpired = 'invitation_expired',
  InvitationRevoked = 'invitation_revoked',
  InvitationResent = 'invitation_resent',
}

export type InvitationNotificationContext = {
  type: InvitationNotificationType;
  tenantId: string;
  tenantName: string;
  invitationId: string;
  inviteeEmail: string;
  inviterEmail?: string;
  inviterName?: string;
  accepterEmail?: string;
  accepterName?: string;
  role: TenantRole;
  timestamp: number;
};

export class TenantInvitationNotificationLibrary {
  constructor(
    private readonly tenantId: string,
    private readonly queries: Queries,
    private readonly connectorLibrary: ConnectorLibrary
  ) {}

  /**
   * Send notification for invitation sent event.
   */
  async notifyInvitationSent(
    context: Omit<InvitationNotificationContext, 'type' | 'timestamp'>
  ): Promise<void> {
    const notificationContext: InvitationNotificationContext = {
      ...context,
      type: InvitationNotificationType.InvitationSent,
      timestamp: Date.now(),
    };

    await this.sendNotificationToInviter(notificationContext);
    await this.logNotificationEvent(notificationContext);
  }

  /**
   * Send notification for invitation accepted event.
   */
  async notifyInvitationAccepted(
    context: Omit<InvitationNotificationContext, 'type' | 'timestamp'>
  ): Promise<void> {
    const notificationContext: InvitationNotificationContext = {
      ...context,
      type: InvitationNotificationType.InvitationAccepted,
      timestamp: Date.now(),
    };

    await this.sendNotificationToInviter(notificationContext);
    await this.logNotificationEvent(notificationContext);
  }

  /**
   * Send notification for invitation expired event.
   */
  async notifyInvitationExpired(
    context: Omit<InvitationNotificationContext, 'type' | 'timestamp'>
  ): Promise<void> {
    const notificationContext: InvitationNotificationContext = {
      ...context,
      type: InvitationNotificationType.InvitationExpired,
      timestamp: Date.now(),
    };

    await this.sendNotificationToInviter(notificationContext);
    await this.logNotificationEvent(notificationContext);
  }

  /**
   * Send notification for invitation revoked event.
   */
  async notifyInvitationRevoked(
    context: Omit<InvitationNotificationContext, 'type' | 'timestamp'>
  ): Promise<void> {
    const notificationContext: InvitationNotificationContext = {
      ...context,
      type: InvitationNotificationType.InvitationRevoked,
      timestamp: Date.now(),
    };

    await this.sendNotificationToInviter(notificationContext);
    await this.logNotificationEvent(notificationContext);
  }

  /**
   * Send notification for invitation resent event.
   */
  async notifyInvitationResent(
    context: Omit<InvitationNotificationContext, 'type' | 'timestamp'>
  ): Promise<void> {
    const notificationContext: InvitationNotificationContext = {
      ...context,
      type: InvitationNotificationType.InvitationResent,
      timestamp: Date.now(),
    };

    await this.sendNotificationToInviter(notificationContext);
    await this.logNotificationEvent(notificationContext);
  }

  /**
   * Send notification email to the inviter.
   */
  private async sendNotificationToInviter(context: InvitationNotificationContext): Promise<void> {
    const { inviterEmail, type, tenantName, inviteeEmail, role, accepterName, accepterEmail } =
      context;

    if (!inviterEmail) {
      return; // Skip if no inviter email
    }

    try {
      const emailConnector = await this.connectorLibrary.getMessageConnector(ConnectorType.Email);

      const subject = this.getNotificationSubject(type, tenantName);
      const content = this.getNotificationContent(context);

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
      console.error('Failed to send invitation notification:', error);
    }
  }

  /**
   * Log notification event for audit purposes.
   */
  private async logNotificationEvent(context: InvitationNotificationContext): Promise<void> {
    try {
      // This would typically log to a notifications table or audit log
      // For now, we'll just log to console in development
      if (process.env.NODE_ENV === 'development') {
        console.log('Invitation notification event:', {
          type: context.type,
          tenantId: context.tenantId,
          invitationId: context.invitationId,
          inviteeEmail: context.inviteeEmail,
          timestamp: new Date(context.timestamp).toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to log notification event:', error);
    }
  }

  /**
   * Get notification subject based on event type.
   */
  private getNotificationSubject(type: InvitationNotificationType, tenantName: string): string {
    switch (type) {
      case InvitationNotificationType.InvitationSent: {
        return `Invitation sent for ${tenantName}`;
      }
      case InvitationNotificationType.InvitationAccepted: {
        return `Invitation accepted for ${tenantName}`;
      }
      case InvitationNotificationType.InvitationExpired: {
        return `Invitation expired for ${tenantName}`;
      }
      case InvitationNotificationType.InvitationRevoked: {
        return `Invitation revoked for ${tenantName}`;
      }
      case InvitationNotificationType.InvitationResent: {
        return `Invitation resent for ${tenantName}`;
      }
      default: {
        return `Invitation update for ${tenantName}`;
      }
    }
  }

  /**
   * Get notification content based on event type.
   */
  private getNotificationContent(context: InvitationNotificationContext): string {
    const { type, tenantName, inviteeEmail, role, accepterName, accepterEmail } = context;
    const roleText = role === TenantRole.Admin ? 'Administrator' : 'Collaborator';

    switch (type) {
      case InvitationNotificationType.InvitationSent: {
        return `You have successfully sent an invitation to ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
      }

      case InvitationNotificationType.InvitationAccepted: {
        const accepterInfo = accepterName ? `${accepterName} (${accepterEmail})` : accepterEmail;
        return `${accepterInfo} has accepted your invitation to join ${tenantName} as a ${roleText}.`;
      }

      case InvitationNotificationType.InvitationExpired: {
        return `The invitation sent to ${inviteeEmail} to join ${tenantName} as a ${roleText} has expired.`;
      }

      case InvitationNotificationType.InvitationRevoked: {
        return `You have revoked the invitation for ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
      }

      case InvitationNotificationType.InvitationResent: {
        return `You have resent the invitation to ${inviteeEmail} to join ${tenantName} as a ${roleText}.`;
      }

      default: {
        return `There has been an update to the invitation for ${inviteeEmail} to join ${tenantName}.`;
      }
    }
  }

  /**
   * Get pending invitations that are about to expire (within 24 hours).
   */
  async getPendingExpiredInvitations(): Promise<
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
      console.error('Failed to get pending expired invitations:', error);
      return [];
    }
  }

  /**
   * Process expired invitations and send notifications.
   */
  async processExpiredInvitations(): Promise<void> {
    const expiredInvitations = await this.getPendingExpiredInvitations();

    for (const invitation of expiredInvitations) {
      try {
        // Get tenant and inviter details
        const tenantId = invitation.organizationId.replace(/^t-/, '');
        const tenant = await this.queries.tenants.findTenantSuspendStatusById(tenantId);
        const inviter = await this.queries.users.findUserById(invitation.inviterId);

        if (tenant && inviter) {
          await this.notifyInvitationExpired({
            tenantId,
            tenantName: `Tenant ${tenantId}`, // Use tenant ID as fallback name
            invitationId: invitation.id,
            inviteeEmail: invitation.invitee,
            inviterEmail: inviter.primaryEmail ?? undefined,
            inviterName: inviter.name ?? undefined,
            role: TenantRole.Collaborator, // Default role, should be determined from invitation
          });
        }
      } catch (error) {
        console.error('Failed to process expired invitation:', invitation.id, error);
      }
    }
  }
}

/**
 * Create a tenant invitation notification library instance.
 */
export const createTenantInvitationNotificationLibrary = (
  tenantId: string,
  queries: Queries,
  connectorLibrary: ConnectorLibrary
) => new TenantInvitationNotificationLibrary(tenantId, queries, connectorLibrary);
