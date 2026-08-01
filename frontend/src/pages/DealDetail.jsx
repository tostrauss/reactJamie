import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deals } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api';
import { MapErrorBoundary } from '../components/MapErrorBoundary';

// ISO weekday (1=Mon … 7=Sun) → short label, for weekday-restricted deals.
const WEEKDAY_LABELS = {
  de: { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So' },
  en: { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' },
  it: { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 7: 'Dom' },
};
const formatRedeemDays = (days, lang) =>
  (days || []).map(n => WEEKDAY_LABELS[lang]?.[n] || n).join(', ');

const LIBRARIES = [];
const DEAL_MAP_STYLES = [
  { elementType: 'geometry',           stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.icon',        stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#7b7b9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road',         elementType: 'geometry.fill', stylers: [{ color: '#2d2d4e' }] },
  { featureType: 'road.highway', elementType: 'geometry',      stylers: [{ color: '#3d3d6b' }] },
  { featureType: 'water',        elementType: 'geometry',      stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'poi.park',     elementType: 'geometry',      stylers: [{ color: '#162030' }] },
];

function DealMiniMap({ lat, lng }) {
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
    libraries: LIBRARIES,
  });
  if (!isLoaded) return <div style={{ height: 200, background: '#1e2235', borderRadius: 20 }} />;
  const pos = { lat, lng };
  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: 200 }}
      center={pos}
      zoom={15}
      options={{
        styles: DEAL_MAP_STYLES,
        disableDefaultUI: true,
        gestureHandling: 'none',
        zoomControl: false,
        clickableIcons: false,
      }}
    >
      <Marker position={pos} />
    </GoogleMap>
  );
}

