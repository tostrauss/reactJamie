#!/usr/bin/env node
// Run once: node backend/scripts/generate-vapid-keys.js
// Copy the output into your Railway / .env environment variables.

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('\nVAPID keys generated — add these to your environment:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@jamie-app.com\n`);
console.log('Keep VAPID_PRIVATE_KEY secret. VAPID_PUBLIC_KEY is shared with the browser.\n');
