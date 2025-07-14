/**
 * @fileoverview
 * Comprehensive tests for multi-tenant invitation flow.
 * Tests tenant isolation, security, and proper invitation management.
 */

import { TenantRole, OrganizationInvitationStatus } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';
import { type WithAuthContext } from '@logto/shared/esm/koa/koa-auth';
import { type IRouterParamContext } from 'koa-router';

import { mockEnvSet } from '#src/test-utils/env-set.js';
import { MockTenant } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

import { createMockContext } from '#src/test-utils/koa-auth/index.js';

const { jest } = import.meta;
const { mockEsmDefault } = createMockUtils(jest);

await mockEnvSet({ isMultiTenancy: true });

const mockTenantOrganizationLibrary = {
  ensureTenantOrganization: jest.fn(),
  addUserToTenant: jest.fn(),
  removeUserFromTenant: jest.fn(),
  updateUserRole: jest.fn(),
  getTenantMembers: jest.fn(),
  createInvitation: jest.fn(),
  getTenantInvitations: jest.fn(),
  getTenantPermissions: jest.fn(),
};

const mockTenantInvitationEmailLibrary = {
  sendTenantInvitationEmail: jest.fn(),
  generateInvitationUrl: jest.fn(),
  createInvitationMagicLink: jest.fn(),
};

const mockTenantInvitationNotificationLibrary = {
  notifyInvitationSent: jest.fn(),
  notifyInvitationAccepted: jest.fn(),
  notifyInvitationExpired: jest.fn(),
  notifyInvitationRevoked: jest.fn(),
  notifyInvitationResent: jest.fn(),
};

mockEsmDefault('#src/libraries/tenant-organization.js', () => ({
  createTenantOrganizationLibrary: jest.fn(() => mockTenantOrganizationLibrary),
}));

mockEsmDefault('#src/libraries/tenant-invitation-email.js', () => ({
  createTenantInvitationEmailLibrary: jest.fn(() => mockTenantInvitationEmailLibrary),
}));

mockEsmDefault('#src/libraries/tenant-invitation-notifications.js', () => ({
  createTenantInvitationNotificationLibrary: jest.fn(() => mockTenantInvitationNotificationLibrary),
}));

const tenantMemberRoutes = await import('./tenant-members.js');

