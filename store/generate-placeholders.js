/**
 * Generates placeholder PNG files at the exact required store sizes.
 * Run: node generate-placeholders.js
 * Then replace each file with real screenshots.
 * Requires: npm install canvas (or use any image editor)
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';

const BRAND_BG   = '#231B43';
const BRAND_TEXT = '#FD7666';

const sizes = [
  // iOS App Store
  { name: 'ios-6.9inch',  w: 1320, h: 2868, label: 'iPhone 6.9" (required)' },
  { name: 'ios-6.5inch',  w: 1284, h: 2778, label: 'iPhone 6.5" (required)' },
  { name: 'ios-5.5inch',  w: 1242, h: 2208, label: 'iPhone 5.5" (required)' },
  // Google Play
  { name: 'android-phone', w: 1080, h: 1920, label: 'Android Phone' },
  { name: 'play-feature',  w: 1024, h: 500,  label: 'Play Feature Graphic' },
  // Play icon
  { name: 'play-icon',     w: 512,  h: 512,  label: 'Play Store Icon' },
];

mkdirSync('screenshots', { recursive: true });

for (const { name, w, h, label } of sizes) {
  const canvas = createCanvas(w, h);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = BRAND_BG;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = BRAND_TEXT;
  ctx.font      = `bold ${Math.round(w * 0.06)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('JAMIE', w / 2, h / 2 - 20);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font      = `${Math.round(w * 0.025)}px sans-serif`;
  ctx.fillText(label, w / 2, h / 2 + 30);
  ctx.fillText(`${w} × ${h} px`, w / 2, h / 2 + 70);

  writeFileSync(`screenshots/${name}.png`, canvas.toBuffer('image/png'));
  console.log(`✓ screenshots/${name}.png  (${w}×${h})`);
}

console.log('\nReplace each placeholder with a real screenshot at the same filename.');
