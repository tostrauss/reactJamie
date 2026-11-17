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

  // Tina 17.11.2026 (Bild 5): „Das ist nicht ganz breit wie man sieht.
  // Sollten alle gleich breit sein.“ — the masonry's own 20px side padding
  // (global.css, for UserProfile) came on top of the section's 24px.
  it('the Pinnwand tiles too: no side padding of their own in the own profile', () => {
    const pinnwand = block(profileCss, '.profile-tab-content .pinnwand-masonry');
    expect(pinnwand['padding-left']).toBe('0');
    expect(pinnwand['padding-right']).toBe('0');
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

  // „JAMIE / Official“, „Südtiroler / in Wien“ in the mock — one line with
  // an ellipsis showed „JAMIE Offi…“.
  it('the name under a bubble: up to two lines, 11px, never nowrap', () => {
    const name = block(profileCss, '.profile-club-name');
    expect(name['-webkit-line-clamp']).toBe('2');
    expect(name['line-clamp']).toBe('2');
    expect(name['white-space']).toBe('normal');
    expect(name['text-overflow']).toBeUndefined();
    expect(name['font-size']).toBe('11px');
    expect(name['font-weight']).toBe('500');
  });

  // With snap points but no scroll padding the first bubble snapped onto the
  // card's edge, 16px left of the title (audit PC-08).
  it('the row snaps inside its own 16px side padding', () => {
    const rail = block(profileCss, '.profile-clubs-rail');
    expect(rail['scroll-snap-type']).toBe('x proximity');
    expect(rail['scroll-padding-inline']).toBe('16px');
    expect(rail.padding).toBe('8px 16px 4px');
  });

  // Mock p. 3: a light yellow disc with a dark star — it was a dark disc with
  // a thin yellow rim, the opposite.
  it('the ☆ disc: partner yellow with a star and rim in the card colour', () => {
    const star = block(profileCss, '.profile-club-star');
    expect(star.background).toBe('var(--accent-partner)');
    expect(star.color).toBe('var(--bg-card)');
    expect(star.border).toBe('2px solid var(--bg-card)');
    expect(star.width).toBe('22px');
  });
});

// The line between the bubbles and „Demnächst dabei“ is inset like the event
// rows under it (mock p. 3) — as a border-top it ran from card edge to card
// edge (audit PC-16 = PU-03). block() does not escape the „+“, hence the
// regexes here.
describe('the divider above „Demnächst dabei“ is inset', () => {
  const declarations = (re) => {
    const m = profileCss.match(re);
    if (!m) throw new Error(`${re} not found`);
    return Object.fromEntries(m[1].split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
  };

  it('a 1px line 12px in from both sides — the rows\' own inset', () => {
    const line = declarations(/\n\.profile-clubs \+ \.profile-upcoming::before\s*\{([^}]*)\}/);
    expect(line.left).toBe('12px');
    expect(line.right).toBe('12px');
    expect(line.height).toBe('1px');
    expect(line.position).toBe('absolute');
    expect(block(profileCss, '.profile-upcoming-list').padding).toBe('6px 12px 0');
  });

  it('the section itself carries no border any more, and anchors the line', () => {
    const section = declarations(/\n\.profile-clubs \+ \.profile-upcoming\s*\{([^}]*)\}/);
    expect(section['border-top']).toBeUndefined();
    expect(section.position).toBe('relative');
  });
});

// „Demnächst dabei“: the date tile of the mock (p. 3) — a small lilac square,
// „20.“ over „Nov“ in two equal white lines (audit PU-12 + PU-13).
describe('the date tile of „Demnächst dabei“', () => {
  it('36 × 38px', () => {
    const tile = block(profileCss, '.profile-upcoming-tile');
    expect(tile.width).toBe('36px');
    expect(tile.height).toBe('38px');
    expect(tile.color).toBe('var(--text-white)');
  });

  it('the subline of a partner event is yellow as a whole — the text token', () => {
    const sub = block(profileCss, '.profile-upcoming-row.is-partner .profile-upcoming-sub');
    expect(sub.color).toBe('var(--partner-text)');
  });

  it('the month is no longer upper-case and grey — capitalised, the tile\'s white', () => {
    const month = block(profileCss, '.profile-upcoming-month');
    const day = block(profileCss, '.profile-upcoming-day');
    // two equal lines
    expect(month['font-size']).toBe(day['font-size']);
    expect(month['font-weight']).toBe(day['font-weight']);
    expect(month['text-transform']).toBe('capitalize');
    expect(month.color).toBeUndefined();
    expect(month['letter-spacing']).toBeUndefined();
  });
});
