import React, { useState, useContext, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const NEW_REG_KEY = 'jamie_new_registration';
const INTRO_SEEN_KEY = 'jamie_intro_seen';

const SLIDES = [
  {
    emoji: '🎉',
    title: (name) => name ? `Hey ${name}!` : 'Willkommen!',
    subtitle: 'Du bist jetzt dabei',
    description: 'Dein Konto ist erstellt. JAMIE verbindet dich mit echten Menschen für echte Erlebnisse — spontan, unkompliziert, in deiner Nähe.',
    bg1: '#1a1a2e',
    bg2: '#2d1b69',
    accent: '#FD7666',
    ring: '#FD766640',
  },
  {
    emoji: '🌍',
    title: () => 'Entdecke & Erlebe',
    subtitle: 'Alles, was dich erwartet',
    description: 'Such dir die perfekte Gruppe aus — für einen Abend oder für immer. Chatte, tritt bei, und erlebe Momente, die zählen.',
    bg1: '#0d1b2a',
    bg2: '#1b3a5c',
    accent: '#6C63FF',
    ring: '#6C63FF40',
    items: [
      { icon: '👥', label: 'Gruppen', sub: 'Einmalige Events für 3–10 Personen' },
      { icon: '🏆', label: 'Clubs', sub: 'Dauerhafte Communities' },
      { icon: '💬', label: 'Chats', sub: 'Direkt mit Gleichgesinnten' },
      { icon: '📍', label: 'In der Nähe', sub: 'Events direkt bei dir' },
    ],
  },
  {
    emoji: '👑',
    title: () => 'JAMIE Pro',
    subtitle: 'Nur 5 € pro Monat',
    description: 'Boosts für deine Gruppen & Clubs — kostenlos. Kein Credit-Kauf. Maximale Sichtbarkeit. Jederzeit kündbar.',
    bg1: '#1c1400',
    bg2: '#2a2000',
    accent: '#FFD700',
    ring: '#FFD70040',
    items: [
      { icon: '⚡', label: 'Gruppen boosten', sub: 'Kostenlos & unbegrenzt' },
      { icon: '🏆', label: 'Clubs boosten', sub: 'Mehr Mitglieder gewinnen' },
      { icon: '🔝', label: 'Top-Platzierung', sub: 'Immer ganz oben' },
      { icon: '∞', label: 'Kein Limit', sub: 'Jederzeit kündbar' },
    ],
  },
];

// ── Keyframes injected once ──────────────────────────────────────────────
const STYLE = `
@keyframes wi-pulse {
  0%,100%{transform:scale(1);opacity:1}
  50%{transform:scale(1.06);opacity:.85}
}
@keyframes wi-ring {
  0%{transform:scale(.85);opacity:.6}
  100%{transform:scale(1.5);opacity:0}
}
@keyframes wi-float {
  0%,100%{transform:translateY(0)}
  50%{transform:translateY(-8px)}
}
@keyframes wi-particle {
  0%{transform:translate(0,0) rotate(0deg);opacity:1}
  100%{transform:translate(var(--dx),var(--dy)) rotate(var(--dr));opacity:0}
}
@keyframes wi-enter-r {
  from{transform:translateX(48px);opacity:0}
  to{transform:translateX(0);opacity:1}
}
@keyframes wi-enter-l {
  from{transform:translateX(-48px);opacity:0}
  to{transform:translateX(0);opacity:1}
}
@keyframes wi-badge {
  0%{transform:scale(0) rotate(-10deg)}
  60%{transform:scale(1.12) rotate(2deg)}
  100%{transform:scale(1) rotate(0deg)}
}
`;

const PARTICLES = ['✨','🎊','⭐','💫','🌟','🎉'];

function Particle({ x, y, char, i }) {
  const angle = (i / 6) * 360;
  const dist  = 80 + Math.random() * 60;
  const dx = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
  const dy = Math.round(Math.sin((angle * Math.PI) / 180) * dist - 40);
  return (
    <span style={{
      position: 'absolute',
      left: x, top: y,
      fontSize: '20px',
      pointerEvents: 'none',
      '--dx': `${dx}px`,
      '--dy': `${dy}px`,
      '--dr': `${-45 + Math.random() * 90}deg`,
      animation: `wi-particle 1.2s ease-out ${i * 0.08}s forwards`,
    }}>{char}</span>
  );
}

export const WelcomeIntro = () => {
  const { user } = useContext(AuthContext);
  const navigate    = useNavigate();
  const touchX      = useRef(null);

  const [isNewUser]  = useState(() => localStorage.getItem(NEW_REG_KEY) === '1');
  const [current, setCurrent]   = useState(0);
  const [dir, setDir]           = useState(1);   // 1=forward, -1=back
  const [animKey, setAnimKey]   = useState(0);
  const [showParticles, setShowParticles] = useState(false);

  if (!isNewUser) return <Navigate to="/home" replace />;

  const slide  = SLIDES[current];
  const isLast = current === SLIDES.length - 1;
  const name   = user?.name?.split(' ')[0] || '';

  const goTo = (idx) => {
    if (idx === current) return;
    setDir(idx > current ? 1 : -1);
    setAnimKey(k => k + 1);
    setCurrent(idx);
    if (idx === 0) { setShowParticles(true); setTimeout(() => setShowParticles(false), 1400); }
  };

  const next = () => {
    if (current < SLIDES.length - 1) goTo(current + 1);
    else finish(false);
  };

  const finish = (pro = false) => {
    localStorage.removeItem(NEW_REG_KEY);
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    if (pro) localStorage.setItem('jamie_show_pro_modal', '1');
    navigate('/onboarding', { replace: true });
  };

  // Touch / swipe
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd   = (e) => {
    if (touchX.current === null) return;
    const d = touchX.current - e.changedTouches[0].clientX;
    if (d > 50 && current < SLIDES.length - 1) goTo(current + 1);
    if (d < -50 && current > 0)               goTo(current - 1);
    touchX.current = null;
  };

  const enterAnim = `wi-enter-${dir > 0 ? 'r' : 'l'} 0.32s cubic-bezier(.25,.8,.25,1) both`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: `linear-gradient(160deg, ${slide.bg1} 0%, ${slide.bg2} 100%)`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'space-between',
          padding: 'env(safe-area-inset-top,20px) 24px env(safe-area-inset-bottom,40px)',
          transition: 'background 0.55s ease',
          overflow: 'hidden', userSelect: 'none',
        }}
      >
        {/* Ambient glow top-right */}
        <div style={{
          position:'absolute', width:'320px', height:'320px',
          borderRadius:'50%',
          background:`radial-gradient(circle, ${slide.accent}22 0%, transparent 70%)`,
          top:'-100px', right:'-100px', pointerEvents:'none',
          transition:'background 0.55s ease',
        }} />
        {/* Ambient glow bottom-left */}
        <div style={{
          position:'absolute', width:'220px', height:'220px',
          borderRadius:'50%',
          background:`radial-gradient(circle, ${slide.accent}14 0%, transparent 70%)`,
          bottom:'40px', left:'-60px', pointerEvents:'none',
          transition:'background 0.55s ease',
        }} />

        {/* ── TOP BAR ─────────────────────────────── */}
        <div style={{
          width:'100%', maxWidth:'400px',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          paddingTop:'8px', position:'relative', zIndex:2,
        }}>
          {/* Progress bar */}
          <div style={{ display:'flex', gap:'6px', flex:1 }}>
            {SLIDES.map((_,i) => (
              <div key={i} onClick={() => goTo(i)} style={{
                flex: i===current ? 2 : 1,
                height:'3px', borderRadius:'2px', cursor:'pointer',
                background: i===current ? slide.accent
                  : i < current ? `${slide.accent}60` : 'rgba(255,255,255,0.2)',
                transition:'flex 0.35s ease, background 0.35s ease',
              }} />
            ))}
          </div>
          {!isLast && (
            <button onClick={() => finish(false)} style={{
              marginLeft:'16px', background:'none', border:'none',
              color:'rgba(255,255,255,0.4)', fontSize:'13px',
              cursor:'pointer', padding:'4px 0', whiteSpace:'nowrap',
              fontWeight:'600', letterSpacing:'0.3px',
            }}>
              Überspringen
            </button>
          )}
        </div>

        {/* ── MAIN CONTENT ────────────────────────── */}
        <div
          key={animKey}
          style={{
            flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center',
            textAlign:'center', gap:'20px',
            width:'100%', maxWidth:'400px',
            animation: enterAnim,
            position:'relative', zIndex:2,
          }}
        >
          {/* Icon container */}
          <div style={{ position:'relative', width:'120px', height:'120px' }}>
            {/* Pulse rings */}
            <div style={{
              position:'absolute', inset:'-16px', borderRadius:'50%',
              border:`2px solid ${slide.accent}`,
              animation:`wi-ring 2.2s ease-out infinite`,
            }} />
            <div style={{
              position:'absolute', inset:'-8px', borderRadius:'50%',
              border:`1.5px solid ${slide.accent}60`,
              animation:`wi-ring 2.2s ease-out 0.7s infinite`,
            }} />
            {/* Icon box */}
            <div style={{
              width:'120px', height:'120px', borderRadius:'34px',
              background:`linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))`,
              border:`1.5px solid ${slide.accent}35`,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'58px',
              boxShadow:`0 0 40px ${slide.ring}, 0 20px 50px rgba(0,0,0,0.35)`,
              animation:'wi-float 3.5s ease-in-out infinite',
              backdropFilter:'blur(4px)',
            }}>
              {slide.emoji}
            </div>
            {/* Particles on slide 0 */}
            {current===0 && showParticles && PARTICLES.map((p,i) => (
              <Particle key={i} x="50%" y="50%" char={p} i={i} />
            ))}
          </div>

          {/* Text block */}
          <div style={{ maxWidth:'320px' }}>
            <div style={{
              color: slide.accent,
              fontSize:'10px', fontWeight:'800',
              letterSpacing:'2.5px', textTransform:'uppercase',
              marginBottom:'10px', opacity:0.9,
            }}>
              {slide.subtitle}
            </div>
            <h1 style={{
              fontSize:'32px', fontWeight:'900',
              color:'#fff', margin:'0 0 14px', lineHeight:1.15,
              textShadow:`0 2px 20px ${slide.ring}`,
            }}>
              {slide.title(name)}
            </h1>
            <p style={{
              fontSize:'15px', color:'rgba(255,255,255,0.62)',
              lineHeight:1.7, margin:0,
            }}>
              {slide.description}
            </p>
          </div>

          {/* Feature grid */}
          {slide.items && (
            <div style={{
              display:'grid',
              gridTemplateColumns: current===1 ? '1fr 1fr' : '1fr',
              gap:'10px', width:'100%', marginTop:'4px',
            }}>
              {slide.items.map((item, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', gap:'12px',
                  background: current===2
                    ? `linear-gradient(135deg, ${slide.accent}0D, ${slide.accent}06)`
                    : 'rgba(255,255,255,0.055)',
                  border: current===2
                    ? `1px solid ${slide.accent}28`
                    : '1px solid rgba(255,255,255,0.07)',
                  borderRadius:'14px', padding:'12px 14px',
                  textAlign:'left',
                  animation:`wi-enter-r 0.4s ease ${i*0.07}s both`,
                }}>
                  <div style={{
                    width:'38px', height:'38px', borderRadius:'10px', flexShrink:0,
                    background: current===2
                      ? `${slide.accent}18`
                      : 'rgba(255,255,255,0.06)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize: item.icon==='∞' ? '22px' : '20px',
                    fontWeight:'900',
                    color: current===2 ? slide.accent : 'inherit',
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ color:'#fff', fontSize:'13px', fontWeight:'700', lineHeight:1.2 }}>
                      {item.label}
                    </div>
                    <div style={{ color:'rgba(255,255,255,0.45)', fontSize:'11px', marginTop:'1px', lineHeight:1.3 }}>
                      {item.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── BOTTOM ACTIONS ──────────────────────── */}
        <div style={{
          width:'100%', maxWidth:'400px',
          display:'flex', flexDirection:'column',
          alignItems:'center', gap:'14px',
          position:'relative', zIndex:2,
        }}>
          {/* Dot progress */}
          <div style={{ display:'flex', gap:'7px', alignItems:'center' }}>
            {SLIDES.map((_,i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i===current ? '24px' : '7px',
                height:'7px', borderRadius:'4px',
                background: i===current ? slide.accent : 'rgba(255,255,255,0.22)',
                border:'none', padding:0, cursor:'pointer',
                transition:'all 0.3s cubic-bezier(.4,0,.2,1)',
              }} />
            ))}
          </div>

          {isLast ? (
            <>
              <button
                onClick={() => finish(true)}
                style={{
                  width:'100%', maxWidth:'360px', padding:'15px 24px',
                  borderRadius:'var(--radius-full,999px)', border:'none',
                  background:`linear-gradient(135deg, #FFD700 0%, #FFAA00 100%)`,
                  color:'#1a1100', fontSize:'15px', fontWeight:'800',
                  cursor:'pointer', letterSpacing:'0.2px',
                  boxShadow:`0 8px 24px ${slide.accent}44, 0 2px 8px rgba(0,0,0,0.3)`,
                  animation:'wi-badge 0.5s cubic-bezier(.34,1.56,.64,1) both',
                }}
              >
                👑 Pro jetzt aktivieren — 5 € / Monat
              </button>
              <button
                onClick={() => finish(false)}
                style={{
                  background:'none', border:'none',
                  color:'rgba(255,255,255,0.35)', fontSize:'13px',
                  cursor:'pointer', padding:'2px',
                  letterSpacing:'0.2px',
                }}
              >
                Ohne Pro weitermachen
              </button>
            </>
          ) : (
            <button
              onClick={next}
              style={{
                width:'100%', maxWidth:'360px', padding:'15px 24px',
                borderRadius:'var(--radius-full,999px)', border:'none',
                background: slide.accent,
                color:'#fff', fontSize:'15px', fontWeight:'700',
                cursor:'pointer',
                boxShadow:`0 8px 24px ${slide.accent}44, 0 2px 8px rgba(0,0,0,0.2)`,
              }}
            >
              {current===0 ? "Los geht's ✨" : 'Weiter'}
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default WelcomeIntro;
