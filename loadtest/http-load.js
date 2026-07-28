// ─────────────────────────────────────────────────────────────────────────────
// JAMIE HTTP load test — ramps to TARGET virtual users and hammers the heavy
// read paths (feed, clubs, discover-events). Answers: at N concurrent users,
// what is p95 latency + error rate, and does the DB pool (max 50) saturate?
//
// Runner: k6 (https://k6.io). NOT a node script — install the k6 binary:
//   winget install k6            (Windows)
//   brew install k6              (macOS)
//
// Run against STAGING (never prod):
//   k6 run -e BASE_URL=https://staging.example.com http-load.js
//
// Optional — also exercise authenticated endpoints (profile/notifications/dm).
// Provide the signing secret + a REAL user id so tokens verify AND the queries
// return real rows (a non-existent id would 404 and inflate the error rate):
//   k6 run -e BASE_URL=... -e JWT_SECRET=<prod JWT_SECRET> -e USER_ID=123 http-load.js
//
// Knobs (all optional):
//   TARGET_VUS  (default 1000)   peak virtual users
//   RAMP        (default 2m)     time to ramp 0 -> TARGET
//   HOLD        (default 3m)     time held at TARGET
// ─────────────────────────────────────────────────────────────────────────────
import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { Rate } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const JWT_SECRET = __ENV.JWT_SECRET || '';
const USER_ID = __ENV.USER_ID || '';
const TARGET = parseInt(__ENV.TARGET_VUS || '1000', 10);

const appErrors = new Rate('app_errors'); // non-2xx/3xx on any request

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '2m', target: TARGET },
        { duration: __ENV.HOLD || '3m', target: TARGET },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Fail the run if >1% of requests error or p95 latency exceeds 800ms.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    app_errors: ['rate<0.01'],
  },
};

// ── JWT minting (matches middleware/auth.js: HS256, iss jamie-api, aud jamie-app)
function b64url(s) {
  return encoding.b64encode(s, 'rawurl');
}
function mintToken(userId) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    id: userId, iss: 'jamie-api', aud: 'jamie-app', iat: now, exp: now + 3600,
  }));
  const input = `${header}.${payload}`;
  const sig = crypto.hmac('sha256', JWT_SECRET, input, 'base64rawurl');
  return `${input}.${sig}`;
}

// Minted once per VU (module scope is per-VU in k6). null when auth not configured.
const authToken = (JWT_SECRET && USER_ID) ? mintToken(USER_ID) : null;
const authHeaders = authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : null;

// Weighted read mix. Public/optionalAuth endpoints need no token; the browsing
// feed is by far the heaviest real query, so it gets the most weight.
const PUBLIC = [
  { path: '/api/health', w: 1 },
  { path: '/api/groups', w: 5 },              // main feed — heaviest
  { path: '/api/clubs', w: 3 },
  { path: '/api/clubs/events/discover', w: 3 },// cached discover feed
  { path: '/api/groups/categories', w: 1 },
];
const AUTHED = [
  '/api/auth/profile',
  '/api/notifications',
  '/api/dm/conversations',
];

function pickWeighted(list) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of list) { if ((r -= e.w) < 0) return e.path; }
  return list[0].path;
}

export default function () {
  // One public read per iteration (the bulk of real traffic is browsing).
  const pub = http.get(`${BASE}${pickWeighted(PUBLIC)}`);
  check(pub, { 'public 2xx': (r) => r.status >= 200 && r.status < 300 });
  appErrors.add(pub.status >= 400);

  // If auth is configured, occasionally hit an authenticated endpoint too.
  if (authHeaders && Math.random() < 0.4) {
    const path = AUTHED[Math.floor(Math.random() * AUTHED.length)];
    const res = http.get(`${BASE}${path}`, authHeaders);
    check(res, { 'authed 2xx': (r) => r.status >= 200 && r.status < 300 });
    appErrors.add(res.status >= 400);
  }

  // Think time — real users don't fire requests back-to-back.
  sleep(Math.random() * 2 + 0.5);
}