describe('Multi-Tenant Invitation Flow', () => {
  const mockTenant = new MockTenant();
  const mockContext = createMockContext();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Tenant Isolation Tests', () => {
    it('should prevent users from accessing other tenants members', async () => {
      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';
      const userId = 'user-123';

      // Mock user has access to tenant A but not tenant B
      mockTenantOrganizationLibrary.getTenantPermissions
        .mockResolvedValueOnce(['read:tenant_members']) // Tenant A
        .mockResolvedValueOnce([]); // Tenant B

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantA),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      // Should succeed for tenant A
      await request.get(`/tenants/${tenantA}/members`).expect(200);

      // Should fail for tenant B
      await request.get(`/tenants/${tenantB}/members`).expect(403);
    });

    it('should prevent cross-tenant invitation creation', async () => {
      const tenantA = 'tenant-a';
      const tenantB = 'tenant-b';
      const userId = 'user-123';

      // Mock user has invite permissions for tenant A but not tenant B
      mockTenantOrganizationLibrary.getTenantPermissions
        .mockResolvedValueOnce(['invite:tenant_members']) // Tenant A
        .mockResolvedValueOnce([]); // Tenant B

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantA),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      const invitationData = {
        emails: ['test@example.com'],
        role: TenantRole.Collaborator,
      };

      // Should succeed for tenant A
      await request.post(`/tenants/${tenantA}/invitations`).send(invitationData).expect(201);

      // Should fail for tenant B
      await request.post(`/tenants/${tenantB}/invitations`).send(invitationData).expect(403);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin to invite users', async () => {
      const tenantId = 'tenant-123';
      const adminUserId = 'admin-user';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
        'manage:tenant',
      ]);

      mockTenantOrganizationLibrary.createInvitation.mockResolvedValue({
        id: 'invitation-123',
        invitee: 'test@example.com',
        organizationId: `t-${tenantId}`,
        status: OrganizationInvitationStatus.Pending,
      });

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: adminUserId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .post(`/tenants/${tenantId}/invitations`)
        .send({
          emails: ['test@example.com'],
          role: TenantRole.Admin,
        })
        .expect(201);

      expect(mockTenantOrganizationLibrary.createInvitation).toHaveBeenCalledWith(
        tenantId,
        'test@example.com',
        TenantRole.Admin,
        adminUserId
      );
    });

    it('should prevent collaborator from inviting users', async () => {
      const tenantId = 'tenant-123';
      const collaboratorUserId = 'collaborator-user';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue(['read:tenant_members']);

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: collaboratorUserId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .post(`/tenants/${tenantId}/invitations`)
        .send({
          emails: ['test@example.com'],
          role: TenantRole.Collaborator,
        })
        .expect(403);
    });
  });

  describe('Invitation Management', () => {
    it('should create invitation with proper tenant context', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const email = 'test@example.com';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      mockTenantOrganizationLibrary.createInvitation.mockResolvedValue({
        id: 'invitation-123',
        invitee: email,
        organizationId: `t-${tenantId}`,
        status: OrganizationInvitationStatus.Pending,
      });

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .post(`/tenants/${tenantId}/invitations`)
        .send({
          emails: [email],
          role: TenantRole.Collaborator,
        })
        .expect(201);

      expect(mockTenantOrganizationLibrary.createInvitation).toHaveBeenCalledWith(
        tenantId,
        email,
        TenantRole.Collaborator,
        userId
      );

      expect(mockTenantInvitationEmailLibrary.sendTenantInvitationEmail).toHaveBeenCalled();
      expect(mockTenantInvitationNotificationLibrary.notifyInvitationSent).toHaveBeenCalled();
    });

    it('should handle multiple email invitations', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const emails = ['test1@example.com', 'test2@example.com'];

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      mockTenantOrganizationLibrary.createInvitation
        .mockResolvedValueOnce({
          id: 'invitation-1',
          invitee: emails[0],
          organizationId: `t-${tenantId}`,
          status: OrganizationInvitationStatus.Pending,
        })
        .mockResolvedValueOnce({
          id: 'invitation-2',
          invitee: emails[1],
          organizationId: `t-${tenantId}`,
          status: OrganizationInvitationStatus.Pending,
        });

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .post(`/tenants/${tenantId}/invitations`)
        .send({
          emails,
          role: TenantRole.Collaborator,
        })
        .expect(201);

      expect(mockTenantOrganizationLibrary.createInvitation).toHaveBeenCalledTimes(2);
      expect(mockTenantInvitationEmailLibrary.sendTenantInvitationEmail).toHaveBeenCalledTimes(2);
      expect(mockTenantInvitationNotificationLibrary.notifyInvitationSent).toHaveBeenCalledTimes(2);
    });

    it('should handle duplicate invitation gracefully', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const email = 'test@example.com';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      mockTenantOrganizationLibrary.createInvitation
        .mockResolvedValueOnce({
          id: 'invitation-1',
          invitee: email,
          organizationId: `t-${tenantId}`,
          status: OrganizationInvitationStatus.Pending,
        })
        .mockRejectedValueOnce(new Error('entity.unique_integrity_violation'));

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .post(`/tenants/${tenantId}/invitations`)
        .send({
          emails: [email, email], // Duplicate email
          role: TenantRole.Collaborator,
        })
        .expect(201);

      expect(mockTenantOrganizationLibrary.createInvitation).toHaveBeenCalledTimes(2);
      expect(mockTenantInvitationEmailLibrary.sendTenantInvitationEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('Member Management', () => {
    it('should prevent admin from leaving if they are the only admin', async () => {
      const tenantId = 'tenant-123';
      const adminUserId = 'admin-user';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'remove:tenant_members',
        'manage:tenant',
      ]);

      mockTenantOrganizationLibrary.removeUserFromTenant.mockRejectedValue(
        new Error('entity.db_constraint_violated')
      );

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: adminUserId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request.delete(`/tenants/${tenantId}/members/${adminUserId}`).expect(422);
    });

    it('should allow role updates with proper permissions', async () => {
      const tenantId = 'tenant-123';
      const adminUserId = 'admin-user';
      const targetUserId = 'target-user';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'update:tenant_member_roles',
        'manage:tenant',
      ]);

      mockTenantOrganizationLibrary.updateUserRole.mockResolvedValue();

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: adminUserId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .put(`/tenants/${tenantId}/members/${targetUserId}/roles`)
        .send({
          roleName: TenantRole.Admin,
        })
        .expect(200);

      expect(mockTenantOrganizationLibrary.updateUserRole).toHaveBeenCalledWith(
        tenantId,
        targetUserId,
        TenantRole.Admin
      );
    });
  });

  describe('Invitation Status Management', () => {
    it('should allow invitation status updates', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const invitationId = 'invitation-123';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request
        .patch(`/tenants/${tenantId}/invitations/${invitationId}/status`)
        .send({
          status: OrganizationInvitationStatus.Revoked,
        })
        .expect(200);

      expect(mockTenantInvitationNotificationLibrary.notifyInvitationRevoked).toHaveBeenCalled();
    });

    it('should allow invitation deletion', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const invitationId = 'invitation-123';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request.delete(`/tenants/${tenantId}/invitations/${invitationId}`).expect(204);
    });

    it('should allow invitation resending', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';
      const invitationId = 'invitation-123';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'invite:tenant_members',
      ]);

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      await request.post(`/tenants/${tenantId}/invitations/${invitationId}/message`).expect(200);

      expect(mockTenantInvitationNotificationLibrary.notifyInvitationResent).toHaveBeenCalled();
    });
  });

  describe('Permission Scopes', () => {
    it('should return correct tenant permissions for user', async () => {
      const tenantId = 'tenant-123';
      const userId = 'user-123';

      mockTenantOrganizationLibrary.getTenantPermissions.mockResolvedValue([
        'read:tenant_members',
        'invite:tenant_members',
      ]);

      const request = createRequester({
        anonymousRoutes: tenantMemberRoutes.default,
        tenantContext: mockTenant.create(tenantId),
        middlewares: [
          async (ctx, next) => {
            ctx.auth = { sub: userId } as WithAuthContext<IRouterParamContext>['auth'];
            return next();
          },
        ],
      });

      const response = await request
        .get(`/tenants/${tenantId}/members/${userId}/scopes`)
        .expect(200);

      expect(response.body).toEqual(['read:tenant_members', 'invite:tenant_members']);
    });
  });
});
