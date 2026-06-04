import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { waitlist as waitlistApi } from '../utils/api';

// Summer solstice 2026 — international launch target
const LAUNCH_DATE = new Date('2026-06-21T00:00:00');

const COUNTRY_CODES = [
  { code: 'DE', flag: '🇩🇪' },
  { code: 'CH', flag: '🇨🇭' },
  { code: 'IT', flag: '🇮🇹' },
  { code: 'CZ', flag: '🇨🇿' },
  { code: 'HU', flag: '🇭🇺' },
  { code: 'SK', flag: '🇸🇰' },
  { code: 'SI', flag: '🇸🇮' },
  { code: 'HR', flag: '🇭🇷' },
  { code: 'PL', flag: '🇵🇱' },
  { code: 'NL', flag: '🇳🇱' },
  { code: 'FR', flag: '🇫🇷' },
  { code: 'ES', flag: '🇪🇸' },
  { code: 'GB', flag: '🇬🇧' },
  { code: 'US', flag: '🇺🇸' },
  { code: 'OTHER', flag: '🌍' },
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
  const { t } = useTranslation();
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
      setError(err.response?.data?.error || t('outOfRegion.errorGeneric'));
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
          <h2 className="oor-title">{t('outOfRegion.title')}</h2>
          <p className="oor-subtitle">
            {t('outOfRegion.subtitleLine1')}<br />
            {t('outOfRegion.subtitleLine2')}
          </p>
        </div>

        {/* Countdown */}
        {countdown && (
          <div className="oor-countdown">
            {[
              { val: countdown.d, label: t('outOfRegion.countdown.days') },
              { val: String(countdown.h).padStart(2, '0'), label: t('outOfRegion.countdown.hours') },
              { val: String(countdown.m).padStart(2, '0'), label: t('outOfRegion.countdown.minutes') },
              { val: String(countdown.s).padStart(2, '0'), label: t('outOfRegion.countdown.seconds') },
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
            <p className="oor-form-title">{t('outOfRegion.formTitle')}</p>
            <input
              className="oor-input"
              type="email"
              placeholder={t('outOfRegion.emailPlaceholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            {error && <p className="oor-error">{error}</p>}
            <button className="oor-submit-btn" type="submit" disabled={loading}>
              {loading ? t('outOfRegion.submitting') : t('outOfRegion.submit')}
            </button>
          </form>
        ) : (
          <div className="oor-success">
            <div className="oor-success-icon">✓</div>
            <p>{t('outOfRegion.successText')}</p>
          </div>
        )}

        {/* Country vote */}
        <div className="oor-vote-section">
          <p className="oor-vote-title">{t('outOfRegion.voteTitle')}</p>
          <div className="oor-countries">
            {COUNTRY_CODES.map(c => (
              <button
                key={c.code}
                type="button"
                className={`oor-country-btn${selectedCountry === c.code ? ' selected' : ''}`}
                onClick={() => setSelectedCountry(prev => prev === c.code ? null : c.code)}
              >
                {c.flag} {t(`outOfRegion.countries.${c.code}`)}
              </button>
            ))}
          </div>

          {/* Live results bar chart */}
          {votes.length > 0 && (
            <div className="oor-results">
              <p className="oor-results-title">{t('outOfRegion.votesTitle', { count: totalVotes })}</p>
              {votes.slice(0, 6).map(v => {
                const c = COUNTRY_CODES.find(x => x.code === v.country);
                const pct = totalVotes ? Math.round((v.votes / totalVotes) * 100) : 0;
                return (
                  <div key={v.country} className="oor-bar-row">
                    <span className="oor-bar-label">
                      {c?.flag ?? '🌍'} {c ? t(`outOfRegion.countries.${c.code}`) : v.country}
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
          {t('outOfRegion.footerPrefix')}{' '}
          <button
            className="oor-footer-link"
            onClick={() => { sessionStorage.removeItem('jamie_region'); window.location.reload(); }}
          >
            {t('outOfRegion.footerLink')}
          </button>
        </p>
      </div>
    </div>
  );
}
