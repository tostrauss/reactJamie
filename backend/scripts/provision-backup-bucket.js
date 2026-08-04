// One-shot provisioning for the offsite backup vault (BACKUP-SETUP-ANLEITUNG
// Schritt 3+4).
//
// R2 REALITY CHECK (learned live, 2026-08-04): R2 does NOT implement the S3
// Object-Lock API — CreateBucket with x-amz-bucket-object-lock-enabled
// returns NotImplemented, and per-object lock headers are rejected too.
// Cloudflare's equivalent is its native **Bucket Locks** feature (retention
// rules, dashboard: bucket → Settings → Bucket lock, or the Cloudflare REST
// API /r2/buckets/{name}/lock — a Cloudflare Bearer token, NOT S3 creds).
// The WORM guarantee for the insurer therefore comes from a Bucket-Lock rule
// ("retain db/ objects ≥30 days"), not from S3 Object Lock.
//
// What this script does via the S3 API, idempotently:
//   1. CreateBucket `jamie-backups` (plain — lock is added as a Bucket-Lock
//      rule afterwards, which CAN be done post-creation, unlike S3's flavor)
//   2. Lifecycle: expire objects under db/ after 37d (Anleitung 4b)
//   3. Optionally, with ADMIN_API_TOKEN (the Cloudflare "Token value") in the
//      cred file: sets + verifies the Bucket-Lock rule via the REST API.
//
// Credentials: NEVER passed on the command line. Reads KEY=VALUE lines from a
// local, git-ignored file (default ../cloudflare-auth.md in the repo root,
// override with CRED_FILE=/path). Needs a TEMPORARY Admin Read & Write R2
// token (24h TTL) — the permanent Railway token stays Object-scoped.
//   ACCOUNT_ID=...
//   ADMIN_ACCESS_KEY_ID=...
//   ADMIN_SECRET_ACCESS_KEY=...
//
// Run from backend/:  node scripts/provision-backup-bucket.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const BUCKET = process.env.BACKUP_BUCKET_NAME || 'jamie-backups';
const RETENTION_DAYS = 30;
const EXPIRE_DAYS = 37; // > retention on purpose: lock runs out first, then lifecycle may delete

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credFile = process.env.CRED_FILE || path.resolve(__dirname, '../../cloudflare-auth.md');

function readCreds(file) {
  if (!fs.existsSync(file)) {
    console.error(`❌ Credential file not found: ${file}`);
    console.error('   Expected KEY=VALUE lines: ACCOUNT_ID, ADMIN_ACCESS_KEY_ID, ADMIN_SECRET_ACCESS_KEY');
    process.exit(1);
  }
  const creds = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    creds[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const missing = ['ACCOUNT_ID', 'ADMIN_ACCESS_KEY_ID', 'ADMIN_SECRET_ACCESS_KEY'].filter(k => !creds[k]);
  if (missing.length) {
    console.error(`❌ Missing in ${path.basename(file)}: ${missing.join(', ')}`);
    process.exit(1);
  }
  return creds;
}

const creds = readCreds(credFile);
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${creds.ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: creds.ADMIN_ACCESS_KEY_ID,
    secretAccessKey: creds.ADMIN_SECRET_ACCESS_KEY,
  },
  // R2 compatibility: only send checksums where the S3 API requires them.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// Cloudflare REST helper for the native Bucket-Lock feature (NOT S3).
async function cfLockApi(method, body) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.ACCOUNT_ID}/r2/buckets/${BUCKET}/lock`,
    {
      method,
      headers: {
        Authorization: `Bearer ${creds.ADMIN_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors || []).map(e => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare lock API ${method} failed: ${msg}`);
  }
  return json.result;
}

const main = async () => {
  console.log(`Vault provisioning → bucket "${BUCKET}" @ account ${creds.ACCOUNT_ID.slice(0, 6)}…\n`);

  // ── 1. Create bucket (plain — Bucket Lock is attached afterwards) ─────
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log('✅ 1/3 Bucket created');
  } catch (err) {
    if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
      await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
      console.log('✅ 1/3 Bucket already exists — continuing');
    } else {
      throw err;
    }
  }

  // ── 2. Lifecycle: expire db/ after 37d ────────────────────────────────
  await client.send(new PutBucketLifecycleConfigurationCommand({
    Bucket: BUCKET,
    LifecycleConfiguration: {
      Rules: [{
        ID: `expire-${EXPIRE_DAYS}d`,
        Status: 'Enabled',
        // db/ ONLY — media/ is a permanent mirror and must NEVER expire.
        Filter: { Prefix: 'db/' },
        Expiration: { Days: EXPIRE_DAYS },
      }],
    },
  }));
  console.log(`✅ 2/3 Lifecycle set: delete db/* after ${EXPIRE_DAYS} days (media/ untouched)`);

  // ── 3. Bucket-Lock rule (WORM) via Cloudflare REST API ────────────────
  let lockVerified = false;
  if (creds.ADMIN_API_TOKEN) {
    await cfLockApi('PUT', {
      rules: [{
        id: `retain-db-${RETENTION_DAYS}d`,
        enabled: true,
        prefix: 'db/',
        condition: { type: 'Age', maxAgeSeconds: RETENTION_DAYS * 24 * 60 * 60 },
      }],
    });
    const rules = await cfLockApi('GET');
    const list = rules?.rules || rules || [];
    console.log('✅ 3/3 Bucket-Lock rule set via Cloudflare API\n');
    console.log('── VERIFICATION (read back) ─────────────────────────');
    for (const r of list) {
      const days = r.condition?.maxAgeSeconds ? Math.round(r.condition.maxAgeSeconds / 86400) : '?';
      console.log(`   Lock rule:  [${r.enabled ? 'Enabled' : 'DISABLED'}] ${r.id} — prefix "${r.prefix ?? '(all)'}" retain ${days} days`);
      if (r.enabled && r.condition?.maxAgeSeconds === RETENTION_DAYS * 86400) lockVerified = true;
    }
  } else {
    console.log('⚠️ 3/3 SKIPPED — no ADMIN_API_TOKEN in cred file.');
    console.log('   Set the Bucket-Lock rule in the dashboard instead:');
    console.log(`   R2 → ${BUCKET} → Settings → Bucket lock → Add rule:`);
    console.log(`   prefix "db/", retain for ${RETENTION_DAYS} days.`);
  }

  const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
  for (const r of lc.Rules || []) {
    console.log(`   Lifecycle:  [${r.Status}] ${r.ID} — prefix "${r.Filter?.Prefix ?? ''}" expires after ${r.Expiration?.Days} days`);
  }
  console.log(lockVerified
    ? '\n🎉 Vault ready — Anleitung Schritt 3 + 4a + 4b erfüllt (WORM via Cloudflare Bucket Lock).'
    : '\n➡️ Bucket + Lifecycle stehen. WORM-Lock-Regel noch setzen/verifizieren (siehe oben).');
  process.exit(0);
};

main().catch(err => {
  // Never echo credentials — SDK errors don't contain them, but keep it terse.
  console.error(`❌ ${err.name || 'Error'}: ${err.message}`);
  process.exit(1);
});
