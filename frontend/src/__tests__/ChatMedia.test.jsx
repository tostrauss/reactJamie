import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ImageMessage } from '../components/ImageMessage';
import { mediaUrl } from '../utils/chatMedia';
import { chatImageUrl, thumbUrl } from '../utils/images';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

describe('mediaUrl (content stays human-readable, 2026-09-15)', () => {
  // Voice/photo rows used to put the storage URL straight into `content`, which
  // every client predating the feature renders verbatim — and the iOS app
  // bundles the web build, so iPhones kept the old renderer and showed a raw
  // https://…/media/uploads/….webm text bubble. The payload now lives in
  // media_url and `content` is always something a person can read.
  it('prefers media_url over content', () => {
    expect(mediaUrl({ media_url: '/media/uploads/a.webm', content: '🎤 Sprachnachricht' }))
      .toBe('/media/uploads/a.webm');
  });

  it('falls back to content for rows written before the split', () => {
    // The migration backfills these, but the renderer must not depend on the
    // migration having run — and an optimistic bubble also lands here.
    expect(mediaUrl({ content: '/media/uploads/old.webm' })).toBe('/media/uploads/old.webm');
  });

  it('never returns undefined/null for a malformed row', () => {
    expect(mediaUrl(null)).toBe('');
    expect(mediaUrl({})).toBe('');
  });
});

describe('ImageMessage variant (chat photos are not cropped)', () => {
  it('requests ?size=chat, NOT the square ?size=thumb crop', () => {
    // thumbUrl serves the 320x320 `fit: cover` square built for card tiles. On
    // a chat photo it removed ~25% of a portrait and most of a 9:16 screenshot,
    // and the bubble CSS then cropped what was left a second time.
    const { container } = render(
      <ImageMessage url="https://app.jamie-app.com/media/uploads/p.webp" onOpen={() => {}} />
    );
    const src = container.querySelector('img').getAttribute('src');
    expect(src).toBe('https://app.jamie-app.com/media/uploads/p.webp?size=chat');
    expect(src).not.toContain('size=thumb');
  });

  it('hands the lightbox the ORIGINAL url, not the downscaled variant', () => {
    const onOpen = vi.fn();
    const url = 'https://app.jamie-app.com/media/uploads/p.webp';
    const { container } = render(<ImageMessage url={url} onOpen={onOpen} />);
    container.querySelector('button').click();
    expect(onOpen).toHaveBeenCalledWith(url);
  });

  it('reserves space only until the photo loads, so nothing is cropped after', async () => {
    const { container } = render(
      <ImageMessage url="https://app.jamie-app.com/media/uploads/p.webp" onOpen={() => {}} />
    );
    const btn = container.querySelector('button');
    // The aspect-ratio box is keyed on the absence of this class (see chat.css);
    // a permanently fixed ratio is what cropped the photo a second time.
    expect(btn.className).not.toContain('img-msg--loaded');
    await act(async () => { fireEvent.load(container.querySelector('img')); });
    expect(container.querySelector('button').className).toContain('img-msg--loaded');
  });
});

describe('url variant helpers stay distinct', () => {
  it('chatImageUrl and thumbUrl are different variants of the same object', () => {
    const u = 'https://app.jamie-app.com/media/uploads/p.webp';
    expect(chatImageUrl(u)).toBe(`${u}?size=chat`);
    expect(thumbUrl(u)).toBe(`${u}?size=thumb`);
  });

  it('both leave non-/media urls alone (local dev, external, already-queried)', () => {
    expect(chatImageUrl('/uploads/local.webp')).toBe('/uploads/local.webp');
    expect(chatImageUrl('https://x.tld/a.png')).toBe('https://x.tld/a.png');
    expect(chatImageUrl('https://app.jamie-app.com/media/uploads/p.webp?size=thumb'))
      .toBe('https://app.jamie-app.com/media/uploads/p.webp?size=thumb');
    expect(chatImageUrl(null)).toBe(null);
  });
});
