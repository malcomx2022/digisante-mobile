// Push FCM côté web : config PUBLIQUE uniquement, jamais de secret serveur.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseFirebaseConfig } from './push';

const FULL = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIza-public',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'digisante-prod',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:abc',
  NEXT_PUBLIC_FIREBASE_VAPID_KEY: 'BPub-vapid',
};

describe('parseFirebaseConfig', () => {
  it('config complète → objet, authDomain déduit du projet par défaut', () => {
    expect(parseFirebaseConfig(FULL)).toMatchObject({ projectId: 'digisante-prod', authDomain: 'digisante-prod.firebaseapp.com' });
    expect(parseFirebaseConfig({ ...FULL, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'auth.digisante.bj' })?.authDomain).toBe('auth.digisante.bj');
  });

  it('une seule valeur manquante (dont la clé VAPID) → null : le push reste inactif', () => {
    for (const k of Object.keys(FULL)) {
      expect(parseFirebaseConfig({ ...FULL, [k]: undefined }), k).toBeNull();
    }
  });
});

describe('aucun secret Firebase SERVEUR dans le code livré au navigateur', () => {
  const WEB = resolve(__dirname, '../..');
  const files = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.(tsx?|js|mjs)$/.test(n) && !n.endsWith('.test.ts')) out.push(p);
    }
    return out;
  };
  const sources = [...files(join(WEB, 'src')), ...files(join(WEB, 'public'))];

  it('aucune référence aux variables serveur FIREBASE_* (hors NEXT_PUBLIC_)', () => {
    const offenders = sources.filter((f) => /process\.env\.FIREBASE_|(?<!NEXT_PUBLIC_)FIREBASE_(PRIVATE_KEY|CLIENT_EMAIL)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('aucune clé privée PEM ni adresse de compte de service', () => {
    const offenders = sources.filter((f) => /BEGIN PRIVATE KEY|iam\.gserviceaccount\.com|private_key/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
