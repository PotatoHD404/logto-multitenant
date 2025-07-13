import i18next from 'i18next';
import ky from 'ky';

// Global API client - used for non-tenant-specific calls
const globalApi = ky.extend({
  hooks: {
    beforeRequest: [
      (request) => {
        request.headers.set('Accept-Language', i18next.language);
      },
    ],
  },
});

// Create tenant-aware API client
export const createTenantApi = (tenantId?: string) => {
  const baseUrl = tenantId ? `/t/${tenantId}` : '';

  return ky.extend({
    prefixUrl: baseUrl,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Accept-Language', i18next.language);
        },
      ],
    },
  });
};

// Default export for backward compatibility
export default globalApi;
