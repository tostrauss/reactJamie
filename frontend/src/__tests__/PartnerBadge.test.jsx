import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PartnerBadge from '../components/PartnerBadge';
import StarIcon from '../components/StarIcon';

// „☆ Partner" (Tina 16.11.2026): one badge for the feed card (tab) and the
// event page (pill), one star, one yellow — and that yellow only as tokens.

describe('PartnerBadge', () => {
  it('reads „Partner" with an outline star; screen readers get the full phrase', () => {
    const { container } = render(<PartnerBadge />);
    const badge = container.firstChild;
    expect(badge).toHaveClass('partner-badge', 'partner-badge--pill');
    expect(screen.getByText('Partner')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Event eines JAMIE-Partners')).toHaveClass('sr-only');
    const star = badge.querySelector('svg');
    expect(star).toHaveAttribute('aria-hidden', 'true');
    expect(star).toHaveAttribute('fill', 'none');          // ☆, not ★
  });

  it('the feed-card tab is its own variant', () => {
    const { container } = render(<PartnerBadge variant="tab" />);
    expect(container.firstChild).toHaveClass('partner-badge', 'partner-badge--tab');
    expect(container.firstChild).not.toHaveClass('partner-badge--pill');
  });
});

describe('StarIcon', () => {
  it('is the Feather outline star in currentColor by default', () => {
    const { container } = render(<StarIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg.querySelector('polygon').getAttribute('points')).toMatch(/^12 2 15\.09 8\.26/);
  });

  it('passed attributes win — the solid coral star of the event page', () => {
    const { container } = render(<StarIcon size={13} fill="#FD7666" stroke="none" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '13');
    expect(svg).toHaveAttribute('fill', '#FD7666');
    expect(svg).toHaveAttribute('stroke', 'none');
  });
});

describe('partner yellow lives in the tokens only', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p);
    return /\.(css|jsx?)$/.test(d.name) ? [p] : [];
  });

  it('#F9E296 / 249, 226, 150 appear only in global.css :root', () => {
    const hits = files(SRC).filter((f) => /F9E296|249,\s*226,\s*150/i.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(SRC, f).replaceAll('\\', '/'))).toEqual(['styles/global.css']);
    const globalCss = fs.readFileSync(path.join(SRC, 'styles/global.css'), 'utf8');
    expect(globalCss.match(/F9E296|249,\s*226,\s*150/gi)).toHaveLength(2);   // --accent-partner + -rgb
  });

  it('the feed card keeps its yellow frame on :hover (home.css resets .group-card:hover to lilac)', () => {
    const homeCss = fs.readFileSync(path.join(SRC, 'styles/home.css'), 'utf8');
    expect(homeCss).toMatch(/\.group-card\.is-partner:hover\s*\{[^}]*border-color:\s*var\(--partner-line\)/);
  });
});
