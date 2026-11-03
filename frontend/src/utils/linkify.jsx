/**
 * Turn bare URLs in chat text into tappable links (Tim via Instagram,
 * 03.11.2026): many groups exist for events, and an organiser pasting an
 * Insta or ticket URL got dead text until now.
 *
 * Built as React elements, never innerHTML, so message text cannot inject
 * markup. Only http(s):// and www.… are matched, so the href scheme is safe
 * by construction. Inside the Capacitor shell, target="_blank" is handed to
 * UIApplication.shared.open / the Android intent by the WebView delegate,
 * so links exit to Safari/Chrome like every other external link in the app.
 */

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

// Trailing sentence punctuation is not part of the URL ("schau auf
// www.example.com!"); a closing bracket only belongs to it when the match
// itself contains the opening one (…/wiki/Foo_(bar)).
const trimTrailing = (url) => {
  for (;;) {
    const last = url[url.length - 1];
    if ('.,;:!?…"\'»”’'.includes(last)) { url = url.slice(0, -1); continue; }
    if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ']' && !url.includes('[')) { url = url.slice(0, -1); continue; }
    return url;
  }
};

export function linkifyText(text) {
  if (typeof text !== 'string' || !text) return text;
  const parts = [];
  let last = 0;
  let key = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = trimTrailing(m[0]);
    // Trimming can eat the whole tail ("www.!!!" → "www"): only a match that
    // still looks like a URL becomes a link, the rest stays plain text.
    if (!/^(https?:\/\/|www\.)\S/i.test(url)) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    parts.push(
      <a
        key={`lnk-${key++}`}
        className="message-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        // The bubble around the link is the long-press target for the action
        // sheet; a plain tap on the link must stay a link tap only.
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    last = m.index + url.length;
  }
  if (!parts.length) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
