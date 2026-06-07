import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const SUPPORT_EMAIL = 'support@jamie-app.com';

export default function Help() {
  const { t, i18n } = useTranslation();
  const [openId, setOpenId] = useState(null);

  const faqs = t('help.faqs', { returnObjects: true });
  const faqList = Array.isArray(faqs) ? faqs : [];

  const toggle = (id) => setOpenId(prev => (prev === id ? null : id));

  const mailLink = (subjectKey) => {
    const subject = encodeURIComponent(t(subjectKey));
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
  };

  return (
    <div className="page" style={{ padding: '24px 20px 80px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← {t('common.back')}
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{t('help.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
        {t('help.intro')}
      </p>

      {/* ── Contact card ── */}
      <div style={{
        background: 'var(--bg-card, rgba(255,255,255,0.04))',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 16,
        marginBottom: 28,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('help.contact.title')}</h2>

        <a
          href={mailLink('help.contact.subjectSupport')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            color: 'inherit',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            minHeight: 44,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>📧</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t('help.contact.email')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{SUPPORT_EMAIL}</div>
            </div>
          </div>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
        </a>

        <a
          href={mailLink('help.contact.subjectBug')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            color: 'inherit',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            minHeight: 44,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>🐞</span>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('help.contact.reportBug')}</div>
          </div>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
        </a>

        <a
          href={mailLink('help.contact.subjectFeature')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 0',
            color: 'inherit',
            textDecoration: 'none',
            minHeight: 44,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18 }}>💡</span>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('help.contact.suggestFeature')}</div>
          </div>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
        </a>
      </div>

      {/* ── FAQs ── */}
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{t('help.faqTitle')}</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {faqList.map((faq, i) => {
          const open = openId === i;
          return (
            <div
              key={i}
              style={{
                background: 'var(--bg-card, rgba(255,255,255,0.04))',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => toggle(i)}
                aria-expanded={open}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  minHeight: 44,
                }}
              >
                <span style={{ flex: 1, paddingRight: 12 }}>{faq.q}</span>
                <span
                  style={{
                    fontSize: 18,
                    color: 'var(--text-secondary)',
                    transform: open ? 'rotate(180deg)' : 'none',
                    transition: 'transform 150ms ease',
                  }}
                  aria-hidden
                >
                  ⌄
                </span>
              </button>
              {open && (
                <div
                  style={{
                    padding: '0 16px 14px',
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-line',
                  }}
                >
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Legal links ── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{t('help.moreLinks')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
        <Link to="/privacy" style={{ color: 'var(--coral)', textDecoration: 'none', padding: '8px 0' }}>
          {t('settings.legal.privacy')}
        </Link>
        <Link to="/terms" style={{ color: 'var(--coral)', textDecoration: 'none', padding: '8px 0' }}>
          {t('settings.legal.terms')}
        </Link>
        <Link to="/impressum" style={{ color: 'var(--coral)', textDecoration: 'none', padding: '8px 0' }}>
          {t('settings.legal.imprint')}
        </Link>
      </div>

      <p style={{
        marginTop: 32,
        fontSize: 11,
        color: 'rgba(255,255,255,0.3)',
        textAlign: 'center',
      }}>
        {t('help.footer', { lang: i18n.language === 'en' ? 'EN' : 'DE' })}
      </p>
    </div>
  );
}
