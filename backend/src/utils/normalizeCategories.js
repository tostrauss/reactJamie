// Single source of truth for category normalization (audit 2026-09-02,
// code-health lens): groupController and clubController each carried a
// byte-identical private copy — a rule change (e.g. the max-3 cap) had to be
// made twice or the two entity types silently diverged.
// Accepts the raw create/update payload shape: `categories` array preferred,
// legacy single `category` string as fallback. Returns ≤3 trimmed uniques.
export function normalizeCategories(categories, category) {
  const src = Array.isArray(categories) ? categories : (category ? [category] : []);
  return [...new Set(src.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim()))].slice(0, 3);
}
