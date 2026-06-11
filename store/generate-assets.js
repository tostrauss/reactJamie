/**
 * Generates production store assets from existing brand artwork.
 *
 *   - App Store icon  1024x1024 (PNG, no alpha)
 *   - Play Store icon  512x512 (PNG, no alpha)
 *   - Play feature graphic  1024x500 (PNG)
 *   - Play phone screenshots 1080x1920 (5 marketing slides)
 *   - iOS 6.7" screenshots   1290x2796 (3 marketing slides)
 *   - iOS 6.5" screenshots   1284x2778 (3 marketing slides)
 *   - iOS 5.5" screenshots   1242x2208 (3 marketing slides)
 *
 * Run from repo root:
 *   node store/generate-assets.js
 *
 * Uses the `sharp` already installed under frontend/node_modules.
 */

import { createRequire } from 'module';
import { mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const sharp = require('../frontend/node_modules/sharp');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..');
const outDir    = join(__dirname, 'assets');
const screensDir = join(outDir, 'screenshots');
mkdirSync(outDir,     { recursive: true });
mkdirSync(screensDir, { recursive: true });

const SRC_ICON     = join(repoRoot, 'frontend', 'public', 'pwa-512x512.png');
const SRC_WORDMARK = join(repoRoot, 'helpingIMG', 'App logo Neu.png');

const CORAL = '#FD7666';
const DARK  = '#231B43';
const DARKER = '#1A1335';
const WHITE = '#FFFFFF';

const flatten = (img) => img.flatten({ background: '#FFFFFF' });

// Centered JAMIE wordmark on the dark-blue app background.
// Source PNG is coral wordmark on white; we trim, drop the white pixels
// to alpha, then composite on the dark canvas.
async function brandSquare(size) {
  const innerPct = 0.78;
  const inner    = Math.round(size * innerPct);

  // 1. Trim white margins on the source.
  const trimmed = await sharp(SRC_WORDMARK)
    .trim({ threshold: 10 })
    .toBuffer();

  // 2. Knock out the near-white background. Preserve the coral pixels at
  //    full opacity; transparent edges from the source stay transparent.
  const { data, info } = await sharp(trimmed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 32) { data[i + 3] = 0; continue; }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) {
      data[i + 3] = 0;                                          // pure white
    } else if (r > 200 && g > 200 && b > 200) {
      const whiteness = (r + g + b) / 3 / 255;
      data[i + 3] = Math.round((1 - (whiteness - 0.78) / 0.14) * 255); // edges
    } else {
      data[i + 3] = 255;                                        // coral
    }
  }
  const knockout = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();

  // 3. Scale wordmark to the inner box.
  const scale = inner / Math.max(info.width, info.height);
  const w = Math.round(info.width  * scale);
  const h = Math.round(info.height * scale);

  const wordmark = await sharp(knockout)
    .resize(w, h, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 3, background: DARK },
  }).composite([{
    input: wordmark,
    top:  Math.round((size - h) / 2),
    left: Math.round((size - w) / 2),
  }]).flatten({ background: DARK });
}

// ── 1. App Store icon 1024x1024 (no alpha) ──────────────────────────────────
async function appStoreIcon() {
  await (await brandSquare(1024))
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, 'app-store-icon-1024.png'));
  console.log('✓ assets/app-store-icon-1024.png (1024x1024) — JAMIE wordmark');
}

// ── 2. Play Store icon 512x512 (no alpha) ───────────────────────────────────
async function playIcon() {
  await (await brandSquare(512))
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, 'play-icon-512.png'));
  console.log('✓ assets/play-icon-512.png (512x512) — JAMIE wordmark');
}

