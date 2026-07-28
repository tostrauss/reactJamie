// ─────────────────────────────────────────────────────────────────────────────
// JAMIE Socket.IO connection storm — opens up to CONNECTIONS concurrent live
// WebSocket connections against the backend, ramped in batches. This is THE
// scaling metric for a chat app on a single Railway instance: how many
// simultaneous sockets can one box hold before connect latency climbs or the
// event loop / memory tips over?
//
// It mints a validly-signed JWT per connection (matching socket.js auth:
// HS256, iss jamie-api, aud jamie-app). The user id does NOT need to exist in
// the DB — connecting + joining the personal `user_<id>` room works for any id,
// which is exactly the connection-capacity path we want to measure. (Sending
// room messages needs real membership; that's out of scope for a capacity test.)
//
// Requires the prod/staging JWT_SECRET so the handshake passes. Run vs STAGING:
//   cd loadtest && npm install
//   JWT_SECRET=<secret> BASE_URL=https://staging.example.com CONNECTIONS=1000 node socket-storm.js
//
// While it runs, watch the backend's memory/CPU in the Railway dashboard —
// that graph + the connect-latency numbers below tell you the real ceiling.
//
// Knobs (env):
//   BASE_URL     (default http://localhost:5000)
//   JWT_SECRET   (required)
//   CONNECTIONS  (default 1000)   total sockets to open
//   BATCH        (default 50)     sockets opened per wave
//   BATCH_DELAY  (default 250)    ms between waves (ramp speed)
//   HOLD_MS      (default 30000)  ms to hold all sockets open before closing
// ─────────────────────────────────────────────────────────────────────────────
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

const BASE = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const SECRET = process.env.JWT_SECRET;
const TOTAL = parseInt(process.env.CONNECTIONS || '1000', 10);
const BATCH = parseInt(process.env.BATCH || '50', 10);
const BATCH_DELAY = parseInt(process.env.BATCH_DELAY || '250', 10);
const HOLD_MS = parseInt(process.env.HOLD_MS || '30000', 10);

if (!SECRET) {
  console.error('FATAL: JWT_SECRET is required (must match the backend).');
  process.exit(1);
}

const mint = (userId) =>
  jwt.sign({ id: userId }, SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    issuer: 'jamie-api',
    audience: 'jamie-app',
  });

const sockets = [];
const connectLatencies = [];
let connected = 0;
let failed = 0;
const errorCounts = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openOne(userId) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Force websocket (skip long-polling) so we measure real WS capacity, and
    // don't auto-reconnect — a failure should count as a failure, not retry.
    const socket = io(BASE, {
      transports: ['websocket'],
      auth: { token: mint(userId) },
      reconnection: false,
      timeout: 20000,
    });
    let settled = false;
    socket.on('connect', () => {
      if (settled) return;
      settled = true;
      connected++;
      connectLatencies.push(Date.now() - started);
      socket.emit('join_user'); // exercise the personal-room join path
      sockets.push(socket);
      resolve();
    });
    const fail = (label) => {
      if (settled) return;
      settled = true;
      failed++;
      errorCounts[label] = (errorCounts[label] || 0) + 1;
      socket.close();
      resolve();
    };
    socket.on('connect_error', (e) => fail(e.message || 'connect_error'));
    socket.io.on('error', (e) => fail(e?.message || 'transport_error'));
  });
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function run() {
  console.log(`Target ${TOTAL} sockets → ${BASE}  (batch ${BATCH} every ${BATCH_DELAY}ms)`);
  const t0 = Date.now();
  for (let i = 0; i < TOTAL; i += BATCH) {
    const wave = [];
    for (let j = i; j < Math.min(i + BATCH, TOTAL); j++) {
      wave.push(openOne(900000 + j)); // high id range to avoid clashing real users
    }
    await Promise.all(wave);
    process.stdout.write(`\r  connected ${connected}  failed ${failed}  (${i + BATCH}/${TOTAL} attempted)`);
    await sleep(BATCH_DELAY);
  }

  console.log(`\n\n── Ramp complete in ${((Date.now() - t0) / 1000).toFixed(1)}s ──`);
  console.log(`  live sockets:     ${connected}`);
  console.log(`  failed:           ${failed}`);
  console.log(`  connect latency:  p50 ${pct(connectLatencies, 50)}ms  p95 ${pct(connectLatencies, 95)}ms  max ${Math.max(0, ...connectLatencies)}ms`);
  if (Object.keys(errorCounts).length) console.log('  errors:', errorCounts);

  console.log(`\nHolding ${connected} sockets open for ${HOLD_MS / 1000}s — watch backend RAM/CPU in Railway now.`);
  // Count any drops (server pushing sockets off under memory pressure) during hold.
  let dropped = 0;
  for (const s of sockets) s.on('disconnect', () => { dropped++; });
  await sleep(HOLD_MS);
  console.log(`\nHold done. sockets dropped during hold: ${dropped}`);

  for (const s of sockets) s.close();
  console.log('Closed all sockets. Done.');
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
