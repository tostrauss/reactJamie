import { describe, it, expect } from 'vitest';
import {
  normalizeLocale,
  categoryPushText,
  categoryDigestText,
  joinRequestText,
} from '../../src/utils/pushLocale.js';

describe('normalizeLocale', () => {
  it('maps language tags to de/it/en/fr/es with German fallback', () => {
    expect(normalizeLocale('de')).toBe('de');
    expect(normalizeLocale('de-AT')).toBe('de');
    expect(normalizeLocale('it-IT')).toBe('it');
    expect(normalizeLocale('EN-us')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('fr'); // France rollout 2026-08-04
    expect(normalizeLocale('es-ES')).toBe('es'); // Spain rollout 2026-08-04
    expect(normalizeLocale('pt')).toBe('de');   // unsupported → primary market
    expect(normalizeLocale(null)).toBe('de');
    expect(normalizeLocale('')).toBe('de');
  });
});

describe('categoryPushText', () => {
  const group = { name: 'Fußball im Prater', category: 'Fußball', location: 'Wien' };

  it('renders each locale with name, category and location', () => {
    expect(categoryPushText('de', group)).toEqual({
      title: 'Neue Gruppe: Fußball im Prater',
      body: 'Fußball in Wien – bist du dabei?',
    });
    expect(categoryPushText('it', group).body).toBe('Fußball in Wien – ci stai?');
    expect(categoryPushText('en', group).body).toBe('Fußball in Wien – are you in?');
    expect(categoryPushText('fr', group).body).toBe('Fußball à Wien – tu en es ?');
    expect(categoryPushText('es', group).body).toBe('Fußball en Wien – ¿te apuntas?');
  });

  it('omits the location clause when the group has none', () => {
    expect(categoryPushText('de', { name: 'X', category: 'Yoga' }).body)
      .toBe('Yoga – bist du dabei?');
  });
});

describe('categoryDigestText', () => {
  it('singular vs plural per locale', () => {
    expect(categoryDigestText('de', 1).title).toBe('Eine weitere neue Gruppe für dich');
    expect(categoryDigestText('de', 3).title).toBe('3 weitere neue Gruppen für dich');
    expect(categoryDigestText('it', 2).title).toBe('2 altri nuovi gruppi per te');
    expect(categoryDigestText('en', 1).title).toBe('One more new group for you');
  });
});

describe('joinRequestText', () => {
  it('celebrates with the requester name and group name', () => {
    const { title, body } = joinRequestText('de', { requesterName: 'Alexander', groupName: 'Spieleabend' });
    expect(title).toBe('🎉 Alexander will dabei sein!');
    expect(body).toContain('"Spieleabend"');
  });

  it('falls back gracefully without names', () => {
    const { title } = joinRequestText('en', {});
    expect(title).toBe('🎉 Someone wants to join!');
    expect(joinRequestText('it', {}).title).toBe('🎉 Qualcuno vuole unirsi!');
    expect(joinRequestText('fr', {}).title).toBe('🎉 Quelqu’un veut participer !');
    expect(joinRequestText('es', {}).title).toBe('🎉 ¡Alguien quiere unirse!');
  });
});
