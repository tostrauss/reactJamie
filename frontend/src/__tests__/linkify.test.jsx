import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { linkifyText } from '../utils/linkify';
import { copyText } from '../utils/clipboard';

// Tim via Instagram (03.11.2026): URLs in chat messages must be tappable and
// message text copyable. Linkify builds React elements (never innerHTML) and
// only ever links http(s)/www, so no message can smuggle in a scheme.

describe('linkifyText', () => {
  it('returns plain text untouched', () => {
    expect(linkifyText('hallo wie gehts')).toBe('hallo wie gehts');
    expect(linkifyText('')).toBe('');
    expect(linkifyText(null)).toBe(null);
  });

  it('turns an https URL into a safe external link', () => {
    render(<div>{linkifyText('schau mal https://example.com/events rein')}</div>);
    const a = screen.getByRole('link', { name: 'https://example.com/events' });
    expect(a.getAttribute('href')).toBe('https://example.com/events');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
  });

  it('prefixes www links with https:// in the href but shows the text as typed', () => {
    render(<div>{linkifyText('insta: www.instagram.com/jamie.app')}</div>);
    const a = screen.getByRole('link', { name: 'www.instagram.com/jamie.app' });
    expect(a.getAttribute('href')).toBe('https://www.instagram.com/jamie.app');
  });

  it('keeps trailing sentence punctuation out of the link', () => {
    render(<div>{linkifyText('alles auf https://example.com/tickets!')}</div>);
    const a = screen.getByRole('link');
    expect(a.textContent).toBe('https://example.com/tickets');
    expect(a.getAttribute('href')).toBe('https://example.com/tickets');
  });

  it('drops an unbalanced closing paren but keeps a wiki-style one', () => {
    const { container, unmount } = render(<div>{linkifyText('(siehe https://example.com/a)')}</div>);
    expect(container.querySelector('a').getAttribute('href')).toBe('https://example.com/a');
    unmount();
    render(<div>{linkifyText('https://de.wikipedia.org/wiki/Wien_(Stadt)')}</div>);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://de.wikipedia.org/wiki/Wien_(Stadt)');
  });

  it('links several URLs and keeps the text between them', () => {
    const { container } = render(
      <div>{linkifyText('erst https://a.example.com dann www.b.example.com fertig')}</div>
    );
    expect(container.querySelectorAll('a').length).toBe(2);
    expect(container.textContent).toBe('erst https://a.example.com dann www.b.example.com fertig');
  });

  it('never links other schemes', () => {
    const { container } = render(<div>{linkifyText('javascript:alert(1) und mailto:x@y.z')}</div>);
    expect(container.querySelector('a')).toBe(null);
  });

  it('leaves a match that trims down to nothing as plain text', () => {
    const { container } = render(<div>{linkifyText('www.!!! und https://.')}</div>);
    expect(container.querySelector('a')).toBe(null);
    expect(container.textContent).toBe('www.!!! und https://.');
  });
});

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the clipboard API when it works', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await expect(copyText('hallo')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hallo');
  });

  it('falls back to execCommand when the clipboard API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    document.execCommand = vi.fn(() => true);
    await expect(copyText('hallo')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure when nothing works', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    document.execCommand = vi.fn(() => { throw new Error('nope'); });
    await expect(copyText('hallo')).resolves.toBe(false);
  });
});
