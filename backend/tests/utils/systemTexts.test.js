import { describe, it, expect, vi } from 'vitest';

// The automatic chat lines live in ONE place since 2026-10-26
// (utils/systemMessage.js SYSTEM_TEXTS). Moving them there must not change a
// single visible character — these are the texts that were live before.
// When Tina's final welcome text lands, update the expectation here together
// with the constant: that is the one deliberate change.
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));

const { SYSTEM_TEXTS } = await import('../../src/utils/systemMessage.js');

describe('SYSTEM_TEXTS', () => {
  it('keeps the live texts word for word', () => {
    expect(SYSTEM_TEXTS.welcomeGroup('Laufen im Prater')).toBe('Willkommen bei Laufen im Prater! Stell dich kurz vor 👋');
    expect(SYSTEM_TEXTS.welcomeClub('Laufclub Wien')).toBe('Willkommen bei Laufclub Wien! Stell euch kurz vor 👋');
    expect(SYSTEM_TEXTS.joined('Anna')).toBe('Anna ist der Gruppe beigetreten 🎉');
    expect(SYSTEM_TEXTS.left('Anna')).toBe('Anna hat die Gruppe verlassen 👋');
  });

  it('a club event greets like a group until it gets a text of its own', () => {
    expect(SYSTEM_TEXTS.welcomeEvent('Lauftreff')).toBe(SYSTEM_TEXTS.welcomeGroup('Lauftreff'));
  });

  it('cannot be patched at runtime', () => {
    expect(Object.isFrozen(SYSTEM_TEXTS)).toBe(true);
  });
});
