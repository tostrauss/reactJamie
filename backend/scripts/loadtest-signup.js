// Signup-funnel load simulation (2M2M TV-spike readiness, 2026-08-04).
//
// Simulates N viewers hitting the FULL signup flow concurrently:
//   POST /api/auth/send-email-code  → (dev server returns devCode)
//   POST /api/auth/verify-email-code
//   POST /api/auth/register
//
// ⚠️ Run this ONLY against a local/staging instance started in dev mode
// (NODE_ENV != production) — the flow needs the devCode shortcut, and against
// prod it would fire real emails at Resend. The script refuses hosts that
// don't return a devCode. All virtual users share this machine's IP, which is
// exactly the carrier-NAT worst case the limiters must survive.
//
// Usage:
//   BASE_URL=http://localhost:3001 USERS=200 RAMP_SECONDS=60 node scripts/loadtest-signup.js
//
// Interpreting results: with the 2026-08-04 limiter setup (registrationLimiter
// 600/h/IP, signup paths exempt from authLimiter, per-email throttles) a run
// of 150 users over 60s from ONE IP should complete with ~0 rate-limit
// failures; 429s should only appear once the 600/h ceiling is genuinely hit.
const BASE = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const USERS = parseInt(process.env.USERS, 10) || 100;
const RAMP_SECONDS = parseInt(process.env.RAMP_SECONDS, 10) || 60;

const stats = { ok: 0, rateLimited: 0, failed: 0, latencies: [] };
const errors = new Map(); // message → count

const post = async (path, body) => {
  const res = await fetch(`${BASE}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, json };
};

const runUser = async (i) => {
  const email = `loadtest-${Date.now()}-${i}@example.com`;
  const t0 = Date.now();
  try {
    const send = await post('/send-email-code', { email, name: `Load ${i}` });
    if (send.status === 429) { stats.rateLimited++; bump(errors, `send-email-code 429: ${send.json.error}`); return; }
    if (send.status !== 200) { stats.failed++; bump(errors, `send-email-code ${send.status}: ${send.json.error}`); return; }
    if (!send.json.devCode) {
      console.error('\n❌ Server returned no devCode — this is NOT a dev-mode instance. Aborting (never load-test prod).');
      process.exit(1);
    }

    const verify = await post('/verify-email-code', { email, code: send.json.devCode });
    if (verify.status === 429) { stats.rateLimited++; bump(errors, `verify 429: ${verify.json.error}`); return; }
    if (verify.status !== 200) { stats.failed++; bump(errors, `verify ${verify.status}: ${verify.json.error}`); return; }

    const reg = await post('/register', {
      email,
      password: 'LoadTest1!x',
      name: `Load ${i}`,
      date_of_birth: '1995-05-05',
    });
    if (reg.status === 429) { stats.rateLimited++; bump(errors, `register 429: ${reg.json.error}`); return; }
    if (reg.status !== 200 && reg.status !== 201) { stats.failed++; bump(errors, `register ${reg.status}: ${reg.json.error}`); return; }

    stats.ok++;
    stats.latencies.push(Date.now() - t0);
  } catch (err) {
    stats.failed++;
    bump(errors, `network: ${err.message}`);
  }
};

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const main = async () => {
  console.log(`Signup load-sim → ${BASE} | ${USERS} users over ${RAMP_SECONDS}s (single source IP = NAT worst case)\n`);
  const tasks = [];
  for (let i = 0; i < USERS; i++) {
    const delay = Math.floor((i / USERS) * RAMP_SECONDS * 1000) + Math.floor(Math.random() * 500);
    tasks.push(new Promise(resolve => setTimeout(() => runUser(i).then(resolve), delay)));
  }
  const t0 = Date.now();
  await Promise.all(tasks);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('── RESULT ───────────────────────────────────────────');
  console.log(`   Complete signups: ${stats.ok}/${USERS} in ${wall}s`);
  console.log(`   Rate-limited:     ${stats.rateLimited}`);
  console.log(`   Failed:           ${stats.failed}`);
  console.log(`   Flow latency:     p50 ${pct(stats.latencies, 50)}ms · p95 ${pct(stats.latencies, 95)}ms · max ${pct(stats.latencies, 100)}ms`);
  if (errors.size) {
    console.log('   Error breakdown:');
    for (const [msg, n] of [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`     ${n}× ${msg}`);
    }
  }
  process.exit(stats.ok === USERS ? 0 : 2);
};

main();