// ── 3. Play feature graphic 1024x500 ────────────────────────────────────────
// Dark-blue app background with the coral JAMIE wordmark centered.
async function featureGraphic() {
  const W = 1024, H = 500;

  // Reuse the same knockout pipeline used for the icons.
  const trimmed = await sharp(SRC_WORDMARK).trim({ threshold: 10 }).toBuffer();
  const { data, info } = await sharp(trimmed)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 32) { data[i + 3] = 0; continue; }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) {
      data[i + 3] = 0;
    } else if (r > 200 && g > 200 && b > 200) {
      const whiteness = (r + g + b) / 3 / 255;
      data[i + 3] = Math.round((1 - (whiteness - 0.78) / 0.14) * 255);
    } else {
      data[i + 3] = 255;
    }
  }
  const knockout = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();

  const targetW = Math.round(W * 0.50);
  const scale   = targetW / info.width;
  const wmW     = targetW;
  const wmH     = Math.round(info.height * scale);

  const wordmark = await sharp(knockout)
    .resize(wmW, wmH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const tagline = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <text x="${W / 2}" y="${H * 0.76}" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#FFFFFF" opacity="0.92">
        Triff Menschen, entdecke Events
      </text>
      <text x="${W / 2}" y="${H * 0.87}" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="24" font-weight="600" fill="#FD7666">
        Gruppen · Clubs · Chat · Karte
      </text>
    </svg>
  `);

  await sharp({
    create: { width: W, height: H, channels: 3, background: DARK },
  })
    .composite([
      { input: wordmark, top: Math.round(H * 0.18), left: Math.round((W - wmW) / 2) },
      { input: tagline,  top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, 'play-feature-graphic-1024x500.png'));
  console.log('✓ assets/play-feature-graphic-1024x500.png (1024x500)');
}

// ── 4. Marketing screenshots ────────────────────────────────────────────────
// Branded full-bleed slides at exact store dimensions. Headline + supporting
// copy + a card list mimicking the in-app feed, so the slide visually
// communicates the feature without needing real device captures.

const SLIDES = [
  {
    headline: 'Finde Leute für\nAktivitäten',
    sub:      'Tritt lokalen Gruppen bei oder erstelle deine eigene.',
    items:    ['Yoga im Park · 18 Uhr', 'Bouldern · Heute Abend', 'Brunch · Samstag', 'Lauftreff Wien'],
  },
  {
    headline: 'Chatte\nin Echtzeit',
    sub:      'Bleibe in Verbindung mit deiner Gruppe – ohne Umwege.',
    items:    ['Volleyball · 3 neue Nachrichten', 'Bar-Hopping Wien', 'Spiele Abend im Bukowski', 'Lauftreff · Eva: Bist du dabei?'],
  },
  {
    headline: 'Karte für Events\nin deiner Nähe',
    sub:      'Entdecke Aktivitäten auf einen Blick.',
    items:    ['Wien · 18 Events heute', 'Klettern · 1.2 km', 'Yoga · 800 m', 'Konzert · 2.4 km'],
  },
  {
    headline: 'Gründe einen Club',
    sub:      'Wöchentliche Treffen, eigener Chat, eigene Events.',
    items:    ['Lauf-Club Wien · 24 Mitglieder', 'Buch-Club · Mittwochs', 'Foto-Walk · Sonntags', 'Pasta-Abend'],
  },
  {
    headline: 'Freunde &\nVerlässlichkeit',
    sub:      'Trusted-User-Badge für aktive Mitglieder.',
    items:    ['Anna · Trusted ✓', 'Lukas · Trusted ✓', 'Mira · 3 Aktivitäten', 'Tom · 5 Aktivitäten'],
  },
];

function slideSVG(W, H, slide) {
  // Layout scales with width so the same template works for 1080x1920
  // (Android) and 1290x2796 (iOS 6.7").
  const pad      = Math.round(W * 0.07);
  const hSize    = Math.round(W * 0.10);
  const subSize  = Math.round(W * 0.038);
  const cardX    = pad;
  const cardW    = W - pad * 2;
  const cardH    = Math.round(H * 0.085);
  const cardGap  = Math.round(H * 0.018);
  const cardR    = Math.round(W * 0.04);
  const cardSize = Math.round(W * 0.035);
  const firstCardY = Math.round(H * 0.45);

  const lines = slide.headline.split('\n');
  const titleY = Math.round(H * 0.22);
  const lineH  = Math.round(hSize * 1.1);
  const accentY = Math.round(H * 0.13);

  const cards = slide.items.map((label, i) => {
    const y = firstCardY + i * (cardH + cardGap);
    return `
      <rect x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="${cardR}"
            fill="#FFFFFF" opacity="0.08"/>
      <circle cx="${cardX + cardH / 2}" cy="${y + cardH / 2}" r="${cardH * 0.3}"
              fill="#FD7666" opacity="0.85"/>
      <text x="${cardX + cardH + 18}" y="${y + cardH / 2 + cardSize * 0.35}"
            font-family="Arial, sans-serif" font-size="${cardSize}" font-weight="700"
            fill="#FFFFFF">${escapeXml(label)}</text>
    `;
  }).join('');

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="${DARKER}"/>
          <stop offset="100%" stop-color="${DARK}"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>

      <!-- accent bar -->
      <rect x="${pad}" y="${accentY}" width="${Math.round(W * 0.16)}" height="${Math.round(W * 0.012)}"
            rx="${Math.round(W * 0.006)}" fill="${CORAL}"/>

      <!-- headline -->
      <g font-family="Arial Black, Impact, sans-serif" font-weight="900" fill="#FFFFFF">
        ${lines.map((l, i) => `<text x="${pad}" y="${titleY + i * lineH}" font-size="${hSize}">${escapeXml(l)}</text>`).join('')}
      </g>

      <!-- subhead -->
      <text x="${pad}" y="${titleY + lines.length * lineH + subSize}" font-family="Arial, sans-serif"
            font-size="${subSize}" font-weight="500" fill="#FFFFFF" opacity="0.78">
        ${escapeXml(slide.sub)}
      </text>

      <!-- cards -->
      ${cards}

      <!-- footer wordmark -->
      <text x="${W / 2}" y="${H - pad * 0.6}" text-anchor="middle"
            font-family="Arial Black, sans-serif" font-weight="900"
            font-size="${Math.round(W * 0.055)}" fill="${CORAL}" letter-spacing="1.5">JAMIE</text>
    </svg>
  `);
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

