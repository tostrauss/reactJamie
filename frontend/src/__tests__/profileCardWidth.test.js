import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Own profile: every card under „Über Dich!" is exactly as wide as that card
// (Tina 16.11.2026, PR1). Friends button, the groups/clubs hub and Favoriten
// carried an extra `calc(100% - 40px)` + 20px side margins on top of
// .profile-info-section's padding — 20px narrower per side since 21.04. The
// hub's successor, the card of „Clubs & Communities" + „Demnächst dabei",
// keeps the rule.
// jsdom has no layout, so pin the declarations (cf. pageScrollGuard.test.js).
const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');
const profileCss = fs.readFileSync(path.join(STYLES, 'profile.css'), 'utf8');

const block = (source, selector) => {
  const re = new RegExp(`(^|\\n)${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const m = source.match(re);
  if (!m) throw new Error(`${selector} not found`);
  return Object.fromEntries(m[2].split(';')
    .map((d) => d.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }));
};

describe('profile cards are as wide as „Über Dich!"', () => {
  it('the bio card itself has no side margin (the reference)', () => {
    const bio = block(profileCss, '.profile-bio-card');
    expect(bio.width).toBeUndefined();
    expect(bio.margin).toBeUndefined();
  });

  for (const selector of ['.profile-friends-btn', '.profile-hub', '.profile-favs']) {
    it(`${selector}: full width, no side margins`, () => {
      const decl = block(profileCss, selector);
      expect(decl.width).toBe('100%');
      expect(decl.margin).toBe('0 0 16px');
    });
  }

  // Bubbles and „Demnächst dabei" each render nothing when empty; the card
  // must not stay behind as an empty frame (ProfileMemories.test pins :empty).
  it('.profile-hub hides itself when it is empty', () => {
    expect(block(profileCss, '.profile-hub:empty').display).toBe('none');
  });
});

// „Clubs & Communities“ as in Tina's mock (p. 3, 17.11.2026): the photo 50px,
// centre to centre 74px. And „Sortieren“ must not make the first row jump:
// the grid's tracks are the row's own 64px + 10px, not stretched 1fr columns
// (bubbles 2 and 3 used to move by 11 and 34px on a 390px screen).
describe('club bubbles: the mock\'s sizes, and no jump into „Sortieren“', () => {
  it('a bubble takes a 64px track with a 50px photo, 10px apart', () => {
    expect(block(profileCss, '.profile-club').flex).toBe('0 0 64px');
    const avatar = block(profileCss, '.profile-club-avatar');
    expect(avatar.width).toBe('50px');
    expect(avatar.height).toBe('50px');
    expect(block(profileCss, '.profile-clubs-rail').gap).toBe('10px');
  });

  it('the sorting grid keeps exactly those tracks, packed to the left', () => {
    const grid = block(profileCss, '.profile-clubs-rail.is-sorting');
    expect(grid['grid-template-columns']).toBe('repeat(auto-fill, 64px)');
    expect(grid['column-gap']).toBe('10px');
    expect(grid['justify-content']).toBe('start');
  });
});
