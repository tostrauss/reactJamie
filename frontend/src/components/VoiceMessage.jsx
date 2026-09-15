import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Playback for a voice message bubble.
 *
 * Deliberately NOT a bare <audio controls>: the native control is a full-width
 * grey bar that looks nothing like the rest of the chat, sizes differently on
 * every platform, and on iOS opens its own scrubber. This is play/pause, a
 * progress track and a duration — which is all a 20-second voice note needs.
 *
 * `durationMs` comes from the message row, recorded at capture time, so the
 * bubble can size and label itself BEFORE the audio is fetched. The element's
 * own metadata takes over once it loads, because a stream is the more
 * trustworthy source once we have it — WebM from MediaRecorder famously
 * reports Infinity for duration until fully buffered, which is exactly why the
 * stored value exists.
 *
 * Audio is loaded lazily (preload="none"): a chat full of voice notes must not
 * fetch every one of them on open.
 */
const fmt = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function VoiceMessage({ url, durationMs, mine = false }) {
  const { t } = useTranslation();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [loadedMs, setLoadedMs] = useState(null);
  const [failed, setFailed] = useState(false);

  const totalMs = loadedMs ?? durationMs ?? 0;
  const progress = totalMs > 0 ? Math.min(100, (positionMs / totalMs) * 100) : 0;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onTime = () => setPositionMs(el.currentTime * 1000);
    const onMeta = () => {
      // Infinity / NaN: the classic MediaRecorder-WebM case. Keep the stored
      // duration rather than rendering a broken track.
      const d = el.duration * 1000;
      if (Number.isFinite(d) && d > 0) setLoadedMs(d);
    };
    const onEnd = () => { setPlaying(false); setPositionMs(0); el.currentTime = 0; };
    const onErr = () => { setFailed(true); setPlaying(false); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
  }, []);

  const toggle = async (e) => {
    // The bubble itself has a long-press handler for reply/report — a tap on
    // the play button must not also open that sheet.
    e.stopPropagation();
    const el = audioRef.current;
    if (!el || failed) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    // Pause any other voice note first: two overlapping voices is never what
    // someone meant, and on mobile the second one just muddles the first.
    document.querySelectorAll('audio[data-voice]').forEach((a) => { if (a !== el) a.pause(); });
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setFailed(true);
    }
  };

  const seek = (e) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el || failed || !totalMs) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = (ratio * totalMs) / 1000;
    setPositionMs(ratio * totalMs);
  };

  if (failed) {
    return <div className={`voice-msg voice-msg--failed${mine ? ' voice-msg--mine' : ''}`}>{t('chat.voice.unavailable')}</div>;
  }

  return (
    <div className={`voice-msg${mine ? ' voice-msg--mine' : ''}`}>
      <audio ref={audioRef} src={url} preload="none" data-voice />
      <button
        type="button"
        className="voice-msg-play"
        onClick={toggle}
        aria-label={t(playing ? 'chat.voice.pause' : 'chat.voice.play')}
      >
        {playing ? (
          <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true">
            <rect x="1" y="1" width="4" height="14" rx="1.2" />
            <rect x="9" y="1" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true">
            <path d="M2 1.6c0-.9 1-1.5 1.8-1l8.4 5.4c.7.5.7 1.5 0 2L3.8 15.4c-.8.5-1.8-.1-1.8-1V1.6z" />
          </svg>
        )}
      </button>

      {/* Static bars rather than a real waveform: computing one means decoding
          the whole file client-side, which defeats preload="none" and costs
          more than the decoration is worth. The progress fill is the honest
          part and it sits on top. */}
      <div className="voice-msg-track" onClick={seek} role="presentation">
        <div className="voice-msg-bars" aria-hidden="true">
          {VOICE_BARS.map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="voice-msg-progress" style={{ width: `${progress}%` }} />
      </div>

      <span className="voice-msg-time">
        {fmt(playing || positionMs > 0 ? totalMs - positionMs : totalMs)}
      </span>
    </div>
  );
}

// Fixed pseudo-waveform. Same shape for every message on purpose — it is a
// texture that says "this is audio", not data.
const VOICE_BARS = [38, 62, 45, 80, 55, 95, 70, 48, 85, 60, 40, 72, 52, 88, 44, 66, 35, 78, 50, 30];

export default VoiceMessage;
