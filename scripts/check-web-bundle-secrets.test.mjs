import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scan } from './check-web-bundle-secrets.mjs';

test('détecte clé PEM, compte de service et variables serveur ; ignore la config publique', () => {
  const hits = scan([
    { file: 'a.js', content: 'const k="-----BEGIN PRIVATE KEY-----\\nabc"' },
    { file: 'b.js', content: 'x="fcm@proj.iam.gserviceaccount.com"' },
    { file: 'c.js', content: 'process.env.FIREBASE_PRIVATE_KEY' },
    { file: 'd.js', content: 'apiKey:"AIzaSyPublic",projectId:"digisante",NEXT_PUBLIC_FIREBASE_VAPID_KEY' },
  ]);
  assert.deepEqual(hits.map((h) => h.file), ['a.js', 'b.js', 'c.js']);
});
