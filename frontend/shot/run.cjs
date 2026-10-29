/* Paywall review screenshots for App Store Connect (Tina, 29.10.2026):
 * renders the ProModal via vite + mocked iOS-IAP platform, clicks each plan,
 * saves paywall-pro_{monthly,sixmonth,yearly}.png to the Desktop. */
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const edge = EDGES.find((p) => fs.existsSync(p));
if (!edge) { console.error('Edge nicht gefunden'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn('npx', ['vite', '--config', 'vite.shot.config.js', '--port', '5199', '--strictPort'],
    { cwd: path.resolve(__dirname, '..'), shell: true, stdio: 'pipe' });
  let log = '';
  await new Promise((resolve, reject) => {
    const onData = (d) => { log += d.toString(); if (log.includes('5199')) resolve(); };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    setTimeout(() => reject(new Error('vite start timeout\n' + log)), 40000);
  });

  // Edge's launcher stub exits immediately under puppeteer.launch ("Code: 0"),
  // so start Edge ourselves with a debug port and connect to it instead.
  const profile = path.join(require('os').tmpdir(), 'jamie-shot-profile-' + Date.now());
  const edgeProc = spawn(edge, [
    '--headless=new', '--remote-debugging-port=9222', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await sleep(500);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      wsUrl = (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) { console.error('Edge-Debug-Port kam nicht hoch'); process.exit(1); }
  const browser = await puppeteer.connect({
    browserWSEndpoint: wsUrl,
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 3 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
  await page.goto('http://localhost:5199/shot/index.html', { waitUntil: 'networkidle0', timeout: 40000 });
  await page.waitForFunction(() => document.body.innerText.includes('MORE PEOPLE'), { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes('29,99'), { timeout: 20000 });
  await sleep(1000); // slide-up animation + webp decode

  const plans = [['1 Monat', 'monthly'], ['6 Monate', 'sixmonth'], ['1 Jahr', 'yearly']];
  for (const [label, key] of plans) {
    await page.evaluate((l) => {
      const tile = [...document.querySelectorAll('button[aria-pressed]')]
        .find((b) => b.textContent.includes(l));
      if (tile) tile.click();
    }, label);
    await sleep(300);
    await page.evaluate(() => {
      const sheet = [...document.querySelectorAll('div')]
        .find((d) => d.style && d.style.overflowY === 'auto');
      if (sheet) sheet.scrollTop = sheet.scrollHeight;
    });
    await sleep(300);
    const out = `C:/Users/tobia/Desktop/paywall-pro_${key}.png`;
    await page.screenshot({ path: out });
    console.log('OK', out);
  }

  // One extra shot of the TOP of the sheet (hero + first bullets) — to verify
  // the hero-overlap fix and to show Tina the fixed layout.
  await page.evaluate(() => {
    const sheet = [...document.querySelectorAll('div')]
      .find((d) => d.style && d.style.overflowY === 'auto');
    if (sheet) sheet.scrollTop = 0;
  });
  await sleep(300);
  await page.screenshot({ path: 'C:/Users/tobia/Desktop/paywall-hero-top.png' });
  console.log('OK hero-top');

  await browser.close();
  try { edgeProc.kill(); } catch { /* already gone */ }
  server.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
