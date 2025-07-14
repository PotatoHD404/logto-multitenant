/**
 * @fileoverview
 * Library for handling tenant-specific invitation emails.
 * This library provides functionality to send invitation emails with proper tenant context.
 */

import { ConnectorType, TemplateType } from '@logto/connector-kit';
import { TenantRole } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';

import RequestError from '#src/errors/RequestError/index.js';
import type { ConnectorLibrary } from '#src/libraries/connector.js';
import type Queries from '#src/tenants/Queries.js';

export type TenantInvitationEmailContext = {
  tenantId: string;
  tenantName: string;
  inviterName?: string;
  inviteeEmail: string;
  role: TenantRole;
  invitationUrl: string;
  expiresAt: string;
};

export class TenantInvitationEmailLibrary {
  constructor(
    private readonly tenantId: string,
    private readonly queries: Queries,
    private readonly connectorLibrary: ConnectorLibrary
  ) {}

  /**
   * Send a tenant invitation email to the specified email address.
   */
  async sendTenantInvitationEmail(context: TenantInvitationEmailContext): Promise<void> {
    const { inviteeEmail, tenantName, inviterName, role, invitationUrl, expiresAt } = context;

    try {
      // Get email connector
      const emailConnector = await this.connectorLibrary.getMessageConnector(ConnectorType.Email);

      // Prepare email template data
      const templateData = {
        tenantName,
        inviterName: inviterName || 'Someone',
        role: role === TenantRole.Admin ? 'Administrator' : 'Collaborator',
        invitationUrl,
        expiresAt,
      };

      // Send email
      await emailConnector.sendMessage({
        to: inviteeEmail,
        type: TemplateType.OrganizationInvitation,
        payload: {
          ...templateData,
          subject: `You've been invited to join ${tenantName}`,
        },
      });
    } catch (error) {
      if (error instanceof RequestError) {
        throw error;
      }
      throw new RequestError({
        code: 'connector.not_found',
        status: 500,
        data: { email: inviteeEmail },
      });
    }
  }

  /**
   * Generate an invitation URL for the tenant.
   */
  generateInvitationUrl(invitationId: string): string {
    // This would typically be configured based on the tenant's domain
    // For now, use a default pattern
    return `${process.env.LOGTO_ENDPOINT || 'http://localhost:3001'}/invitation/${invitationId}`;
  }

  /**
   * Create a magic link for invitation acceptance.
   * TODO: Implement proper magic link system
   */
  async createInvitationMagicLink(invitationId: string, email: string): Promise<string> {
    const token = generateStandardId();

    // For now, just return the invitation URL with a token
    // In a full implementation, this would store the token in a database
    return `${this.generateInvitationUrl(invitationId)}?token=${token}`;
  }
}

/**
 * Create a tenant invitation email library instance.
 */
export const createTenantInvitationEmailLibrary = (
  tenantId: string,
  queries: Queries,
  connectorLibrary: ConnectorLibrary
) => new TenantInvitationEmailLibrary(tenantId, queries, connectorLibrary);
