import jwt from '@fastify/jwt';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireRole } from '@/lib/rbac.js';
import authenticate from './authenticate.js';

describe('Accès JWT et statut courant du compte', () => {
  let app: FastifyInstance;
  const findUnique = vi.fn();

  beforeEach(async () => {
    findUnique.mockReset().mockResolvedValue({ role: 'PATIENT', status: 'ACTIVE' });
    app = Fastify();
    app.decorate('prisma', { user: { findUnique } } as unknown as PrismaClient);
    await app.register(jwt, { secret: 'test-only-authenticate-jwt-secret' });
    await app.register(authenticate);
    app.get('/protected', { preHandler: [app.authenticate] }, async (request) => ({ role: request.user.role }));
    app.get('/doctor', { preHandler: [app.authenticate, requireRole('MEDECIN')] }, async () => ({ ok: true }));
  });

  afterEach(async () => { await app.close(); });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('refuse un JWT valide dès que le compte est suspendu', async () => {
    const token = app.jwt.sign({ sub: 'u', role: 'PATIENT' });
    expect((await app.inject({ url: '/protected', headers: auth(token) })).statusCode).toBe(200);
    findUnique.mockResolvedValue({ role: 'PATIENT', status: 'SUSPENDED' });
    expect((await app.inject({ url: '/protected', headers: auth(token) })).statusCode).toBe(401);
  });

  it('refuse le JWT d’un compte supprimé', async () => {
    findUnique.mockResolvedValue(null);
    const token = app.jwt.sign({ sub: 'deleted', role: 'PATIENT' });
    expect((await app.inject({ url: '/protected', headers: auth(token) })).statusCode).toBe(401);
  });

  it('applique le rôle courant au RBAC malgré un ancien JWT médecin', async () => {
    const token = app.jwt.sign({ sub: 'u', role: 'MEDECIN' });
    expect((await app.inject({ url: '/doctor', headers: auth(token) })).statusCode).toBe(403);
  });

  it('refuse un refresh token avant toute lecture du compte', async () => {
    const token = app.jwt.sign({ sub: 'u', role: 'PATIENT', typ: 'refresh' });
    expect((await app.inject({ url: '/protected', headers: auth(token) })).statusCode).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('n’accorde aucun accès quand la lecture du compte échoue', async () => {
    findUnique.mockRejectedValue(new Error('DB unavailable'));
    const token = app.jwt.sign({ sub: 'u', role: 'PATIENT' });
    expect((await app.inject({ url: '/protected', headers: auth(token) })).statusCode).toBe(500);
  });
});
