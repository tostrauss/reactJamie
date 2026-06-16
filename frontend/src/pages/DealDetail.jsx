import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deals } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api';

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
  const { t } = useTranslation();
  const toast = useToast();
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
          <img src={photos[0]} alt={deal.name} style={{ width: '100%', height: 280, objectFit: 'cover', display: 'block' }} decoding="async" fetchpriority="high" />
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
        <button
          type="button"
          disabled={!redemption || redeeming}
          onClick={() => redemption?.redeemed ? navigate(`/deal/${id}/redeem`) : setShowConfirm(true)}
          style={{
            background: redemption?.redeemed ? 'rgba(255,255,255,0.12)' : '#FD7666',
            color: '#fff',
            border: redemption?.redeemed ? '1px solid rgba(255,255,255,0.18)' : 'none',
            borderRadius: 100,
            padding: '13px 32px',
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: 0.3,
            boxShadow: redemption?.redeemed ? 'none' : '0 8px 24px rgba(253,118,102,0.35)',
            cursor: redemption ? 'pointer' : 'default',
            opacity: !redemption ? 0.7 : 1,
          }}
        >
          {redemption?.redeemed ? t('deal.viewVoucherCTA') : t('deal.redeemCTA')}
        </button>
        {redemption && (
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: '8px 0 0' }}>
            {t('deal.redemptionCounter', { count: redemption.count, max: redemption.max })}
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
          <DealMiniMap lat={deal.lat} lng={deal.lng} />
        </div>
      )}
    </div>
  );
};

export default DealDetail;