async function screenshotsAt(W, H, prefix, count = 5) {
  for (let i = 0; i < count; i++) {
    const svg = slideSVG(W, H, SLIDES[i % SLIDES.length]);
    const file = join(screensDir, `${prefix}-${String(i + 1).padStart(2, '0')}.png`);
    await sharp(svg).png({ compressionLevel: 9 }).toFile(file);
    console.log(`✓ assets/screenshots/${prefix}-${String(i + 1).padStart(2, '0')}.png (${W}x${H})`);
  }
}

// ── PWA icons (overwrite frontend/public/) ──────────────────────────────────
async function pwaIcons() {
  const pub = join(repoRoot, 'frontend', 'public');
  const targets = [
    { size: 64,  file: 'pwa-64x64.png' },
    { size: 192, file: 'pwa-192x192.png' },
    { size: 512, file: 'pwa-512x512.png' },
    { size: 512, file: 'maskable-icon-512x512.png' },
    { size: 180, file: 'apple-touch-icon-180x180.png' },
  ];
  for (const { size, file } of targets) {
    await (await brandSquare(size))
      .png({ compressionLevel: 9 })
      .toFile(join(pub, file));
    console.log(`✓ frontend/public/${file} (${size}x${size})`);
  }
}

// ── runner ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('Generating store assets...\n');

  await appStoreIcon();
  await playIcon();
  await featureGraphic();
  await pwaIcons();

  await screenshotsAt(1080, 1920, 'android-phone',  5); // Play required
  await screenshotsAt(1290, 2796, 'ios-6_7-inch',   3); // App Store 6.7"
  await screenshotsAt(1284, 2778, 'ios-6_5-inch',   3); // App Store 6.5"
  await screenshotsAt(1242, 2208, 'ios-5_5-inch',   3); // App Store 5.5"

  console.log('\nAll assets written to store/assets/');
})();
