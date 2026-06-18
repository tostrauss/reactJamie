import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deals } from '../utils/api';

// Proof screen the user shows to the venue staff after confirming they're
// on-site. The redemption was already POSTed from DealDetail before this
// page mounts; we only have to render the deal in a way the staff can
// glance-verify (big brand, photo, deal label) and offer a way out.
export const DealRedeem = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    deals.getOne(id)
      .then(res => setDeal(res.data))
      .catch(() => navigate(`/deal/${id}`, { replace: true }))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Slightly lighter/bluer than the app's #231B43 — per Tina's design mock
  // the proof screen stands apart from the rest of the app so staff
  // recognize it at a glance.
  const PAGE_BG = '#2C2960';

  if (loading || !deal) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: PAGE_BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  const photo = Array.isArray(deal.photos) && deal.photos.length ? deal.photos[0] : null;

  return (
    // Edge-to-edge (fixed inset:0, not minHeight:100dvh): on iOS standalone the
    // dvh box can fall ~1 home-indicator short of the physical screen, letting
    // the darker body (#231B43) show as a seam below this lighter page (#2C2960).
    // A fixed full-bleed layer paints PAGE_BG into every safe-area zone instead.
    <div style={{
      position: 'fixed',
      inset: 0,
      background: PAGE_BG,
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))',
      paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      paddingLeft: 20,
      paddingRight: 20,
    }}>
      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <h1 style={{ color: '#fff', fontSize: 17, fontWeight: 700, margin: 0 }}>
          {t('deal.redeemPage.header')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '6px 0 0' }}>
          {t('deal.redeemPage.subheader')}
        </p>
      </div>

      {/* ── Brand + proof card — on a subtly lighter rounded panel (mock) ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        background: 'rgba(255,255,255,0.045)',
        borderRadius: 28,
        padding: '32px 18px',
        marginTop: 12,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            color: '#FD7666',
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: 2,
            lineHeight: 1,
          }}>
            {t('deal.redeemPage.brand')}
          </div>
          <div style={{
            color: '#FD7666',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 1,
            marginTop: 6,
          }}>
            {t('deal.redeemPage.brandSub')}
          </div>
        </div>

        <div style={{
          width: '100%',
          maxWidth: 360,
          background: 'rgba(253,118,102,0.06)',
          border: '2px solid rgba(253,118,102,0.55)',
          borderRadius: 24,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}>
          {photo ? (
            <img
              src={photo}
              alt={deal.name}
              style={{
                width: '100%',
                height: 160,
                objectFit: 'cover',
                borderRadius: 14,
                display: 'block',
              }}
            />
          ) : (
            <div style={{
              width: '100%',
              height: 160,
              borderRadius: 14,
              background: '#1e2235',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 48,
            }}>🎟️</div>
          )}
          <h2 style={{ color: '#fff', fontSize: 22, fontWeight: 800, margin: 0, textAlign: 'center' }}>
            {deal.name}
          </h2>
          <div style={{
            color: '#FD7666',
            fontSize: 18,
            fontWeight: 700,
            textAlign: 'center',
          }}>
            {deal.deal_label}
          </div>
        </div>
      </div>

      {/* ── Done button ── */}
      <button
        onClick={() => navigate(`/deal/${id}`, { replace: true })}
        style={{
          margin: '24px auto 0',
          padding: '15px 64px',
          background: 'rgba(253,118,102,0.15)',
          border: '1px solid rgba(253,118,102,0.4)',
          borderRadius: 100,
          color: '#FD7666',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 0.3,
          cursor: 'pointer',
        }}
      >
        {t('deal.redeemPage.done')}
      </button>
    </div>
  );
};

export default DealRedeem;
