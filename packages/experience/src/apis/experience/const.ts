export const prefix = '/api/experience';

export const experienceApiRoutes = Object.freeze({
  prefix,
  identification: `${prefix}/identification`,
  submit: `${prefix}/submit`,
  verification: `${prefix}/verification`,
  profile: `${prefix}/profile`,
  mfa: `${prefix}/profile/mfa`,
});

// Create tenant-aware experience API routes
export const createTenantExperienceApiRoutes = (tenantId?: string) => {
  const basePrefix = tenantId ? `/t/${tenantId}/api/experience` : '/api/experience';
  
  return Object.freeze({
    prefix: basePrefix,
    identification: `${basePrefix}/identification`,
    submit: `${basePrefix}/submit`,
    verification: `${basePrefix}/verification`,
    profile: `${basePrefix}/profile`,
    mfa: `${basePrefix}/profile/mfa`,
  });
};

export type VerificationResponse = {
  verificationId: string;
};
