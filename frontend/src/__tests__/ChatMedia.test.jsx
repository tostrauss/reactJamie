import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ImageMessage } from '../components/ImageMessage';
import { mediaUrl, repinIfNearBottom } from '../utils/chatMedia';
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

  it('never hands the human-readable LABEL to the renderer as a url', () => {
    // Since the split, `content` of a media row is "📷 Foto" — falling back to
    // it whenever media_url was missing made a guaranteed-broken <img>.
    expect(mediaUrl({ message_type: 'image', content: '📷 Foto' })).toBe('');
    expect(mediaUrl({ message_type: 'voice', content: '🎤 Sprachnachricht' })).toBe('');
    expect(mediaUrl({ content: 'https://app.jamie-app.com/media/uploads/a.webp' }))
      .toBe('https://app.jamie-app.com/media/uploads/a.webp');
  });
});

describe('ImageMessage load failures degrade instead of giving up (tester 06.10.2026)', () => {
  const url = 'https://app.jamie-app.com/media/uploads/p.webp';
  const img = (c) => c.querySelector('img');

  it('falls back from the ?size=chat variant to the original', async () => {
    const { container } = render(<ImageMessage url={url} onOpen={() => {}} />);
    expect(img(container).getAttribute('src')).toBe(`${url}?size=chat`);
    await act(async () => { fireEvent.error(img(container)); });
    // One failed variant request used to mean "Foto nicht verfügbar" for the
    // rest of the session — the original is often fine when the variant is not.
    expect(img(container).getAttribute('src')).toBe(url);
  });

  it('offers a tap-to-reload after both fail, and the tap starts over', async () => {
    const { container, getByText } = render(<ImageMessage url={url} onOpen={() => {}} />);
    await act(async () => { fireEvent.error(img(container)); });
    await act(async () => { fireEvent.error(img(container)); });
    expect(img(container)).toBeNull();
    expect(getByText('chat.photo.unavailable')).toBeTruthy();
    const retry = getByText('chat.photo.retry').closest('button');
    expect(retry).toBeTruthy();
    await act(async () => { fireEvent.click(retry); });
    expect(img(container).getAttribute('src')).toBe(`${url}?size=chat`);
  });

  it('a url without a separate variant does not request the same thing twice', async () => {
    const external = 'https://x.tld/a.png';
    const { container, getByText } = render(<ImageMessage url={external} onOpen={() => {}} />);
    expect(img(container).getAttribute('src')).toBe(external);
    await act(async () => { fireEvent.error(img(container)); });
    expect(img(container)).toBeNull();
    expect(getByText('chat.photo.retry')).toBeTruthy();
  });

  it('reports a successful load to the chat (late photos re-pin the scroll)', async () => {
    const onLoad = vi.fn();
    const { container } = render(<ImageMessage url={url} onOpen={() => {}} onLoad={onLoad} />);
    await act(async () => { fireEvent.load(img(container)); });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('…only AFTER the photo left its loading box (the re-pin measures the real height)', async () => {
    let classAtCallback = null;
    const { container } = render(
      <ImageMessage url={url} onOpen={() => {}} onLoad={() => { classAtCallback = container.querySelector('button').className; }} />,
    );
    await act(async () => { fireEvent.load(img(container)); });
    expect(classAtCallback).toContain('img-msg--loaded');
  });

  it('renders the unavailable label without any request for an empty url', () => {
    const { container, getByText } = render(<ImageMessage url="" onOpen={() => {}} />);
    expect(img(container)).toBeNull();
    expect(getByText('chat.photo.unavailable')).toBeTruthy();
  });

  it('opening the lightbox from the original-fallback stage still hands over the original url', async () => {
    const onOpen = vi.fn();
    const { container } = render(<ImageMessage url={url} onOpen={onOpen} />);
    await act(async () => { fireEvent.error(img(container)); });
    container.querySelector('button').click();
    expect(onOpen).toHaveBeenCalledWith(url);
  });
});

describe('repinIfNearBottom', () => {
  const box = (scrollHeight, scrollTop, clientHeight) => ({ scrollHeight, scrollTop, clientHeight });

  it('pulls a reader who is at the bottom down to the newly grown end', () => {
    // 200px of photo just grew in below a reader who was at the bottom.
    const el = box(2200, 1400, 600);
    repinIfNearBottom(el);
    expect(el.scrollTop).toBe(2200);
  });

  it('leaves a reader scrolled back into history alone', () => {
    const el = box(5000, 1000, 600);
    repinIfNearBottom(el);
    expect(el.scrollTop).toBe(1000);
  });

  it('tolerates a missing element', () => {
    expect(() => repinIfNearBottom(null)).not.toThrow();
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