export const DealDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage || i18n.language || 'de').startsWith('en') ? 'en'
    : (i18n.resolvedLanguage || i18n.language || 'de').startsWith('it') ? 'it' : 'de';
  const toast = useToast();
  const { user } = useContext(AuthContext);
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  // Redemption status: { redeemed, count, max }. null while loading — we
  // disable the CTA in that window so a double-tap can't race the fetch.
  const [redemption, setRedemption] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    // Two independent fetches: ONLY the deal payload gates render. The
    // redemption status gates just the CTA — it must never hold the whole
    // page hostage (a failing status call goes through the axios 5xx retry
    // ladder, ~8s; coupling them via allSettled meant 8s of blank screen).
    let cancelled = false;
    deals.getOne(id)
      .then(res => { if (!cancelled) setDeal(res.data); })
      .catch(() => { if (!cancelled) navigate(-1); })
      .finally(() => { if (!cancelled) setLoading(false); });
    deals.getRedemptionStatus(id)
      .then(res => { if (!cancelled) setRedemption(res.data); })
      .catch(() => {}); // non-fatal: CTA simply stays disabled
    return () => { cancelled = true; };
  }, [id, navigate]);

  const handleConfirmRedeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    try {
      const res = await deals.redeem(id);
      // Reflect the redeemed state on THIS page immediately (CTA + "1/1
      // eingelöst" counter) instead of whisking the user off to the voucher
      // page — the proof screen stays reachable via the redeemed button.
      setRedemption(res.data);
      setShowConfirm(false);
      toast.success(t('deal.redeemedToast'));
    } catch (err) {
      // 409 — already redeemed in a parallel tab or after a back-button race.
      // Surface the existing redemption so the page shows it as redeemed.
      if (err.response?.status === 409) {
        setRedemption(err.response.data);
        setShowConfirm(false);
        return;
      }
      // 422 WRONG_DAY — day rolled over between page load and tap.
      if (err.response?.status === 422 && err.response.data?.code === 'WRONG_DAY') {
        setShowConfirm(false);
        toast.error(t('deal.onlyDaysCTA', {
          days: formatRedeemDays(err.response.data.redeem_days, lang),
          defaultValue: 'Nur {{days}} einlösbar',
        }));
        // Refresh status so the button reflects the new day.
        deals.getRedemptionStatus(id).then(r => setRedemption(r.data)).catch(() => {});
        return;
      }
      toast.error(t('deal.redeemError'));
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!deal) return null;

  const photos = Array.isArray(deal.photos) ? deal.photos : [];
  const hasMap = deal.lat && deal.lng;

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg-primary)',
      // Reserve the status-bar inset on the outer container so the sticky
      // header below sits cleanly under iOS Dynamic Island / notch. Using
      // max() guarantees a sane minimum even if env() ever returns 0.
      paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)',
      // Flat nav clearance (flush 48px strip + "+" protrusion, no safe-area
      // — see .bottom-nav in global.css)
      paddingBottom: '68px',
    }}>
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 50,
        background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center',
        padding: '14px 20px',
        gap: 12,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%',
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff', flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <h1 style={{ color: '#fff', fontSize: 17, fontWeight: 700, margin: 0, flex: 1, textAlign: 'center' }}>
          {t('deal.titleFmt', { category: deal.category })}
        </h1>
        <div style={{ width: 36 }} />
      </div>

      {/* ── Photo grid (2×2) ─────────────────────────────────────── */}
      <div style={{ margin: '0 16px', borderRadius: 20, overflow: 'hidden' }}>
        {photos.length === 0 ? (
          <div style={{
            height: 280, background: '#1e2235',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 48,
          }}>🍵</div>
        ) : photos.length === 1 ? (
          <img src={photos[0]} alt={deal.name} style={{ width: '100%', height: 280, objectFit: 'cover', display: 'block' }} decoding="async" fetchPriority="high" />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 3,
            height: 320,
          }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ overflow: 'hidden', position: 'relative' }}>
                {photos[i] ? (
                  <img
                    src={photos[i]}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#1e2235' }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Redeem CTA + counter ────────────────────────────────── */}
      {/* Sits right under the photo so it's the first thing thumbs reach. */}
      <div style={{ textAlign: 'center', marginTop: -22 }}>
        {(() => {
          const redeemed = !!redemption?.redeemed;
          const isAdmin = !!user?.is_admin;
          // Ticket-shop deals: after redeeming, the CTA stays ACTIVE and opens
          // the external shop ("Zum Ticketshop") instead of dead-ending on the
          // in-store voucher screen (Tina 2026-08-01, Liberi ticket deal).
          const bookingUrl = deal.booking_url || null;
          const interval = redemption?.redeem_interval || 'once';
          // Weekday gate: e.g. "nur donnerstags". Blocked → disable + relabel
          // (admins bypass for testing). The backend enforces it too.
          const redeemDays = Array.isArray(redemption?.redeem_days) ? redemption.redeem_days : [];
          const blockedByDay = redeemDays.length > 0 && redemption?.redeemable_today === false && !isAdmin;
          const daysLabel = formatRedeemDays(redeemDays, lang);
          // For recurring deals "redeemed" means redeemed THIS period — the
          // status endpoint resets it next day/week, so the CTA re-enables on
          // its own. Label reflects the period so it doesn't read as "forever".
          const redeemedLabel = interval === 'weekly'
            ? t('deal.redeemedWeekCTA', { defaultValue: 'Diese Woche eingelöst ✓' })
            : interval === 'daily'
            ? t('deal.redeemedDayCTA', { defaultValue: 'Heute eingelöst ✓' })
            : t('deal.redeemedCTA');
          // Once redeemed the voucher is locked for the current period — only
          // admins may re-open it (testing/demos). Ticket-shop deals stay
          // active: redeemed → the button opens the shop.
          const voucherLocked = redeemed && !isAdmin && !bookingUrl;
          const shopAfterRedeem = redeemed && !!bookingUrl;
          const label = redeemed
            ? (bookingUrl
                ? t('deal.ticketShopCTA', { defaultValue: 'Zum Ticketshop 🎟' })
                : isAdmin ? t('deal.viewVoucherCTA') : redeemedLabel)
            : blockedByDay
            ? t('deal.onlyDaysCTA', { days: daysLabel, defaultValue: 'Nur {{days}} einlösbar' })
            : t('deal.redeemCTA');
          return (
            <button
              type="button"
              disabled={!redemption || redeeming || voucherLocked || blockedByDay}
              onClick={() => {
                if (redeemed) {
                  if (bookingUrl) window.open(bookingUrl, '_blank', 'noopener');
                  else if (isAdmin) navigate(`/deal/${id}/redeem`);
                }
                else if (!blockedByDay) setShowConfirm(true);
              }}
              style={{
                background: ((redeemed && !shopAfterRedeem) || blockedByDay) ? 'rgba(255,255,255,0.10)' : '#FD7666',
                color: (voucherLocked || blockedByDay) ? 'rgba(255,255,255,0.55)' : '#fff',
                border: ((redeemed && !shopAfterRedeem) || blockedByDay) ? '1px solid rgba(255,255,255,0.15)' : 'none',
                borderRadius: 100,
                padding: '13px 32px',
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: 0.3,
                boxShadow: ((redeemed && !shopAfterRedeem) || blockedByDay) ? 'none' : '0 8px 24px rgba(253,118,102,0.35)',
                cursor: (!redemption || voucherLocked || blockedByDay) ? 'default' : 'pointer',
                opacity: !redemption ? 0.7 : 1,
              }}
            >
              {label}
            </button>
          );
        })()}
        {redemption && (
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: '8px 0 0' }}>
            {redemption.redeem_interval === 'weekly'
              ? t('deal.cadenceWeekly', { defaultValue: '🔁 1× pro Woche einlösbar' })
              : redemption.redeem_interval === 'daily'
              ? t('deal.cadenceDaily', { defaultValue: '🔁 1× pro Tag einlösbar' })
              : t('deal.redemptionCounter', { count: redemption.count, max: redemption.max })}
          </p>
        )}
        {Array.isArray(redemption?.redeem_days) && redemption.redeem_days.length > 0 && (
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: '4px 0 0' }}>
            {t('deal.onlyDaysInfo', { days: formatRedeemDays(redemption.redeem_days, lang), defaultValue: '📅 Nur {{days}} einlösbar' })}
          </p>
        )}
      </div>

      {/* ── Deal label pill ──────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <span style={{
          display: 'inline-block',
          background: 'rgba(253,118,102,0.15)',
          color: '#FD7666',
          fontSize: 15, fontWeight: 700,
          padding: '7px 20px',
          borderRadius: 100,
          border: '1px solid rgba(253,118,102,0.3)',
        }}>
          {deal.deal_label}
        </span>
      </div>

      {/* ── Redeem confirmation modal ────────────────────────────── */}
      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !redeeming && setShowConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
            paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360,
              background: '#1e2235',
              borderRadius: 20,
              padding: '24px 22px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <h3 style={{ color: '#fff', fontSize: 19, fontWeight: 800, margin: '0 0 10px' }}>
              {t('deal.redeemConfirmTitle')}
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.5, margin: '0 0 22px' }}>
              {t('deal.redeemConfirmBody')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={redeeming}
                onClick={() => setShowConfirm(false)}
                style={{
                  flex: 1,
                  padding: '13px 0',
                  borderRadius: 100,
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  border: 'none',
                  fontSize: 15, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('deal.redeemConfirmNo')}
              </button>
              <button
                type="button"
                disabled={redeeming}
                onClick={handleConfirmRedeem}
                style={{
                  flex: 1,
                  padding: '13px 0',
                  borderRadius: 100,
                  background: '#FD7666',
                  color: '#fff',
                  border: 'none',
                  fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  opacity: redeeming ? 0.6 : 1,
                }}
              >
                {redeeming ? '…' : t('deal.redeemConfirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Booking CTA ──────────────────────────────────────────── */}
      {deal.booking_url && (
        <div style={{ margin: '16px 16px 0' }}>
          <a
            href={deal.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '17px 0',
              borderRadius: 16,
              background: '#FD7666',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              textDecoration: 'none',
              letterSpacing: 0.2,
            }}
          >
            {t('deal.bookNow')}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      )}

      {/* ── Info card ────────────────────────────────────────────── */}
      <div style={{
        margin: '16px 16px 0',
        background: '#1e2235',
        borderRadius: 20,
        padding: '20px 20px',
      }}>
        {/* Address */}
        {deal.address && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>{deal.address}</span>
          </div>
        )}

        {/* Name */}
        <h2 style={{ color: '#FD7666', fontSize: 26, fontWeight: 800, margin: '0 0 12px', letterSpacing: -0.5 }}>
          {deal.name}
        </h2>

        {/* Description */}
        {deal.description && (
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
            {deal.description}
          </p>
        )}
      </div>

      {/* ── Map ──────────────────────────────────────────────────── */}
      {hasMap && (
        <div style={{ margin: '16px 16px 0', borderRadius: 20, overflow: 'hidden' }}>
          <MapErrorBoundary fallback={<div style={{ height: 200, background: '#1e2235', borderRadius: 20 }} />}>
            <DealMiniMap lat={deal.lat} lng={deal.lng} />
          </MapErrorBoundary>
        </div>
      )}
    </div>
  );
};

export default DealDetail;
