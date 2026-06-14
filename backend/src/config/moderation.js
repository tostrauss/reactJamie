/**
 * Content moderation:
 *   - Images → Sightengine API  (nudity-2.0, gore-2.0)
 *   - Text   → OpenAI Moderation API (free, works with German text)
 *
 * Checks uploaded images for nudity and gore before they are saved.
 * Falls back to "safe" (fail-open) when credentials are not configured,
 * so local dev still works without an API key.
 *
 * Required env vars:
 *   SIGHTENGINE_API_USER   — your Sightengine API user
 *   SIGHTENGINE_API_SECRET — your Sightengine API secret
 *   OPENAI_API_KEY         — your OpenAI API key (for text moderation)
 */

const SIGHTENGINE_URL = 'https://api.sightengine.com/1.0/check.json';

// Models to run — nudity-2.0 covers sexual content, gore-2.0 covers graphic violence
const MODELS = 'nudity-2.0,gore-2.0';

// Thresholds — score 0.0–1.0, higher = more likely flagged content
// Intentionally strict: this is a social app rated 16+ with mixed audiences
const THRESHOLDS = {
  nudity_sexual_activity: 0.2,
  nudity_sexual_display:  0.25,
  nudity_erotica:         0.3,
  gore:                   0.3,
};

/**
 * Returns true when Sightengine credentials are set in env.
 */
export const isModerationEnabled = () =>
  !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);

/**
 * Check an image buffer for NSFW / violent content.
 *
 * @param {Buffer} buffer       - Raw image data
 * @param {string} mimetype     - MIME type, e.g. 'image/jpeg'
 * @param {string} originalname - Original filename (used as the multipart filename)
 * @returns {Promise<{ safe: boolean, reason: string|null }>}
 *   safe   = true  → image is OK to save
 *   safe   = false → image was flagged; reason contains a German user-facing message
 */
export const checkImageSafety = async (buffer, mimetype, originalname) => {
  if (!isModerationEnabled()) {
    // Dev mode: no credentials → skip moderation
    return { safe: true, reason: null };
  }

  // Fail-open: if the moderation API is unavailable, allow the upload.
  // Blocking all uploads during an outage is worse than a brief gap in moderation.
  const failResult = { safe: true, reason: null };

  try {
    const blob = new Blob([buffer], { type: mimetype });
    const form = new FormData();
    form.append('media',      blob, originalname);
    form.append('models',     MODELS);
    form.append('api_user',   process.env.SIGHTENGINE_API_USER);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET);

    const response = await fetch(SIGHTENGINE_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      console.error('Sightengine HTTP error:', response.status, await response.text());
      return failResult;
    }

    const data = await response.json();

    if (data.status !== 'success') {
      console.error('Sightengine API returned non-success:', data);
      return failResult;
    }

    // --- Nudity checks ---
    const nudity = data.nudity || {};
    if (
      (nudity.sexual_activity ?? 0) > THRESHOLDS.nudity_sexual_activity ||
      (nudity.sexual_display  ?? 0) > THRESHOLDS.nudity_sexual_display  ||
      (nudity.erotica         ?? 0) > THRESHOLDS.nudity_erotica
    ) {
      return {
        safe: false,
        reason: 'Dieses Bild enthält unangemessene Inhalte und kann nicht hochgeladen werden.',
      };
    }

    // --- Gore / graphic violence check ---
    const gore = data.gore || {};
    if ((gore.prob ?? 0) > THRESHOLDS.gore) {
      return {
        safe: false,
        reason: 'Dieses Bild enthält Gewaltdarstellungen und kann nicht hochgeladen werden.',
      };
    }

    return { safe: true, reason: null };
  } catch (err) {
    console.error('Sightengine check failed:', err);
    return failResult;
  }
};

// =============================================================================
// TEXT MODERATION — OpenAI Moderation API (free)
// =============================================================================

const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';

