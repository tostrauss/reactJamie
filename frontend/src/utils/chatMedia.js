/**
 * The playable/renderable URL of a voice or photo message.
 *
 * The server keeps the payload in `media_url` and a human-readable label in
 * `content` (see MEDIA_LABEL in backend/src/controllers/messageController.js),
 * so a client that does not understand `message_type` still shows
 * "🎤 Sprachnachricht" rather than a raw storage URL. That matters because the
 * iOS app bundles the web build inside its binary — iPhones keep running the
 * App Store build's renderer until a new binary ships.
 *
 * The `content` fallback is for rows written during the few hours the original
 * URL-in-content shape was live. The migration backfills those, but the
 * fallback means this component never depends on the migration having run —
 * and an optimistic bubble built client-side also lands here before the server
 * echoes the row back.
 */
export const mediaUrl = (msg) => msg?.media_url || msg?.content || '';

export default mediaUrl;
