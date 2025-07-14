import {
  cloudApiIndicator,
  CloudScope,
  getManagementApiResourceIndicator,
  PredefinedScope,
} from '@logto/schemas';

export type ApiResource = {
  indicator: string;
  scopes: Record<string, string>;
};

export const getManagementApi = (tenantId: string) =>
  Object.freeze({
    indicator: getManagementApiResourceIndicator(tenantId),
    scopes: PredefinedScope,
  } satisfies ApiResource);

// For local OSS, use the local admin tenant endpoint for ME API
// For cloud, use the fixed admin.logto.app endpoint
const getMeApiIndicator = () => {
  // ME API resource indicator is always https://admin.logto.app/me
  // This is defined in the database migration (1.0.0_rc.1-1676115897-add-admin-tenant.ts)
  // and should not change based on environment
  return 'https://admin.logto.app/me';
};

export const meApi = Object.freeze({
  indicator: getMeApiIndicator(),
  scopes: PredefinedScope,
} satisfies ApiResource);

export const cloudApi = Object.freeze({
  indicator: cloudApiIndicator,
  scopes: CloudScope,
} satisfies ApiResource);
