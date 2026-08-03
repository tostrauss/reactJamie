/**
 * Composites REAL device captures into branded store screenshots.
 *
 * Replaces the synthetic marketing slides (generate-assets.js §4) — Tina,
 * 2026-07-29: the Play listing still showed the mockup cards while the live
 * app has real content to show. Layout: dark JAMIE gradient, coral accent bar,
 * headline, then the real capture scaled in with rounded corners + border.
 *
 * Usage:
 *   1. Drop 5 device captures into store/captures/, named so their
 *      alphabetical order matches the SLIDES list below, e.g.:
 *        01-gruppen.png  02-chat.png  03-karte.png  04-club.png  05-freunde.png
 *      (any resolution/aspect works — portrait phone captures expected;
 *       PNG or JPEG)
 *   2. node store/generate-screenshots-real.js
 *   3. Review store/assets/screenshots-real/, then upload:
 *        android-phone-* → Play Console → Store presence → screenshots
 *        ios-*           → App Store Connect (optional, same captures)
 *
 * Fewer than 5 captures: generates that many slides (Play minimum is 2).
 * More than 5: extra captures get a generic headline.
 */

import { createRequire } from 'module';
import { mkdirSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const sharp = require('../frontend/node_modules/sharp');

const __dirname   = dirname(fileURLToPath(import.meta.url));
const capturesDir = join(__dirname, 'captures');
const outDir      = join(__dirname, 'assets', 'screenshots-real');

const CORAL  = '#FD7666';
const DARK   = '#231B43';
const DARKER = '#1A1335';

// Headline per slide, applied to captures in alphabetical filename order.
// Mirrors the messaging of the old marketing slides.
const SLIDES = [
  { headline: 'Finde Leute für\nAktivitäten',      sub: 'Tritt lokalen Gruppen bei oder erstelle deine eigene.' },
  { headline: 'Chatte\nin Echtzeit',               sub: 'Bleibe in Verbindung mit deiner Gruppe – ohne Umwege.' },
  { headline: 'Karte für Events\nin deiner Nähe',  sub: 'Entdecke Aktivitäten auf einen Blick.' },
  { headline: 'Gründe einen Club',                 sub: 'Regelmäßige Treffen, eigener Chat, eigene Events.' },
  { headline: 'Freunde &\nVerlässlichkeit',        sub: 'Trusted-User-Badge für aktive Mitglieder.' },
];
const FALLBACK = { headline: 'Entdecke JAMIE', sub: 'Gruppen · Clubs · Chat · Karte' };

const esc = (s) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// Branded background + headline; the capture is composited separately.
function frameSVG(W, H, slide, capX, capY, capW, capH, capR) {
  const pad     = Math.round(W * 0.07);
  const hSize   = Math.round(W * 0.085);
  const subSize = Math.round(W * 0.036);
  const lines   = slide.headline.split('\n');
  const accentY = Math.round(H * 0.045);
  const titleY  = Math.round(H * 0.105);
  const lineH   = Math.round(hSize * 1.12);

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${DARKER}"/>
          <stop offset="100%" stop-color="${DARK}"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <rect x="${pad}" y="${accentY}" width="${Math.round(W * 0.16)}" height="${Math.round(W * 0.012)}"
            rx="${Math.round(W * 0.006)}" fill="${CORAL}"/>
      <g font-family="Arial Black, Impact, sans-serif" font-weight="900" fill="#FFFFFF">
        ${lines.map((l, i) => `<text x="${pad}" y="${titleY + i * lineH}" font-size="${hSize}">${esc(l)}</text>`).join('')}
      </g>
      <text x="${pad}" y="${titleY + lines.length * lineH + subSize * 0.4}" font-family="Arial, sans-serif"
            font-size="${subSize}" font-weight="500" fill="#FFFFFF" opacity="0.78">${esc(slide.sub)}</text>
      <!-- capture border, drawn on top of where the capture lands -->
      <rect x="${capX - 3}" y="${capY - 3}" width="${capW + 6}" height="${capH + 6}" rx="${capR + 3}"
            fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="3"/>
    </svg>
  `);
}

// Rounded-corner mask for the capture.
const roundedMask = (w, h, r) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
     <rect width="${w}" height="${h}" rx="${r}" fill="#fff"/>
   </svg>`
);

async function slide(W, H, captureFile, slideDef, outFile) {
  // Reserve the top ~26% for headline/sub, rest for the capture + margins.
  const topReserved = Math.round(H * 0.26);
  const bottomPad   = Math.round(H * 0.035);
  const maxW = Math.round(W * 0.86);
  const maxH = H - topReserved - bottomPad;

  const meta = await sharp(captureFile).metadata();
  const scale = Math.min(maxW / meta.width, maxH / meta.height);
  const capW = Math.round(meta.width * scale);
  const capH = Math.round(meta.height * scale);
  const capR = Math.round(W * 0.045);
  const capX = Math.round((W - capW) / 2);
  // Anchor to the bottom area so varying aspect ratios all look deliberate.
  const capY = topReserved + Math.round((maxH - capH) / 2);

  const capture = await sharp(captureFile)
    .resize(capW, capH, { kernel: 'lanczos3' })
    .composite([{ input: roundedMask(capW, capH, capR), blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp(frameSVG(W, H, slideDef, capX, capY, capW, capH, capR))
    .composite([{ input: capture, top: capY, left: capX }])
    .png({ compressionLevel: 9 })
    .toFile(outFile);
}

(async () => {
  if (!existsSync(capturesDir)) {
    mkdirSync(capturesDir, { recursive: true });
    console.log('store/captures/ angelegt — bitte 5 Handy-Screenshots hineinlegen:');
    SLIDES.forEach((s, i) => console.log(`  0${i + 1}-….png  →  "${s.headline.replace('\n', ' ')}"`));
    process.exit(0);
  }
  const captures = readdirSync(capturesDir)
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .sort();
  if (captures.length === 0) {
    console.log('Keine Captures in store/captures/ gefunden. Erwartet (alphabetische Reihenfolge = Slide-Reihenfolge):');
    SLIDES.forEach((s, i) => console.log(`  0${i + 1}-….png  →  "${s.headline.replace('\n', ' ')}"`));
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`${captures.length} Captures gefunden:\n  ${captures.join('\n  ')}\n`);

  const sizes = [
    { W: 1080, H: 1920, prefix: 'android-phone' },  // Play
    { W: 1290, H: 2796, prefix: 'ios-6_7-inch' },   // App Store 6.7"
    { W: 1284, H: 2778, prefix: 'ios-6_5-inch' },   // App Store 6.5"
  ];
  for (const { W, H, prefix } of sizes) {
    for (let i = 0; i < captures.length; i++) {
      const def = SLIDES[i] || FALLBACK;
      const out = join(outDir, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
      await slide(W, H, join(capturesDir, captures[i]), def, out);
      console.log(`✓ ${out.replace(/\\/g, '/').split('/store/')[1]} (${W}x${H})`);
    }
  }
  console.log('\nFertig → store/assets/screenshots-real/');
  console.log('Play Console: Store-Präsenz → Haupt-Store-Eintrag → Screenshots (android-phone-*)');
})();
