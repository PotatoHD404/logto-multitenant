import { conditional } from '@silverhand/essentials';
import classNames from 'classnames';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import ExternalLinkIcon from '@/assets/icons/external-link.svg?react';
import { AppDataContext } from '@/contexts/AppDataProvider';
import { TenantsContext } from '@/contexts/TenantsProvider';
import type { Props as ButtonProps, ButtonType } from '@/ds-components/Button';
import Button from '@/ds-components/Button';
import FlipOnRtl from '@/ds-components/FlipOnRtl';
import { Tooltip } from '@/ds-components/Tip';

import styles from './index.module.scss';

type Props = {
  readonly size?: ButtonProps['size'];
  readonly type?: ButtonType;
  readonly isDisabled: boolean;
};

function LivePreviewButton({ size, type, isDisabled }: Props) {
  const { tenantEndpoint } = useContext(AppDataContext);
  const { currentTenantId } = useContext(TenantsContext);
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  return (
    <Tooltip content={conditional(isDisabled && t('sign_in_exp.preview.live_preview_tip'))}>
      <Button
        size={size}
        type={type}
        disabled={isDisabled}
        title="sign_in_exp.preview.live_preview"
        trailingIcon={
          <FlipOnRtl>
            <ExternalLinkIcon
              className={conditional(
                type !== 'violet' &&
                  classNames(styles.defaultIcon, isDisabled && styles.disabledDefaultIcon)
              )}
            />
          </FlipOnRtl>
        }
        onClick={() => {
          // Use tenant-aware path structure for demo-app
          window.open(new URL(`/t/${currentTenantId}/demo-app`, tenantEndpoint), '_blank');
        }}
      />
    </Tooltip>
  );
}

export default LivePreviewButton;
