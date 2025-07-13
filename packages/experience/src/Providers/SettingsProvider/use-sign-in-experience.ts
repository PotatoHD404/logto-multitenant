import { useContext, useEffect } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import useTenantId from '@/hooks/use-tenant-id';
import initI18n from '@/i18n/init';
import { getSignInExperienceSettings } from '@/utils/sign-in-experience';

import useTheme from './use-theme';

const useSignInExperience = () => {
  const { isPreview, setExperienceSettings } = useContext(PageContext);
  const tenantId = useTenantId();

  useTheme();

  useEffect(() => {
    (async () => {
      const [settings] = await Promise.all([getSignInExperienceSettings(tenantId), initI18n(tenantId)]);

      // Init the page settings and render
      setExperienceSettings(settings);
    })();
  }, [isPreview, setExperienceSettings, tenantId]);
};

export default useSignInExperience;
