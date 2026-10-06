// Test d'intégration temps réel (WebSocket) du chat.
// Nécessite un VRAI serveur en écoute (pas app.inject) + DB/Redis → CI uniquement.
import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

const PHONE_PATIENT = '+2290196020001';
const PHONE_DOCTOR = '+2290196020002';
const ALL_PHONES = [PHONE_PATIENT, PHONE_DOCTOR];

function waitOpen(ws: WebSocket, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout open')), ms);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function nextMessage(ws: WebSocket, ms = 5000): Promise<{ type: string; threadId: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout message')), ms);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe.skipIf(!HAS_INFRA)('Chat temps réel (WebSocket)', () => {
  let app: FastifyInstance;
  let port: number;
  let patientToken: string;
  let doctorToken: string;
  let threadId: string;

  async function registerAndLogin(payload: Record<string, unknown>) {
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    const devCode = reg.json().otp.devCode as string;
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: payload.phone, code: devCode },
    });
    return verify.json().accessToken as string;
  }

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });

    patientToken = await registerAndLogin({
      phone: PHONE_PATIENT,
      role: 'PATIENT',
      lang: 'FR',
      firstName: 'Koffi',
      lastName: 'Realtime',
    });
    doctorToken = await registerAndLogin({
      phone: PHONE_DOCTOR,
      role: 'MEDECIN',
      lang: 'FR',
      firstName: 'Awa',
      lastName: 'Realtime',
      speciality: 'Cardiologie',
      licenseNumber: 'ORD-RT-001',
      consultFee: 5000,
    });

    const doctorId = (
      await app.prisma.doctor.findFirstOrThrow({
        where: { user: { phone: PHONE_DOCTOR } },
        select: { id: true },
      })
    ).id;
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/threads',
      headers: { authorization: `Bearer ${patientToken}` },
      payload: { counterpartId: doctorId },
    });
    threadId = open.json().id as string;

    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
    await app.close();
  });

  it('le patient reçoit un événement temps réel quand le médecin écrit', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/chat/ws?token=${patientToken}`);
    await waitOpen(ws);

    const received = nextMessage(ws);
    // Le médecin envoie un message via REST → publication Redis → push WS au patient.
    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/chat/threads/${threadId}/messages`,
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: { body: 'Bonjour, je vous écoute.' },
    });
    expect(send.statusCode).toBe(201);

    const event = await received;
    expect(event.type).toBe('chat');
    expect(event.threadId).toBe(threadId);
    ws.close();
  });

  it('refuse une connexion sans jeton valide', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/chat/ws?token=invalide`);
    const closed = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout close')), 4000);
      ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.once('error', () => {
        /* certaines plateformes émettent error avant close */
      });
    });
    expect(closed).toBe(1008);
  });

  it('refuse la reconnexion WebSocket avec le JWT d’un compte suspendu', async () => {
    await app.prisma.user.update({ where: { phone: PHONE_PATIENT }, data: { status: 'SUSPENDED' } });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/chat/ws?token=${patientToken}`);
    const closed = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout close')), 4000);
      ws.once('close', (code) => { clearTimeout(timer); resolve(code); });
      ws.once('error', () => { /* close donne le résultat */ });
    });
    expect(closed).toBe(1008);
  });
});
