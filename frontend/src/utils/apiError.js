/**
 * Turn an axios error into a sentence in the USER's language.
 *
 * 578 of the ~582 error responses in backend/src carry a hardcoded German
 * sentence, and 64 sites across this app render `data.error` verbatim — the
 * translated fallback only fires when the server sent no `error` field, which
 * is essentially never. So in an app shipped to five markets, the entire UI is
 * translated except the one line that tells someone why their action failed
 * (audit 2026-09-15, finding 23).
 *
 * Exactly one path already did it right — DealDetail branches on
 * `data.code === 'WRONG_DAY'` and renders a t() string — proving the pattern
 * was known and applied once out of ~60 opportunities. This generalises it.
 *
 * Deliberately NOT a mass refactor of every response: the German string stays
 * in the body as the last-resort fallback, so a screen whose error has no
 * `code` yet behaves exactly as before and the migration can be partial
 * indefinitely without anything regressing.
 *
 * Resolution order:
 *   1. `data.code` → `errors.<CODE>` i18n key (with `data` as interpolation
 *      values, so ACCOUNT_LOCKED can say how many minutes)
 *   2. `data.error` — the server's German sentence
 *   3. the caller's own fallback key
 */
export function serverErrorMessage(err, t, fallbackKey = 'errors.generic') {
  const data = err?.response?.data;
  const code = data?.code;

  if (code) {
    const key = `errors.${code}`;
    // i18next returns the key itself when it is missing — that must not be
    // shown to anyone, so fall through to the server's own sentence instead.
    const translated = t(key, { ...data, defaultValue: '' });
    if (translated && translated !== key) return translated;
  }

  if (typeof data?.error === 'string' && data.error) return data.error;

  // No response at all (offline, timeout) — err.message is an untranslated
  // axios string like "Network Error", which is worse than our own copy.
  if (!err?.response) return t('errors.network');

  return t(fallbackKey);
}
