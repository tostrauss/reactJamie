import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SLIDES = [
  {
    emoji: '👋',
    title: 'Willkommen bei JAMIE',
    subtitle: 'Deine App für echte Begegnungen',
    description: 'JAMIE verbindet dich mit Menschen in deiner Nähe, die dieselben Aktivitäten lieben wie du — spontan, einfach und ohne Schnickschnack.',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    accent: '#FD7666',
  },
  {
    emoji: '🔍',
    title: 'Entdecke Gruppen & Clubs',
    subtitle: 'Von Sport bis Kochen',
    description: 'Finde Gruppen für einmalige Events oder tritt dauerhaften Clubs bei. Filtere nach Kategorie, Datum und Ort — und finde Leute, die wirklich passen.',
    gradient: 'linear-gradient(135deg, #16213e 0%, #0f3460 100%)',
    accent: '#6C63FF',
  },
  {
    emoji: '🚀',
    title: 'Verbinde dich & starte durch',
    subtitle: 'Erstelle. Tritt bei. Erlebe.',
    description: 'Erstelle deine eigene Gruppe, lade Freunde ein und erlebe unvergessliche Momente. Boost deine Gruppe, um noch mehr Leute zu erreichen!',
    gradient: 'linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%)',
    accent: '#FD7666',
  },
];

const STORAGE_KEY = 'jamie_intro_seen';

export const AppIntro = ({ onDone }) => {
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();

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
    if (current < SLIDES.length - 1) setCurrent(current + 1);
    else handleDone();
  };

  const slide = SLIDES[current];
  const isLast = current === SLIDES.length - 1;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: slide.gradient,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'space-between',
      padding: 'env(safe-area-inset-top, 20px) 24px env(safe-area-inset-bottom, 40px)',
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
            Überspringen
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
          {SLIDES.map((_, i) => (
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
          {isLast ? "Los geht's! 🚀" : 'Weiter'}
        </button>
      </div>
    </div>
  );
};

/** Returns true if the intro hasn't been shown yet. */
export const shouldShowIntro = () => !localStorage.getItem(STORAGE_KEY);

export default AppIntro;
