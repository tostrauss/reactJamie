import { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { push as pushApi } from '../utils/api';
import { useToast } from '../context/ToastContext';

/**
 * Settings → Benachrichtigungen → „Neuigkeiten & Deals" (18.10.2026): the
 * opt-in for JAMIE's news pushes. App Store Review Guideline 4.5.4 wants an
 * explicit in-app opt-in for promotional pushes, so it starts OFF; the in-app
 * bell shows the news to everyone regardless.
 *
 * Its own read (GET /push/preferences), not the profile: users.push_news is
 * deliberately outside SAFE_USER_COLS. `value`: undefined while loading (row
 * shown, switch disabled — no layout jump), null when this server cannot
 * store the choice (route missing or column not migrated) → row hidden, a
 * switch that cannot save would only lie, boolean otherwise.
 */
export function NewsPushToggle() {
  const { t } = useTranslation();
  const toast = useToast();
  const labelId = useId();
  const [value, setValue] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pushApi.getPreferences()
      .then((res) => {
        if (cancelled) return;
        const v = res?.data?.push_news;
        setValue(typeof v === 'boolean' ? v : null);
      })
      .catch(() => { if (!cancelled) setValue(null); });
    return () => { cancelled = true; };
  }, []);

  if (value === null) return null;

  // Optimistic flip like the other preference switches; rollback + toast when
  // the PUT fails (axios never retries a PUT).
  const toggle = async () => {
    if (busy || typeof value !== 'boolean') return;
    const next = !value;
    setValue(next);
    setBusy(true);
    try {
      const res = await pushApi.updatePreferences({ push_news: next });
      if (typeof res?.data?.push_news === 'boolean') setValue(res.data.push_news);
    } catch {
      setValue(!next);
      toast.error(t('settings.toast.prefSaveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-row">
      <div className="settings-row-left">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
        <div className="settings-row-stacked">
          <span id={labelId}>{t('settings.notifications.news')}</span>
          <span className="settings-row-detail">{t('settings.notifications.newsHint')}</span>
        </div>
      </div>
      <label className="settings-toggle" style={{ opacity: busy || value === undefined ? 0.5 : 1 }}>
        <input
          type="checkbox"
          checked={value === true}
          onChange={toggle}
          disabled={busy || value === undefined}
          aria-labelledby={labelId}
        />
        <span className="settings-toggle-slider" />
      </label>
    </div>
  );
}

export default NewsPushToggle;
