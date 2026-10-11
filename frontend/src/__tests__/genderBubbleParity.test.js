import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Register (.reg-bubble) and onboarding ③ (.ob-bubble) ask the same gender
// question in one flow. The onboarding copy had drifted to min-width 96px +
// nowrap, which let it/fr/es labels („Non binario", „Non-binaire") run into
// the pill border at 360–375px while Register wrapped cleanly 2 + 1 (review
// 11.10.2026). jsdom has no layout, so pin the sizing declarations instead.
// From disk: Vitest serves CSS imports (even ?raw) as empty modules. A plain
// string for fileURLToPath — jsdom replaces the global URL class.
const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');
const css = (name) => fs.readFileSync(path.join(STYLES, name), 'utf8');

const block = (source, selector) => {
  const re = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
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

const SIZING = ['flex', 'min-width', 'max-width', 'min-height', 'padding', 'gap', 'font-size', 'font-weight', 'white-space'];

describe('gender bubbles — Register and onboarding ③ size alike', () => {
  it('same sizing declarations', () => {
    const reg = block(css('auth.css'), '.reg-bubble');
    const ob = block(css('onboarding.css'), '.ob-bubble');
    const pick = (d) => Object.fromEntries(SIZING.map((k) => [k, d[k]]));
    expect(pick(ob)).toEqual(pick(reg));
  });

  it('never shrink below the label, never stretch an orphan across the row', () => {
    const ob = block(css('onboarding.css'), '.ob-bubble');
    expect(ob['min-width']).toBe('max-content');
    expect(ob['max-width']).toBe('calc(50% - 4px)');
    expect(ob['white-space']).toBeUndefined();
  });
});
