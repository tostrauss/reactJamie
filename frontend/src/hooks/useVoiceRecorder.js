import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Microphone recording for voice messages.
 *
 * Format is whatever the browser can actually produce, in preference order:
 * Chrome and Android Chrome give us Opus in WebM (small, ideal for speech);
 * iOS WKWebView and Safari give us AAC in MP4. We record and upload that
 * as-is — no transcoding. Running ffmpeg on the API container during a signup
 * wave is exactly the CPU the upload semaphore exists to avoid, and both
 * formats play natively on every browser that can record them.
 *
 * iOS note: getUserMedia works in WKWebView from iOS 14.3, but ONLY when the
 * app declares NSMicrophoneUsageDescription — added in ios/4-preflight.sh. It
 * therefore needs an iOS rebuild; web and the Android TWA work immediately.
 *
 * The recorder auto-stops at MAX_MS so a forgotten recording cannot grow
 * unbounded in memory or hit the server's own size cap as a failed upload.
 */
export const MAX_VOICE_MS = 120_000;   // mirrors MAX_VOICE_MS in uploadRoutes.js

// First supported wins. isTypeSupported is absent on old Safari — treat that
// as "let MediaRecorder pick its default" rather than refusing to record.
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
};

export const isVoiceRecordingSupported = () =>
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  !!navigator?.mediaDevices?.getUserMedia;

export function useVoiceRecorder({ onAutoStop } = {}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  // 'idle' | 'denied' | 'unsupported' | 'failed'
  const [error, setError] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  const autoStopRef = useRef(null);
  // Set when the user cancels, so the stop handler discards instead of resolving.
  const cancelledRef = useRef(false);
  const resolveRef = useRef(null);
  // Kept in a ref so the ONE onstop handler installed at start() always sees
  // the current callback without being re-installed.
  const onAutoStopRef = useRef(onAutoStop);
  onAutoStopRef.current = onAutoStop;

  // Release the mic. Leaving the track live keeps the OS recording indicator on
  // and, on iOS, keeps the audio session ducked — users read both as "the app
  // is still listening".
  const teardown = useCallback(() => {
    clearInterval(tickRef.current);
    clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    if (recording) return false;
    setError(null);
    if (!isVoiceRecordingSupported()) { setError('unsupported'); return false; }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      // NotAllowedError covers both "denied now" and "denied permanently";
      // either way the user-facing answer is the same.
      setError(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'failed');
      return false;
    }

    try {
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.onerror = () => { setError('failed'); };

      // Installed ONCE, here — not inside stop(). It used to be assigned in
      // stop(), which meant the 2-minute auto-stop below fired with no handler
      // at all: the recorder went inactive, the hook stayed stuck showing
      // "recording", and the user's two-minute message was silently dropped
      // (caught by ChatComposer.test.jsx).
      rec.onstop = () => {
        const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_VOICE_MS);
        const chunks = chunksRef.current;
        const mimeType = rec.mimeType || chunks[0]?.type || 'audio/webm';
        const cancelled = cancelledRef.current;
        const blob = chunks.length ? new Blob(chunks, { type: mimeType }) : null;
        // Under ~700ms is a mis-tap, not a message.
        const tooShort = durationMs < 700;
        const result = cancelled || !blob || tooShort ? null : { blob, mimeType, durationMs };

        teardown();
        setRecording(false);
        setElapsedMs(0);

        if (resolveRef.current) {
          // A stop()/cancel() call is awaiting this.
          resolveRef.current(result);
          resolveRef.current = null;
        } else if (result) {
          // Nobody asked — this was the cap firing. Hand the recording to the
          // caller rather than dropping it: the user was mid-sentence, and
          // losing two minutes of speech is the worse surprise.
          onAutoStopRef.current?.(result);
        }
      };

      recorderRef.current = rec;
      streamRef.current = stream;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setRecording(true);

      // 200ms timeslice: without one, some browsers only emit data at stop,
      // and a tab killed mid-recording loses everything.
      rec.start(200);

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 100);
      autoStopRef.current = setTimeout(() => {
        // Auto-stop SENDS rather than discards — the user was speaking, and
        // throwing away two minutes of their message would be the worse
        // surprise. The UI counts down so this is not a shock.
        recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      }, MAX_VOICE_MS);
      return true;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError('failed');
      return false;
    }
  }, [recording]);

  /**
   * Stop and resolve with { blob, mimeType, durationMs }, or null if the
   * recording was cancelled or produced nothing.
   */
  const stop = useCallback(() => new Promise((resolve) => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') { resolve(null); return; }
    resolveRef.current = resolve;
    rec.stop();   // the handler installed in start() does the rest
  }), []);

  /** Stop and throw the recording away. */
  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    await stop();
  }, [stop]);

  return {
    recording,
    elapsedMs,
    remainingMs: Math.max(0, MAX_VOICE_MS - elapsedMs),
    error,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}

export default useVoiceRecorder;
