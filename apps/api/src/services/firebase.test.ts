// Tests unitaires des helpers purs du service FCM (sans réseau ni clés).
import { describe, expect, it } from 'vitest';

import { buildFcmMessage, classifyFcmError, normalizePrivateKey } from './firebase.js';

describe('firebase / buildFcmMessage', () => {
  it('construit un message HTTP v1 valide (notification + priorité haute)', () => {
    const msg = buildFcmMessage('tok-123', 'Rappel', 'Prenez votre traitement');
    expect(msg.message.token).toBe('tok-123');
    expect(msg.message.notification).toEqual({ title: 'Rappel', body: 'Prenez votre traitement' });
    expect(msg.message.android.priority).toBe('high');
    expect(msg.message.data).toBeUndefined();
  });

  it('inclut le bloc data quand fourni', () => {
    const msg = buildFcmMessage('tok', 'T', 'B', { type: 'SOS_ALERT', id: 'abc' });
    expect(msg.message.data).toEqual({ type: 'SOS_ALERT', id: 'abc' });
  });
});

describe('firebase / classifyFcmError', () => {
  it('marque le token invalide sur UNREGISTERED (404)', () => {
    expect(classifyFcmError(404).invalidToken).toBe(true);
  });
  it('marque le token invalide sur INVALID_ARGUMENT (400) et SENDER_ID_MISMATCH (403)', () => {
    expect(classifyFcmError(400, 'INVALID_ARGUMENT').invalidToken).toBe(true);
    expect(classifyFcmError(403, 'SENDER_ID_MISMATCH').invalidToken).toBe(true);
  });
  it('ne purge pas le token sur erreur transitoire (500) ni succès', () => {
    expect(classifyFcmError(500, 'INTERNAL').invalidToken).toBe(false);
    expect(classifyFcmError(200).invalidToken).toBe(false);
    expect(classifyFcmError(400, 'QUOTA_EXCEEDED').invalidToken).toBe(false);
  });
});

describe('firebase / normalizePrivateKey', () => {
  it('convertit les "\\n" littéraux en vrais sauts de ligne', () => {
    const raw = '-----BEGIN PRIVATE KEY-----\\nABC\\nDEF\\n-----END PRIVATE KEY-----';
    const out = normalizePrivateKey(raw);
    expect(out).toContain('\n');
    expect(out).not.toContain('\\n');
    expect(out.split('\n')).toHaveLength(4);
  });
  it('laisse intacte une clé déjà multi-lignes', () => {
    const raw = '-----BEGIN-----\nABC\n-----END-----';
    expect(normalizePrivateKey(raw)).toBe(raw);
  });
});
