import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fixed-height pages scroll in their OWN inner container, not in .app-viewport
// — so the sideways guard there (05f9041, 31.10.2026) never reached them, and
// overflow-y:auto alone computes overflow-x to auto: one child a few px too
// wide and iOS drags the whole page sideways. Third time for this kind of bug
// (Onboarding 17.10., feeds 31.10., the event page „Spieleabend" 15.11.), so
// pin the guard on every page scroller we know of. jsdom has no layout — pin
// the declarations instead (same approach as genderBubbleParity.test.js).
//
// A deliberate list, not „all scrollers": chat surfaces (swipe-back) and
// carousels (.ppc-track, explore's chip rows) scroll sideways on purpose.
// The onboarding scroller is pinned on its base rule (auth.css): the 17.10.
// fix sits on `.ob-flow .onboarding-content` (onboarding.css) and covered
// only the pages inside .ob-flow (review 16.11.2026).
// Read from disk: Vitest serves CSS imports (even ?raw) as empty modules.
const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');
const css = (name) => fs.readFileSync(path.join(STYLES, name), 'utf8');

// The FIRST `selector {…}` block at the start of a line. replaceAll, unlike
// the original helper's replace, escapes every dot of a compound selector.
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

const PAGE_SCROLLERS = [
  ['global.css', '.app-viewport'],
  ['group-detail.css', '.gd-scroll'],
  ['user-profile.css', '.up-scroll-body'],
  ['global.css', '.notif-scroll'],
  ['friends.css', '.fr-body'],
  ['profile.css', '.settings-body'],
  ['create.css', '.create-content'],
  ['explore.css', '.explore-content'],
  ['group-edit.css', '.ge-body'],
  ['auth.css', '.onboarding-content'],
];

describe('page scrollers never pan sideways', () => {
  for (const [file, selector] of PAGE_SCROLLERS) {
    it(`${selector} (${file}) scrolls vertically with overflow-x: hidden`, () => {
      const decl = block(css(file), selector);
      expect(decl['overflow-y']).toBe('auto');
      expect(decl['overflow-x']).toBe('hidden');
    });
  }
});

describe('event page — nothing in it is wider than the screen (S3)', () => {
  it('the bottom pill row wraps instead of overflowing', () => {
    const row = block(css('group-detail.css'), '.gd-bottom-actions');
    expect(row['flex-wrap']).toBe('wrap');
    const pill = block(css('group-detail.css'), '.gd-action-pill');
    expect(pill['white-space']).toBe('nowrap');
    expect(pill['max-width']).toBe('100%');
  });

  it('an info item (Wann / Ort) breaks a long word instead of widening the card', () => {
    const item = block(css('group-detail.css'), '.gd-info-item');
    expect(item['min-width']).toBe('0');
    expect(item['overflow-wrap']).toBe('anywhere');
  });
});
