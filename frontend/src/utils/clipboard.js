/**
 * Copy helper for the message action sheet (Tim via Instagram, 03.11.2026).
 * iOS text selection cannot coexist with the long-press sheet — the press
 * that would start a selection opens the sheet instead — so copying is a
 * sheet action, like WhatsApp's "Kopieren".
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API absent or denied (older WebViews) → legacy path below.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
