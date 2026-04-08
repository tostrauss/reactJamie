import { useState, useEffect } from 'react';
import { waitlist as waitlistApi } from '../utils/api';

// Summer solstice 2026 — international launch target
const LAUNCH_DATE = new Date('2026-06-21T00:00:00');

const COUNTRIES = [
  { code: 'DE', flag: '🇩🇪', name: 'Deutschland' },
  { code: 'CH', flag: '🇨🇭', name: 'Schweiz' },
  { code: 'IT', flag: '🇮🇹', name: 'Italien' },
  { code: 'CZ', flag: '🇨🇿', name: 'Tschechien' },
  { code: 'HU', flag: '🇭🇺', name: 'Ungarn' },
  { code: 'SK', flag: '🇸🇰', name: 'Slowakei' },
  { code: 'SI', flag: '🇸🇮', name: 'Slowenien' },
  { code: 'HR', flag: '🇭🇷', name: 'Kroatien' },
  { code: 'PL', flag: '🇵🇱', name: 'Polen' },
  { code: 'NL', flag: '🇳🇱', name: 'Niederlande' },
  { code: 'FR', flag: '🇫🇷', name: 'Frankreich' },
  { code: 'ES', flag: '🇪🇸', name: 'Spanien' },
  { code: 'GB', flag: '🇬🇧', name: 'UK' },
  { code: 'US', flag: '🇺🇸', name: 'USA' },
  { code: 'OTHER', flag: '🌍', name: 'Anderes' },
];

function useCountdown(target) {
  const [time, setTime] = useState(null);
  useEffect(() => {
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setTime(null); return; }
      setTime({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  return time;
}

export default function OutOfRegion() {
  const [email, setEmail]                   = useState('');
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [votes, setVotes]                   = useState([]);
  const [step, setStep]                     = useState('form'); // 'form' | 'success'
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const countdown = useCountdown(LAUNCH_DATE);

  useEffect(() => {
    waitlistApi.getVotes().then(r => setVotes(r.data)).catch(() => {});
  }, []);

  const totalVotes = votes.reduce((s, v) => s + v.votes, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      await waitlistApi.join(email, selectedCountry);
      const r = await waitlistApi.getVotes().catch(() => ({ data: votes }));
      setVotes(r.data);
      setStep('success');
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="oor-container">
      {/* Ambient background glow */}
      <div className="oor-glow oor-glow-1" />
      <div className="oor-glow oor-glow-2" />

      <div className="oor-content">
        <h1 className="oor-logo">jamie</h1>

        <div className="oor-hero">
          <div className="oor-globe">🌍</div>
          <h2 className="oor-title">Bald auch bei dir!</h2>
          <p className="oor-subtitle">
            JAMIE startet gerade in Österreich.<br />
            Dein Land kommt als Nächstes — bleib dran.
          </p>
        </div>

        {/* Countdown */}
        {countdown && (
          <div className="oor-countdown">
            {[
              { val: countdown.d, label: 'Tage' },
              { val: String(countdown.h).padStart(2, '0'), label: 'Std' },
              { val: String(countdown.m).padStart(2, '0'), label: 'Min' },
              { val: String(countdown.s).padStart(2, '0'), label: 'Sek' },
            ].map((item, i, arr) => (
              <>
                <div key={item.label} className="oor-cd-block">
                  <span className="oor-cd-num">{item.val}</span>
                  <span className="oor-cd-label">{item.label}</span>
                </div>
                {i < arr.length - 1 && <span key={`sep-${i}`} className="oor-cd-sep">:</span>}
              </>
            ))}
          </div>
        )}

        {/* Waitlist form / success */}
        {step === 'form' ? (
          <form className="oor-form" onSubmit={handleSubmit}>
            <p className="oor-form-title">Trag dich auf die Warteliste ein</p>
            <input
              className="oor-input"
              type="email"
              placeholder="deine@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            {error && <p className="oor-error">{error}</p>}
            <button className="oor-submit-btn" type="submit" disabled={loading}>
              {loading ? 'Speichern…' : 'Benachrichtige mich 🔔'}
            </button>
          </form>
        ) : (
          <div className="oor-success">
            <div className="oor-success-icon">✓</div>
            <p>Du bist auf der Liste! Wir melden uns, sobald JAMIE bei dir startet.</p>
          </div>
        )}

        {/* Country vote */}
        <div className="oor-vote-section">
          <p className="oor-vote-title">🗳️ Wo sollen wir als Nächstes starten?</p>
          <div className="oor-countries">
            {COUNTRIES.map(c => (
              <button
                key={c.code}
                type="button"
                className={`oor-country-btn${selectedCountry === c.code ? ' selected' : ''}`}
                onClick={() => setSelectedCountry(prev => prev === c.code ? null : c.code)}
              >
                {c.flag} {c.name}
              </button>
            ))}
          </div>

          {/* Live results bar chart */}
          {votes.length > 0 && (
            <div className="oor-results">
              <p className="oor-results-title">Aktuelle Abstimmung ({totalVotes} Stimmen)</p>
              {votes.slice(0, 6).map(v => {
                const c = COUNTRIES.find(x => x.code === v.country);
                const pct = totalVotes ? Math.round((v.votes / totalVotes) * 100) : 0;
                return (
                  <div key={v.country} className="oor-bar-row">
                    <span className="oor-bar-label">
                      {c?.flag ?? '🌍'} {c?.name ?? v.country}
                    </span>
                    <div className="oor-bar-track">
                      <div className="oor-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="oor-bar-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="oor-footer">
          Schon in Österreich?{' '}
          <button
            className="oor-footer-link"
            onClick={() => { sessionStorage.removeItem('jamie_region'); window.location.reload(); }}
          >
            App öffnen
          </button>
        </p>
      </div>
    </div>
  );
}
