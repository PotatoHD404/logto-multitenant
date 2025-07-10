import { type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

const ChangePasswordModal = safeLazy(
  async () => import('@/pages/Profile/containers/ChangePasswordModal')
);
const LinkEmailModal = safeLazy(async () => import('@/pages/Profile/containers/LinkEmailModal'));
const VerificationCodeModal = safeLazy(
  async () => import('@/pages/Profile/containers/VerificationCodeModal')
);
const VerifyPasswordModal = safeLazy(
  async () => import('@/pages/Profile/containers/VerifyPasswordModal')
);

// MFA Setup Modals
const SetupTotpModal = safeLazy(
  async () => import('@/pages/Profile/containers/SetupTotpModal')
);
const SetupWebAuthnModal = safeLazy(
  async () => import('@/pages/Profile/containers/SetupWebAuthnModal')
);
const SetupBackupCodeModal = safeLazy(
  async () => import('@/pages/Profile/containers/SetupBackupCodeModal')
);

export const profile: RouteObject[] = [
  { path: 'verify-password', element: <VerifyPasswordModal /> },
  { path: 'change-password', element: <ChangePasswordModal /> },
  { path: 'link-email', element: <LinkEmailModal /> },
  { path: 'verification-code', element: <VerificationCodeModal /> },
  // MFA setup routes
  { path: 'setup-mfa/totp', element: <SetupTotpModal /> },
  { path: 'setup-mfa/webauthn', element: <SetupWebAuthnModal /> },
  { path: 'setup-mfa/backupcode', element: <SetupBackupCodeModal /> },
];
