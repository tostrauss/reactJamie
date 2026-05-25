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

/**
 * Check a text string for hate speech, harassment, sexual content, etc.
 *
 * @param {string} text - The text to check (chat message, group name, description…)
 * @returns {Promise<{ safe: boolean, reason: string|null }>}
 */
export const checkTextSafety = async (text) => {
  if (!text || !text.trim()) return { safe: true, reason: null };
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
