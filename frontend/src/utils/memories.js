// Memories (the Hall-of-Fame cards) — helpers shared by Explore and the
// „Warst du dabei..“ page (pages/ShareMoments.jsx), so the card icon, the
// upload limits and the error texts cannot drift apart between the two.
import { CATEGORY_HIERARCHY } from './categories';

export const getCategoryIcon = (catName) => {
  if (!catName) return '✨';
  for (const cat of CATEGORY_HIERARCHY) {
    if (cat.label === catName || cat.id === catName) return cat.icon;
    const sub = cat.subs?.find(s => s.name === catName);
    if (sub) return sub.icon;
  }
  return '✨';
};

// Same mapping as the profile grid (components/HallOfFameGrid.jsx).
export const dateLocaleFor = (lng = 'de') => {
  if (lng.startsWith('en')) return 'en-US';
  if (lng.startsWith('it')) return 'it-IT';
  if (lng.startsWith('fr')) return 'fr-FR';
  if (lng.startsWith('es')) return 'es-ES';
  return 'de-AT';
};

// Checked before uploading (explore.moment.tooLarge).
export const MAX_MEMORY_BYTES = 10 * 1024 * 1024;

// Mirrors backend utils/hallOfFame.js — only for the optimistic card state
// after an add/delete; the server enforces both.
export const MAX_PHOTOS_PER_USER = 5;
export const MAX_PHOTOS_PER_EVENT = 40;
const CARD_PHOTOS = 8; // photos the wall sends per card (preview)

export const withAddedPhoto = (g, photo) => {
  const photoCount = (g.photo_count || 0) + 1;
  const mine = (g.my_photo_count || 0) + 1;
  return {
    ...g,
    photos: [photo, ...(g.photos || [])].slice(0, CARD_PHOTOS),
    photo_count: photoCount,
    my_photo_count: mine,
    can_add_photo: mine < MAX_PHOTOS_PER_USER && photoCount < MAX_PHOTOS_PER_EVENT,
  };
};

export const withoutPhoto = (g, photo, myId) => {
  const photoCount = Math.max(0, (g.photo_count || 0) - 1);
  const mine = Math.max(0, (g.my_photo_count || 0) - (Number(photo.user_id) === Number(myId) ? 1 : 0));
  return {
    ...g,
    photos: (g.photos || []).filter(p => p.id !== photo.id),
    photo_count: photoCount,
    my_photo_count: mine,
    can_add_photo: !!g.is_participant && mine < MAX_PHOTOS_PER_USER && photoCount < MAX_PHOTOS_PER_EVENT,
  };
};

// Toast text for a refused POST /groups/:id/photos (codes from addEventPhoto).
export const photoErrorText = (err, t) => {
  const code = err?.response?.data?.code;
  if (code === 'USER_LIMIT') return t('explore.photos.limitUser', { count: MAX_PHOTOS_PER_USER });
  if (code === 'EVENT_LIMIT') return t('explore.photos.limitEvent');
  if (code === 'NOT_PARTICIPANT') return t('explore.photos.notParticipant');
  return t('explore.photos.error');
};
