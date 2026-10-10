// Reihenfolge der Profilfotos und der Pinnwand (Wunsch 10.10.2026: „die
// Reihenfolge der hinzugefügten Fotos nachträglich bearbeiten“).
//
// The profile photos live in TWO columns: avatar_url (slot 1 — the picture in
// chats, member lists, cards, search) and photos (the rest). Onboarding also
// keeps the avatar INSIDE photos, ProfileEdit keeps it outside; every reader
// (Profile, UserProfile) dedupes [avatar_url, ...photos], so both shapes read
// the same. ProfileEdit edits them as ONE ordered list and splits on write.

/** Move list[from] to index `to`. Out of range or a no-op → the SAME array. */
export function movePhoto(list, from, to) {
  if (!Array.isArray(list) || from === to || from < 0 || to < 0
      || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** [avatar, ...photos] as one ordered, de-duplicated list. No avatar → photos[0] leads. */
export const joinProfilePhotos = (avatarUrl, photos) =>
  [...new Set([avatarUrl, ...(Array.isArray(photos) ? photos : [])].filter(Boolean))];

/** Inverse of joinProfilePhotos: slot 1 is the profile picture. */
export const splitProfilePhotos = (ordered) => ({
  avatar_url: ordered[0] || '',
  photos: ordered.slice(1),
});
