import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useVoiceRecorder, { isVoiceRecordingSupported, MAX_VOICE_MS } from '../hooks/useVoiceRecorder';

/**
 * The message input row, shared by the group chat and DMs.
 *
 * Both screens had their own near-identical copy of this markup. Voice
 * recording and the reply-quote bar would have made that two copies of three
 * interacting states, so it is one component now — the shape of the bug the
 * audit kept finding elsewhere in this codebase.
 *
 * Three states:
 *   idle       — textarea + mic (or send, once something is typed)
 *   recording  — timer, cancel, send
 *   replying   — a quote bar above the input; the mic and send both carry it
 *
 * Voice recording is hidden rather than shown-and-broken where the browser
 * cannot record (no MediaRecorder, or an iOS build without the microphone
 * permission string): a button that always fails is worse than no button.
 */
const fmtDuration = (ms) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function ChatComposer({
  value,
  onChange,
  onSend,
  onSendVoice,
  onSendPhoto,
  disabled = false,
  placeholder,
  replyTo,
  onCancelReply,
  voiceEnabled = true,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  // onAutoStop fires when the 2-minute cap is reached without the user tapping
  // send. It SENDS rather than discards — see the hook.
  const { recording, elapsedMs, remainingMs, error, start, stop, cancel, clearError } =
    useVoiceRecorder({ onAutoStop: (result) => onSendVoice(result) });

  const canRecord = voiceEnabled && !disabled && isVoiceRecordingSupported();
  const hasText = value.trim().length > 0;

  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleSend = (e) => {
    e?.preventDefault?.();
    onSend();
    // Reset the textarea's grown height along with its content.
    requestAnimationFrame(autoGrow);
  };

  // `capture` is deliberately NOT set: on a phone the plain picker offers both
  // the camera and the library, while capture="environment" forces the camera
  // and takes the (much commoner) "send a photo I already have" case away.
  const handlePhotoPicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // same file twice in a row must still fire
    if (file) onSendPhoto?.(file);
  };

  const handleMicDown = async () => {
    clearError();
    await start();
  };

  const finishRecording = async () => {
    const result = await stop();
    if (result) onSendVoice(result);
  };

  // The last 10 seconds count down — the recorder auto-stops at the cap and
  // SENDS, so the user needs to see it coming.
  const showCountdown = remainingMs <= 10_000;

  return (
    <div className="composer">
      {replyTo && (
        <div className="composer-reply">
          <div className="composer-reply-body">
            <span className="composer-reply-name">{replyTo.user_name || t('chat.reply.unknownAuthor')}</span>
            <span className="composer-reply-text">
              {replyTo.message_type === 'voice' ? t('chat.voice.label')
                : replyTo.message_type === 'image' ? t('chat.photo.label')
                : (replyTo.content || '').slice(0, 120)}
            </span>
          </div>
          <button
            type="button"
            className="composer-reply-cancel"
            onClick={onCancelReply}
            aria-label={t('chat.reply.cancel')}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="composer-hint" role="alert">
          {t(error === 'denied' ? 'chat.voice.denied' : 'chat.voice.failed')}
        </div>
      )}

      {recording ? (
        <div className="composer-row composer-row--recording">
          <button
            type="button"
            className="composer-icon-btn composer-icon-btn--cancel"
            onClick={cancel}
            aria-label={t('chat.voice.discard')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>

          <div className="composer-recording">
            <span className="composer-rec-dot" aria-hidden="true" />
            <span className="composer-rec-time">{fmtDuration(elapsedMs)}</span>
            {showCountdown && (
              <span className="composer-rec-left">
                {t('chat.voice.secondsLeft', { seconds: Math.ceil(remainingMs / 1000) })}
              </span>
            )}
          </div>

          <button
            type="button"
            className="composer-send"
            onClick={finishRecording}
            aria-label={t('chat.voice.send')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      ) : (
        <form className="composer-row" onSubmit={handleSend}>
          {onSendPhoto && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handlePhotoPicked}
              />
              <button
                type="button"
                className="composer-icon-btn"
                onClick={() => fileRef.current?.click()}
                disabled={disabled}
                aria-label={t('chat.photo.send')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9a2 2 0 0 1 2-2h1.5l1-2h7l1 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
                  <circle cx="11.5" cy="13" r="3.2" />
                </svg>
              </button>
            </>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            className="composer-input"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onChange={(e) => { onChange(e.target.value); autoGrow(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
            }}
          />

          {hasText || !canRecord ? (
            <button type="submit" className="composer-send" disabled={!hasText || disabled} aria-label={t('chat.send')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="composer-send composer-send--mic"
              onClick={handleMicDown}
              aria-label={t('chat.voice.record')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
              </svg>
            </button>
          )}
        </form>
      )}
    </div>
  );
}

export { MAX_VOICE_MS };
export default ChatComposer;