/**
 * Returns true when OpenAI credentials are set in env.
 */
export const isTextModerationEnabled = () => !!process.env.OPENAI_API_KEY;

/**
 * Map of OpenAI moderation category → German user-facing message.
 * Only the categories we want to surface explicitly.
 */
const CATEGORY_MESSAGES = {
  'hate':                   'Deine Nachricht enthält Hassrede und kann nicht gesendet werden.',
  'hate/threatening':       'Deine Nachricht enthält bedrohende Hassrede und kann nicht gesendet werden.',
  'harassment':             'Deine Nachricht enthält Belästigung und kann nicht gesendet werden.',
  'harassment/threatening': 'Deine Nachricht enthält bedrohende Inhalte und kann nicht gesendet werden.',
  'sexual':                 'Deine Nachricht enthält sexuelle Inhalte und kann nicht gesendet werden.',
  'sexual/minors':          'Deine Nachricht enthält unangemessene Inhalte und kann nicht gesendet werden.',
  'violence':               'Deine Nachricht enthält Gewaltinhalte und kann nicht gesendet werden.',
  'violence/graphic':       'Deine Nachricht enthält drastische Gewaltdarstellungen und kann nicht gesendet werden.',
  'self-harm':              'Deine Nachricht enthält problematische Inhalte und kann nicht gesendet werden.',
};

const DEFAULT_TEXT_BLOCK_MESSAGE = 'Deine Nachricht verstößt gegen unsere Richtlinien und kann nicht gesendet werden.';

// =============================================================================
// DETERMINISTIC WORD BLOCKLIST — always on, no API key required
// =============================================================================
// The OpenAI moderation above is the smart, context-aware layer, but it is
// fail-open (no key → allow) and does not reliably block a bare group/club name
// like "Sex". This blocklist is the hard floor: a curated set of clearly
// inappropriate terms that must never appear in a group name, club name, event
// title, or chat message in this 16+ app. It runs first, with zero config.
//
// Matching rules (see normalizeForMatch + findBlockedTerm):
//   - case-insensitive
//   - diacritics + ß folded (ä→a, ö→o, ü→u, ß→ss) so accents can't bypass it
//   - light leetspeak folding (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, @→a, $→s)
//   - WHOLE-WORD match (\b…\b) so legitimate words that merely *contain* a
//     blocked substring still pass — e.g. "Sexten" (the town), "Sussex",
//     "Sexualität", "unisex" are all fine; standalone "Sex" / "S3x" is blocked.
//
// Team note: this list is the place to add/remove blocked words. Every entry
// MUST be lowercase ASCII (no umlauts/ß) because matching happens against the
// folded form — write "hurensohne", "scheisse", "arschlocher", not "hurensöhne".
const BLOCKED_TERMS = [
  // ── Sexual / explicit (DE) ──
  'sex', 'sexparty', 'sexpartys', 'sextreffen', 'sexdate', 'sexkontakt', 'sexkontakte',
  'porno', 'pornos', 'pornografie', 'pornographie', 'pornhub',
  'fick', 'ficken', 'fickt', 'fickst', 'ficker', 'gefickt', 'arschfick', 'arschficker',
  'fotze', 'fotzen', 'votze', 'muschi', 'muschis', 'pimmel', 'schwanzlutscher',
  'wichser', 'wichsen', 'wichst', 'abwichsen',
  'nutte', 'nutten', 'hure', 'huren', 'hurensohn', 'hurensohne',
  'schlampe', 'schlampen', 'titten', 'analsex', 'analverkehr',
  'orgasmus', 'orgasmen', 'masturbieren', 'masturbation',
  'penis', 'vagina', 'sperma', 'nacktbild', 'nacktbilder', 'nacktfoto', 'nacktfotos',
  'kinderporno', 'kinderpornos', 'inzest', 'orgie',
  // ── Sexual / explicit (EN) ──
  'porn', 'pornography', 'blowjob', 'cumshot', 'handjob', 'deepthroat',
  'dildo', 'milf', 'gangbang', 'nudes', 'nsfw', 'bdsm', 'anal',
  'pussy', 'cock', 'cunt', 'whore', 'slut', 'boobs', 'titties',
  'creampie', 'onlyfans', 'orgy', 'rape', 'incest',
  // ── Slurs / hate (DE) ──
  'nazi', 'nazis', 'hitler', 'hakenkreuz', 'sieg heil', 'heil hitler',
  'judensau', 'judenschwein', 'neger', 'negerin', 'nigger', 'nigga',
  'kanake', 'kanaken', 'schwuchtel', 'schwuchteln', 'zigeuner',
  'untermensch', 'untermenschen', 'spast', 'spasti', 'missgeburt',
  // ── Slurs / hate (EN) ──
  'niggers', 'faggot', 'faggots', 'retard', 'retarded',
  'tranny', 'chink', 'gook', 'spic', 'wetback', 'kike', 'white power',
  // ── Strong profanity / insults ──
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'bitches',
  'asshole', 'bastard', 'scheisse', 'scheiss', 'arschloch', 'arschlocher',
  'vollidiot', 'drecksau',
];

