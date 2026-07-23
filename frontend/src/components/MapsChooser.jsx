import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import '../styles/maps-chooser.css';

// Web can't invoke iOS's native "choose a maps app" sheet, so we present our
// own: tapping a location map opens this and the user picks Apple Maps or
// Google Maps. Both URLs are universal links — on iOS they open the native app
// (falling back to the web map), so "hinkommen" (get directions) just works.
const appleUrl  = (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}`;
const googleUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export function MapsChooser({ lat, lng, onClose }) {
  const { t } = useTranslation();

  const open = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return createPortal(
    <div className="maps-chooser-overlay" onClick={onClose}>
      <div className="maps-chooser-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="maps-chooser-title">{t('map.directionsTitle')}</p>
        <button type="button" className="maps-chooser-btn" onClick={() => open(appleUrl(lat, lng))}>
          <span className="maps-chooser-emoji" aria-hidden="true">🍎</span>
          {t('map.appleMaps')}
        </button>
        <button type="button" className="maps-chooser-btn" onClick={() => open(googleUrl(lat, lng))}>
          <span className="maps-chooser-emoji" aria-hidden="true">🗺️</span>
          {t('map.googleMaps')}
        </button>
        <button type="button" className="maps-chooser-cancel" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>,
    document.body
  );
}
