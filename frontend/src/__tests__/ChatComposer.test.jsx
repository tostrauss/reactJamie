import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ChatComposer } from '../components/ChatComposer';
import { VoiceMessage } from '../components/VoiceMessage';
import { MessageQuote } from '../components/MessageQuote';

// The composer and its children only ever render t() output; echoing the key
// back keeps the assertions about BEHAVIOUR rather than about German copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, vars) => (vars?.seconds != null ? `${key}:${vars.seconds}` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

// ── MediaRecorder / getUserMedia doubles ───────────────────────────────────
class FakeRecorder {
  static isTypeSupported = () => true;
  constructor(stream, opts) {
    this.stream = stream;
    this.mimeType = opts?.mimeType || 'audio/webm';
    this.state = 'inactive';
    FakeRecorder.last = this;
  }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    // Real recorders flush a final chunk before firing onstop.
    this.ondataavailable?.({ data: new Blob(['x'.repeat(64)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const mkTrack = () => ({ stop: vi.fn() });

const installMediaMocks = ({ deny = false } = {}) => {
  globalThis.MediaRecorder = FakeRecorder;
  const track = mkTrack();
  navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => {
      if (deny) {
        const err = new Error('denied');
        err.name = 'NotAllowedError';
        throw err;
      }
      return { getTracks: () => [track] };
    }),
  };
  return { track };
};

const baseProps = {
  value: '',
  onChange: vi.fn(),
  onSend: vi.fn(),
  onSendVoice: vi.fn(),
  placeholder: 'schreib was',
};

describe('ChatComposer', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete globalThis.MediaRecorder; delete navigator.mediaDevices; });

  it('offers the MIC while empty and SEND once something is typed', () => {
    installMediaMocks();
    const { rerender } = render(<ChatComposer {...baseProps} />);
    expect(screen.getByLabelText('chat.voice.record')).toBeTruthy();
    expect(screen.queryByLabelText('chat.send')).toBeNull();

    rerender(<ChatComposer {...baseProps} value="hallo" />);
    expect(screen.getByLabelText('chat.send')).toBeTruthy();
    expect(screen.queryByLabelText('chat.voice.record')).toBeNull();
  });

  it('hides the mic entirely where recording is impossible', () => {
    // No MediaRecorder at all — an always-failing button is worse than none.
    render(<ChatComposer {...baseProps} />);
    expect(screen.queryByLabelText('chat.voice.record')).toBeNull();
    expect(screen.getByLabelText('chat.send')).toBeTruthy();
  });

  it('records, then hands the blob and its duration to onSendVoice', async () => {
    installMediaMocks();
    vi.useFakeTimers();
    try {
      const onSendVoice = vi.fn();
      render(<ChatComposer {...baseProps} onSendVoice={onSendVoice} />);

      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.record')); });
      expect(screen.getByLabelText('chat.voice.send')).toBeTruthy();
      expect(screen.getByLabelText('chat.voice.discard')).toBeTruthy();

      // Past the 700ms mis-tap floor.
      await act(async () => { vi.advanceTimersByTime(3000); });
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.send')); });

      expect(onSendVoice).toHaveBeenCalledTimes(1);
      const arg = onSendVoice.mock.calls[0][0];
      expect(arg.blob).toBeInstanceOf(Blob);
      expect(arg.mimeType).toBe('audio/webm;codecs=opus');   // Opus preferred where supported
      expect(arg.durationMs).toBeGreaterThanOrEqual(3000);
    } finally { vi.useRealTimers(); }
  });

  it('discards a recording without sending, and releases the microphone', async () => {
    const { track } = installMediaMocks();
    vi.useFakeTimers();
    try {
      const onSendVoice = vi.fn();
      render(<ChatComposer {...baseProps} onSendVoice={onSendVoice} />);
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.record')); });
      await act(async () => { vi.advanceTimersByTime(3000); });
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.discard')); });

      expect(onSendVoice).not.toHaveBeenCalled();
      // A live track keeps the OS recording indicator on — users read that as
      // "the app is still listening".
      expect(track.stop).toHaveBeenCalled();
      expect(screen.getByLabelText('chat.voice.record')).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('drops a mis-tap that is under the minimum length', async () => {
    installMediaMocks();
    vi.useFakeTimers();
    try {
      const onSendVoice = vi.fn();
      render(<ChatComposer {...baseProps} onSendVoice={onSendVoice} />);
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.record')); });
      await act(async () => { vi.advanceTimersByTime(200); });
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.send')); });
      expect(onSendVoice).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('auto-stops at the two-minute cap and SENDS what was recorded', async () => {
    installMediaMocks();
    vi.useFakeTimers();
    try {
      const onSendVoice = vi.fn();
      render(<ChatComposer {...baseProps} onSendVoice={onSendVoice} />);
      await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.record')); });
      // The cap fires on its own — no tap. It must SEND, not discard: throwing
      // away two minutes of someone's message is the worse surprise.
      await act(async () => { vi.advanceTimersByTime(121_000); });
      expect(onSendVoice).toHaveBeenCalledTimes(1);
      // ...and the UI must leave the recording state, not stay stuck in it.
      expect(screen.getByLabelText('chat.voice.record')).toBeTruthy();
      expect(onSendVoice.mock.calls[0][0].durationMs).toBeLessThanOrEqual(120_000);
    } finally { vi.useRealTimers(); }
  });

  it('explains a denied microphone instead of failing silently', async () => {
    installMediaMocks({ deny: true });
    render(<ChatComposer {...baseProps} />);
    await act(async () => { fireEvent.click(screen.getByLabelText('chat.voice.record')); });
    expect(screen.getByRole('alert').textContent).toBe('chat.voice.denied');
    // ...and it did not get stuck in the recording state.
    expect(screen.getByLabelText('chat.voice.record')).toBeTruthy();
  });

  it('shows the reply quote and can cancel it', () => {
    installMediaMocks();
    const onCancelReply = vi.fn();
    render(
      <ChatComposer
        {...baseProps}
        replyTo={{ id: 7, user_name: 'Tina', content: 'Wann treffen wir uns?' }}
        onCancelReply={onCancelReply}
      />
    );
    expect(screen.getByText('Tina')).toBeTruthy();
    expect(screen.getByText('Wann treffen wir uns?')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('chat.reply.cancel'));
    expect(onCancelReply).toHaveBeenCalled();
  });

  it('quotes a voice message by label, never by its URL', () => {
    installMediaMocks();
    render(
      <ChatComposer
        {...baseProps}
        replyTo={{ id: 8, user_name: 'Tina', content: '/media/uploads/a.webm', message_type: 'voice' }}
        onCancelReply={vi.fn()}
      />
    );
    expect(screen.getByText('chat.voice.label')).toBeTruthy();
    expect(screen.queryByText('/media/uploads/a.webm')).toBeNull();
  });
});

describe('VoiceMessage', () => {
  it('shows the stored duration before any audio is loaded', () => {
    const { container } = render(<VoiceMessage url="/media/uploads/a.webm" durationMs={83_000} />);
    // 1:23 — from the row, so the bubble is right before the fetch happens.
    expect(screen.getByText('1:23')).toBeTruthy();
    const audio = container.querySelector('audio');
    // A chat full of voice notes must not fetch all of them on open.
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.getAttribute('src')).toBe('/media/uploads/a.webm');
  });

  it('falls back to 0:00 rather than NaN when the duration is unknown', () => {
    render(<VoiceMessage url="/media/uploads/a.webm" durationMs={null} />);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('says so when the audio cannot be loaded', async () => {
    const { container } = render(<VoiceMessage url="/media/uploads/gone.webm" durationMs={5000} />);
    await act(async () => { fireEvent.error(container.querySelector('audio')); });
    await waitFor(() => expect(screen.getByText('chat.voice.unavailable')).toBeTruthy());
  });
});

describe('MessageQuote', () => {
  it('jumps to the original on tap', () => {
    const onJump = vi.fn();
    render(<MessageQuote quote={{ id: 3, user_name: 'Tina', content: 'hi' }} onJump={onJump} />);
    fireEvent.click(screen.getByText('hi'));
    expect(onJump).toHaveBeenCalled();
  });

  it('labels a quote whose original is gone', () => {
    render(<MessageQuote quote={{ id: 3, user_name: 'Tina', content: null }} onJump={vi.fn()} />);
    expect(screen.getByText('chat.reply.deleted')).toBeTruthy();
  });

  it('renders nothing without a quote', () => {
    const { container } = render(<MessageQuote quote={null} />);
    expect(container.firstChild).toBeNull();
  });
});