// Fold digits/symbols commonly used to disguise letters back to letters.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One compiled regex for all terms, anchored to word boundaries.
const BLOCKED_REGEX = new RegExp(`\\b(?:${BLOCKED_TERMS.map(escapeRegex).join('|')})\\b`);

const normalizeForMatch = (text) =>
  text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')                  // split accented chars into base + combining mark
    .replace(/[̀-ͯ]/g, '')    // strip the combining diacritical marks
    .replace(/[0134578@$]/g, (c) => LEET_MAP[c] ?? c);

/**
 * Returns the first blocked term found in `text`, or null if the text is clean.
 * Pure + synchronous — safe to call anywhere, no network, no API key.
 *
 * @param {string} text
 * @returns {string|null}
 */
export const findBlockedTerm = (text) => {
  if (!text) return null;
  const match = normalizeForMatch(text).match(BLOCKED_REGEX);
  return match ? match[0] : null;
};

const BLOCKED_WORD_MESSAGE = 'Dieser Text enthält ein nicht erlaubtes Wort und kann nicht verwendet werden.';

/**
 * Check a text string for hate speech, harassment, sexual content, etc.
 *
 * @param {string} text - The text to check (chat message, group name, description…)
 * @returns {Promise<{ safe: boolean, reason: string|null }>}
 */
export const checkTextSafety = async (text) => {
  if (!text || !text.trim()) return { safe: true, reason: null };

  // Deterministic blocklist first — always on, even without an OpenAI key.
  if (findBlockedTerm(text)) {
    return { safe: false, reason: BLOCKED_WORD_MESSAGE };
  }

  if (!isTextModerationEnabled()) return { safe: true, reason: null };

  // Fail-open: if OpenAI is unreachable, allow the message through.
  const failResult = { safe: true, reason: null };

  try {
    const response = await fetch(OPENAI_MODERATION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error('OpenAI Moderation HTTP error:', response.status, await response.text());
      return failResult;
    }

    const data = await response.json();
    const result = data.results?.[0];

    if (!result) {
      console.error('OpenAI Moderation unexpected response shape:', data);
      return failResult;
    }

    if (!result.flagged) {
      return { safe: true, reason: null };
    }

    // Find the first triggered category to give a specific message
    const triggeredCategory = Object.keys(result.categories).find(
      (cat) => result.categories[cat] === true
    );
    const reason = CATEGORY_MESSAGES[triggeredCategory] ?? DEFAULT_TEXT_BLOCK_MESSAGE;

    return { safe: false, reason };
  } catch (err) {
    console.error('OpenAI Moderation check failed:', err);
    return failResult;
  }
};
