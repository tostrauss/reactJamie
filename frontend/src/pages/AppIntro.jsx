import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const STORAGE_KEY = 'jamie_intro_seen';

// Visual style data — kept outside the component since it never changes.
// Text content lives inside the component and pulls from i18n.
const SLIDE_THEMES = [
  {
    emoji: '👋',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    accent: '#FD7666',
  },
  {
    emoji: '🔍',
    gradient: 'linear-gradient(135deg, #16213e 0%, #0f3460 100%)',
    accent: '#6C63FF',
  },
  {
    emoji: '🚀',
    gradient: 'linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%)',
    accent: '#FD7666',
  },
];

export const AppIntro = ({ onDone }) => {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

  const slides = SLIDE_THEMES.map((theme, i) => ({
    ...theme,
    subtitle: t(`intro.slide${i + 1}.subtitle`),
    title: t(`intro.slide${i + 1}.title`),
    description: t(`intro.slide${i + 1}.description`),
  }));

  const handleDone = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    if (onDone) onDone();
    else navigate('/home');
  };

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    if (onDone) onDone();
    else navigate('/home');
  };

  const handleNext = () => {
    if (current < slides.length - 1) setCurrent(current + 1);
    else handleDone();
  };

  const slide = slides[current];
  const isLast = current === slides.length - 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: slide.gradient,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between',
      padding: 'env(safe-area-inset-top, 20px) 24px 16px',
      transition: 'background 0.5s ease',
      fontFamily: 'inherit',
    }}>
      {/* Skip button */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', paddingTop: '16px' }}>
        {!isLast && (
          <button
            onClick={handleSkip}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '15px', cursor: 'pointer' }}
          >
            {t('intro.skip')}
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '24px' }}>
        {/* Big emoji */}
        <div style={{
          width: '120px', height: '120px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '36px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '60px',
          boxShadow: `0 0 60px ${slide.accent}40`,
        }}>
          {slide.emoji}
        </div>

        <div>
          <div style={{ color: slide.accent, fontSize: '13px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px' }}>
            {slide.subtitle}
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#fff', margin: '0 0 16px', lineHeight: 1.2 }}>
            {slide.title}
          </h1>
          <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, maxWidth: '320px', margin: '0 auto' }}>
            {slide.description}
          </p>
        </div>
      </div>

      {/* Bottom: dots + button */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
        {/* Dots */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? '24px' : '8px',
                height: '8px',
                borderRadius: '4px',
                background: i === current ? slide.accent : 'rgba(255,255,255,0.3)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={handleNext}
          style={{
            width: '100%',
            maxWidth: '340px',
            padding: '18px',
            borderRadius: '16px',
            background: slide.accent,
            color: '#fff',
            fontSize: '17px',
            fontWeight: '700',
            border: 'none',
            cursor: 'pointer',
            boxShadow: `0 8px 24px ${slide.accent}60`,
          }}
        >
          {isLast ? t('intro.ctaLast') : t('intro.ctaNext')}
        </button>
      </div>
    </div>
  );
};

/** Returns true if the intro hasn't been shown yet. */
export const shouldShowIntro = () => !localStorage.getItem(STORAGE_KEY);

export default AppIntro;
