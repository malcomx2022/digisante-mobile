// Journalisation sans donnée sensible (§4) : URL du WebSocket et erreurs Prisma.
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { sanitizeLogUrl, serializeErrorForLog } from './log-sanitize.js';

describe('sanitizeLogUrl', () => {
  it('masque token / access_token de la query', () => {
    expect(sanitizeLogUrl('/api/v1/chat/ws?token=eyJabc.def&x=1')).toBe('/api/v1/chat/ws');
    expect(sanitizeLogUrl('/a?access_token=zzz')).toBe('/a');
  });
  it('DMP, paramètre encodé, fragment et clé inconnue : aucune valeur ne passe', () => {
    for (const url of ['/api/v1/dmp/records?share_token=secret', '/patient/dmp?%74oken=secret', '/x?new_key=secret#secret']) expect(sanitizeLogUrl(url)).not.toContain('secret');
  });
  it('erreur arbitraire contenant jeton et santé : jamais de texte ni de pile copiée', () => {
    const error = new Error('secret-bearer VIH +229'); expect(JSON.stringify(serializeErrorForLog(error))).not.toMatch(/secret-bearer|VIH|229/);
    expect(JSON.stringify(serializeErrorForLog({ body: 'secret-bearer' }))).not.toContain('secret-bearer');
  });
});

describe('serializeErrorForLog', () => {
  it('erreur de validation Prisma : ni arguments ni valeurs, seulement l’opération', () => {
    const message = [
      '',
      'Invalid `prisma.medicalRecord.create()` invocation in',
      '/app/src/modules/dmp/dmp.service.ts:10:42',
      '→ 10   const rec = await prisma.medicalRecord.create({',
      '         data: { title: "Diabète type 2 — HbA1c 9,1 %", patientId: "cmu123" }',
    ].join('\n');
    const err = new Prisma.PrismaClientValidationError(message, { clientVersion: '5.22.0' });
    const out = serializeErrorForLog(err);
    const dump = JSON.stringify(out);
    expect(out).toMatchObject({ type: 'PrismaClientValidationError', operation: 'prisma.medicalRecord.create()' });
    expect(dump).not.toContain('Diabète');
    expect(dump).not.toContain('HbA1c');
    expect(dump).not.toContain('cmu123');
  });

  it('erreur connue Prisma (P2002) : code et NOMS de colonnes seulement', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`phone`)', {
      code: 'P2002', clientVersion: '5.22.0', meta: { target: ['phone'], modelName: 'User' },
    });
    expect(serializeErrorForLog(err)).toMatchObject({ code: 'P2002', target: ['phone'], model: 'User' });
  });

  it('erreur ordinaire : seul le type est conservé, message et pile arbitraires refusés', () => {
    const out = serializeErrorForLog(new TypeError('x is undefined'));
    expect(out.type).toBe('TypeError');
    expect(JSON.stringify(out)).not.toContain('x is undefined');
  });
});
