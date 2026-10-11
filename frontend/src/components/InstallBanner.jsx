import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { safeStorage } from '../utils/safeStorage';
import {
  INSTALL_DISMISSED_KEY, isInStandaloneMode, installDismissedRecently,
  captureInstallPrompt, getInstallPrompt, clearInstallPrompt, onInstallPrompt,
} from '../utils/installPrompt';

// ==========================================
// INSTALL PROMPT BANNER (web only — App renders it behind !isNative())
// ==========================================
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// suppressed: stay invisible for now (the sign-up flow). The banner may also
// unmount and come back (AppIntro, OutOfRegion): the install event itself is
// held by utils/installPrompt.js, so a banner that mounts after Chrome fired
// it still picks it up.
export const InstallBanner = ({ suppressed = false }) => {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (isInStandaloneMode() || installDismissedRecently()) return undefined;

    if (isIOS()) {
      setIosMode(true);
      setShowBanner(true);
      return undefined;
    }

    // Idempotent — main.jsx has normally armed it before the first render.
    captureInstallPrompt();
    const adopt = (e) => {
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    const early = getInstallPrompt();
    if (early) adopt(early);
    return onInstallPrompt(adopt);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    clearInstallPrompt();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    safeStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
    setShowBanner(false);
  };

  if (!showBanner || suppressed) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-content">
        <div className="install-banner-icon">J</div>
        <div className="install-banner-text">
          <strong>{t('app.install.title')}</strong>
          {iosMode
            ? <span>{t('app.install.iosHintPrefix')} <strong>{t('app.install.iosShare')}</strong> {t('app.install.iosHintArrow')} <strong>{t('app.install.iosHomeScreen')}</strong></span>
            : <span>{t('app.install.defaultText')}</span>
          }
        </div>
      </div>
      <div className="install-banner-actions">
        {!iosMode && (
          <button className="install-btn" onClick={handleInstall}>{t('app.install.btn')}</button>
        )}
        <button className="install-dismiss" onClick={handleDismiss}>✕</button>
      </div>
    </div>
  );
};

export default InstallBanner;
