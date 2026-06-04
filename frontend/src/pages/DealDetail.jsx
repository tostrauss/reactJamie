import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deals } from '../utils/api';
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
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    deals.getOne(id)
      .then(res => setDeal(res.data))
      .catch(() => navigate(-1))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: '#12132b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!deal) return null;

  const photos = Array.isArray(deal.photos) ? deal.photos : [];
  const hasMap = deal.lat && deal.lng;

  return (
    <div style={{ minHeight: '100dvh', background: '#12132b', paddingBottom: 100 }}>
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#12132b',
        paddingTop: 'env(safe-area-inset-top, 0px)',
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
