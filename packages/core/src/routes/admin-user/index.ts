import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

import adminUserBasicsRoutes from './basics.js';
import adminUserMfaVerificationsRoutes from './mfa-verifications.js';
import adminUserOrganizationRoutes from './organization.js';
import adminUserPersonalAccessTokenRoutes from './personal-access-token.js';
import adminUserRoleRoutes from './role.js';
import adminUserSearchRoutes from './search.js';
import adminUserSessionsRoutes from './sessions.js';
import adminUserSocialRoutes from './social.js';

export default function adminUserRoutes<T extends ManagementApiRouter>(...args: RouterInitArgs<T>) {
  adminUserBasicsRoutes(...args);
  adminUserRoleRoutes(...args);
  adminUserSearchRoutes(...args);
  adminUserSocialRoutes(...args);
  adminUserOrganizationRoutes(...args);
  adminUserMfaVerificationsRoutes(...args);
  adminUserPersonalAccessTokenRoutes(...args);
  adminUserSessionsRoutes(...args);
}
