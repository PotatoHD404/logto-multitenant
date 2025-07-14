import { MfaFactor } from '@logto/schemas';
import { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { adminTenantEndpoint, meApi } from '@/consts';
import Button from '@/ds-components/Button';
import { useStaticApi } from '@/hooks/use-api';
import useCurrentUserMfa from '@/hooks/use-current-user-mfa';
import useTenantPathname from '@/hooks/use-tenant-pathname';

import ExperienceLikeModal from '../../components/ExperienceLikeModal';
import { handleError } from '../../utils';

import styles from './index.module.scss';

// Helper function to convert base64url to ArrayBuffer
const base64UrlToArrayBuffer = (base64url: string): ArrayBuffer => {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  const binaryString = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.codePointAt(index) ?? 0;
  }
  return bytes.buffer;
};

// Helper function to convert ArrayBuffer to base64url
const arrayBufferToBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index++) {
    binary += String.fromCodePoint(bytes[index] ?? 0);
  }
  return Buffer.from(binary, 'binary')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
};

function SetupWebAuthnModal() {
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });
  const { navigate } = useTenantPathname();
  const { mutate: mutateMfaVerifications } = useCurrentUserMfa();
  const api = useStaticApi({
    prefixUrl: adminTenantEndpoint,
    resourceIndicator: meApi.indicator,
    hideErrorToast: true,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const onClose = useCallback(() => {
    navigate('/profile');
  }, [navigate]);

  const handleSetupWebAuthn = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      // Check if WebAuthn is supported
      if (!navigator.credentials.create) {
        throw new Error('WebAuthn is not supported in this browser');
      }

      // Step 1: Get WebAuthn registration options from backend
      const response = await api.post('me/mfa-verifications', {
        json: { type: MfaFactor.WebAuthn },
      });

      const data = await response.json<{
        type: 'WebAuthn';
        challenge: string;
        options: {
          challenge: string;
          rp: {
            name: string;
            id: string;
          };
          user: {
            id: string;
            name: string;
            displayName: string;
          };
          pubKeyCredParams: Array<{
            alg: number;
            type: string;
          }>;
          timeout: number;
          excludeCredentials?: Array<{
            id: string;
            type: string;
            transports?: string[];
          }>;
          authenticatorSelection?: {
            residentKey?: string;
          };
        };
      }>();

      // Step 2: Convert the options to the format expected by navigator.credentials.create
      const credentialCreationOptions: CredentialCreationOptions = {
        publicKey: {
          challenge: base64UrlToArrayBuffer(data.options.challenge),
          rp: data.options.rp,
          user: {
            id: base64UrlToArrayBuffer(data.options.user.id),
            name: data.options.user.name,
            displayName: data.options.user.displayName,
          },
          pubKeyCredParams: data.options.pubKeyCredParams.map((param) => ({
            alg: param.alg,
            type: param.type as PublicKeyCredentialType,
          })),
          timeout: data.options.timeout,
          excludeCredentials: data.options.excludeCredentials?.map((cred) => ({
            id: base64UrlToArrayBuffer(cred.id),
            type: cred.type as PublicKeyCredentialType,
            transports: cred.transports as AuthenticatorTransport[],
          })),
          authenticatorSelection: data.options.authenticatorSelection
            ? {
                residentKey: data.options.authenticatorSelection
                  .residentKey as ResidentKeyRequirement,
              }
            : undefined,
        },
      };

      // Step 3: Create credential using WebAuthn API
      const credential = await navigator.credentials.create(credentialCreationOptions);

      if (!credential || credential.type !== 'public-key') {
        throw new Error('Failed to create WebAuthn credential');
      }

      const publicKeyCredential = credential as PublicKeyCredential;
      const responseData = publicKeyCredential.response as AuthenticatorAttestationResponse;

      // Step 4: Format the response for the backend
      const webAuthnResponse = {
        id: publicKeyCredential.id,
        rawId: arrayBufferToBase64Url(publicKeyCredential.rawId),
        response: {
          clientDataJSON: arrayBufferToBase64Url(responseData.clientDataJSON),
          attestationObject: arrayBufferToBase64Url(responseData.attestationObject),
          transports: responseData.getTransports() ?? [],
        },
        type: publicKeyCredential.type,
      };

      // Step 5: Send the response back to the backend for verification
      await api.post('me/mfa-verifications', {
        json: {
          type: MfaFactor.WebAuthn,
          challenge: data.challenge,
          id: webAuthnResponse.id,
          rawId: webAuthnResponse.rawId,
          response: webAuthnResponse.response,
        },
      });

      toast.success(t('profile.set_up_mfa.webauthn_setup_success'));
      void mutateMfaVerifications();
      onClose();
    } catch (error: unknown) {
      console.error('WebAuthn setup failed:', error);
      void handleError(error, async (_, message) => {
        setError(message);
        return true;
      });
    } finally {
      setIsLoading(false);
    }
  }, [api, mutateMfaVerifications, onClose, t]);

  return (
    <ExperienceLikeModal
      title="profile.set_up_mfa.setup_webauthn"
      subtitle="profile.set_up_mfa.webauthn_description"
      onClose={onClose}
    >
      <div className={styles.content}>
        <div className={styles.instructions}>
          <div className={styles.instruction}>
            <div className={styles.step}>1</div>
            <div className={styles.text}>{t('profile.set_up_mfa.webauthn_instruction_1')}</div>
          </div>
          <div className={styles.instruction}>
            <div className={styles.step}>2</div>
            <div className={styles.text}>{t('profile.set_up_mfa.webauthn_instruction_2')}</div>
          </div>
          <div className={styles.instruction}>
            <div className={styles.step}>3</div>
            <div className={styles.text}>{t('profile.set_up_mfa.webauthn_instruction_3')}</div>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <Button title="general.cancel" onClick={onClose} />
          <Button
            type="primary"
            title="profile.set_up_mfa.setup"
            isLoading={isLoading}
            onClick={handleSetupWebAuthn}
          />
        </div>
      </div>
    </ExperienceLikeModal>
  );
}

export default SetupWebAuthnModal;
