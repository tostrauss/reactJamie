import { describe, it, expect } from 'vitest';
import { movePhoto, joinProfilePhotos, splitProfilePhotos } from '../utils/photoOrder';

// Reihenfolge der Profilfotos / Pinnwand (Wunsch 10.10.2026) — the pure part.
describe('movePhoto', () => {
  const L = ['a', 'b', 'c', 'd'];

  it('moves an item to the front, one place earlier and one place later', () => {
    expect(movePhoto(L, 2, 0)).toEqual(['c', 'a', 'b', 'd']);   // "Als Profilbild"
    expect(movePhoto(L, 3, 2)).toEqual(['a', 'b', 'd', 'c']);
    expect(movePhoto(L, 0, 1)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('returns the SAME array for a no-op or an out-of-range move, and never mutates', () => {
    expect(movePhoto(L, 1, 1)).toBe(L);
    expect(movePhoto(L, 0, -1)).toBe(L);
    expect(movePhoto(L, 3, 4)).toBe(L);
    expect(movePhoto(L, 9, 0)).toBe(L);
    expect(L).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('joinProfilePhotos / splitProfilePhotos', () => {
  it('reads the ProfileEdit shape (avatar outside photos) as one list', () => {
    expect(joinProfilePhotos('a', ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('reads the Onboarding shape (avatar also inside photos, maybe not first) in display order', () => {
    expect(joinProfilePhotos('b', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('promotes photos[0] when there is no avatar, and drops empties and duplicates', () => {
    expect(joinProfilePhotos('', ['a', 'b'])).toEqual(['a', 'b']);
    expect(joinProfilePhotos(null, ['a', '', 'a', 'b'])).toEqual(['a', 'b']);
    expect(joinProfilePhotos(undefined, undefined)).toEqual([]);
  });

  it('splits slot 1 off as the profile picture', () => {
    expect(splitProfilePhotos(['c', 'a', 'b'])).toEqual({ avatar_url: 'c', photos: ['a', 'b'] });
    expect(splitProfilePhotos([])).toEqual({ avatar_url: '', photos: [] });
  });
});
