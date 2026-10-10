// The interests a profile can pick — ONE list for the onboarding wizard and
// the profile editor. Until 10.10.2026 each page had its own: "Mode" existed
// only in the wizard, "Brettspiele" only in the editor (user report).
//
// The names are the stored values (German) and are matched against group
// categories for the category push (backend utils/categoryFanout.js) — never
// rename one. Values a user picked from an older list or typed in the wizard
// stay valid; both pages still show them.
export const INTERESTS = [
  { name: 'Sport', icon: '\u26BD' },
  { name: 'Fitness', icon: '\u{1F4AA}' },
  { name: 'Laufen', icon: '\u{1F3C3}' },
  { name: 'Wandern', icon: '\u{1F3D4}\uFE0F' },
  { name: 'Yoga', icon: '\u{1F9D8}' },
  { name: 'Tennis', icon: '\u{1F3BE}' },
  { name: 'Volleyball', icon: '\u{1F3D0}' },
  { name: 'Schwimmen', icon: '\u{1F3CA}' },
  { name: 'Golf', icon: '\u26F3' },
  { name: 'Tanzen', icon: '\u{1F483}' },
  { name: 'Musik', icon: '\u{1F3B5}' },
  { name: 'Clubbing', icon: '\u{1F57A}' },
  { name: 'Kunst', icon: '\u{1F3A8}' },
  { name: 'Fotografie', icon: '\u{1F4F7}' },
  { name: 'Filme', icon: '\u{1F3AC}' },
  { name: 'Lesen', icon: '\u{1F4DA}' },
  { name: 'Mode', icon: '\u{1F457}' },
  { name: 'Gaming', icon: '\u{1F3AE}' },
  { name: 'Brettspiele', icon: '\u{1F3B2}' },
  { name: 'Technik', icon: '\u{1F4BB}' },
  { name: 'Kochen', icon: '\u{1F468}\u200D\u{1F373}' },
  { name: 'Essen', icon: '\u{1F37D}\uFE0F' },
  { name: 'Reisen', icon: '\u2708\uFE0F' },
  { name: 'Natur', icon: '\u{1F33F}' },
  { name: 'Soziales', icon: '\u{1F91D}' },
];

export const INTEREST_NAMES = INTERESTS.map((i) => i.name);

// The join rule needs this many (backend utils/profileCompleteness.js).
export const MIN_INTERESTS = 3;
