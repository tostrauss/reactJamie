/**
 * "Neue Gruppe in deiner Lieblings-Kategorie" push fan-out — matching terms.
 *
 * Users pick free-text interests (Onboarding INTEREST_OPTIONS + custom),
 * groups carry 1-3 category names from the frontend CATEGORY_HIERARCHY.
 * The vocabularies overlap by design (Onboarding.jsx keeps interest labels
 * category-compatible). This module turns a group's category list into the
 * lowercased term set a user interest must hit to receive the push:
 *
 *   - the sub-category names themselves ("Fußball", "Yoga"),
 *   - their MAIN category label ("Sport") so broad interests match,
 *   - a few interest-vocabulary aliases ("Natur" → Outdoor groups).
 *
 * "Sonstiges" (both the sub in every main and the main itself) is excluded —
 * it carries no interest signal and would only add noise.
 *
 * ⚠️ MIRROR of frontend/src/utils/categories.js CATEGORY_HIERARCHY (names
 * only). When categories change there, update here too.
 */

const HIERARCHY = {
  Sport: [
    'Fußball', 'Basketball', 'Volleyball', 'Beachvolleyball', 'Tennis',
    'Badminton', 'Tischtennis', 'Golf', 'Laufen', 'Laufklub', 'Fitness',
    'Yoga', 'Schwimmen', 'Eislaufen', 'Kampfsport', 'Boxen', 'Reiten',
  ],
  'Night Out': [
    'Bar-Hopping', 'Clubbing', 'Tanzen', 'Karaoke', 'Cocktails', 'Rooftop',
    'Konzert', 'After Work', 'Pub Quiz', 'Comedy Show', 'Networking',
  ],
  Outdoor: [
    'Wandern', 'Radfahren', 'Mountainbiken', 'Klettern', 'Skifahren',
    'Snowboarden', 'Langlaufen', 'Camping', 'Paragliding', 'Kanufahren',
    'Segeln', 'Picknick', 'Baden', 'Chillen',
  ],
  Kultur: [
    'Musik', 'Konzerte', 'Theater', 'Oper', 'Kunst', 'Museen', 'Fotografie',
    'Film', 'Bücher', 'Brettspiele', 'Escape Room', 'Stadtführung', 'Sprachen',
  ],
  Food: [
    'Essen gehen', 'Brunch', 'Kochen', 'Backen', 'Grillabend', 'Food-Touren',
    'Street Food', 'Heuriger', 'Weinverkostung', 'Bierverkostung', 'Kaffee',
    'Veganes Essen',
  ],
  // The 'Sonstiges' main (Reisen, Gaming, …) is deliberately absent: its subs
  // still match directly (interest "Gaming" == category "Gaming"), but there
  // is no meaningful umbrella term to broaden them with.
};

// Interest-vocabulary aliases that don't textually equal a category name.
// Sub-level: alias applies only when that exact sub is on the group.
const SUB_ALIASES = {
  'Film': ['Filme'],
  'Bücher': ['Lesen'],
  'Essen gehen': ['Essen'],
};
// Main-level: alias applies to every group under that main category.
const MAIN_ALIASES = {
  Outdoor: ['Natur'],
};

// Reverse index sub(lowercased) → main label, built once.
const SUB_TO_MAIN = new Map();
for (const [main, subs] of Object.entries(HIERARCHY)) {
  for (const sub of subs) SUB_TO_MAIN.set(sub.toLowerCase(), main);
}

/**
 * @param {string[]} categories — the group's category names (1-3, primary first)
 * @returns {string[]} lowercased, deduped match terms (may be empty)
 */
export function expandMatchTerms(categories) {
  const terms = new Set();
  for (const raw of categories || []) {
    if (typeof raw !== 'string') continue;
    const cat = raw.trim();
    if (!cat || cat.toLowerCase() === 'sonstiges') continue;
    terms.add(cat.toLowerCase());
    for (const alias of SUB_ALIASES[cat] || []) terms.add(alias.toLowerCase());
    const main = SUB_TO_MAIN.get(cat.toLowerCase());
    if (main) {
      terms.add(main.toLowerCase());
      for (const alias of MAIN_ALIASES[main] || []) terms.add(alias.toLowerCase());
    }
  }
  return [...terms];
}
