// Une revue administrative KYC ne lève jamais une suspension utilisateur.
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reviewSubmission } from './kyc.service.js';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const ROLES = ['MEDECIN', 'PHARMACIE'] as const;
const DECISIONS = ['APPROVED', 'REJECTED', 'NEEDS_REVISION'] as const;

describe.skipIf(!HAS_INFRA)('KYC — suspension utilisateur', () => {
  let app: FastifyInstance;
  let reviewerToken: string;
  let reviewerId: string;
  let operatorToken: string;
  const userIds: string[] = [];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const professional = async (role: typeof ROLES[number], status: 'ACTIVE' | 'PENDING_KYC' | 'SUSPENDED') => {
    const phone = '+' + randomUUID();
    const user = await app.prisma.user.create({
      data: {
        phone, role, status,
        ...(role === 'MEDECIN'
          ? { doctor: { create: { speciality: 'Synthétique', licenseNumber: 'BJ-TST-' + Date.now(), consultFee: 0 } } }
          : { pharmacy: { create: { name: 'Synthétique', address: 'Synthétique', phone } } }),
      },
      include: { doctor: true },
    });
    userIds.push(user.id);
    const submission = await app.prisma.kycSubmission.create({ data: { userId: user.id, status: 'UNDER_REVIEW', submittedAt: new Date() } });
    return { user, submission };
  };
  const review = (submissionId: string, decision: typeof DECISIONS[number]) => app.inject({
    method: 'POST', url: `/api/v1/kyc/submissions/${submissionId}/review`,
    headers: auth(reviewerToken), payload: { decision },
  });
  const unchanged = async (userId: string, submissionId: string) => {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { doctor: true } });
    const submission = await app.prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { reviews: true } });
    expect(user.status).toBe('SUSPENDED');
    if (user.doctor) expect(user.doctor.verifiedAt).toBeNull();
    expect(submission.status).toBe('UNDER_REVIEW');
    expect(submission.reviewedAt).toBeNull();
    expect(submission.reviews).toHaveLength(0);
    expect(await app.prisma.auditLog.count({ where: { targetId: userId, action: { in: ['KYC_APPROVE', 'KYC_REJECT', 'KYC_REVISION'] } } })).toBe(0);
  };

  beforeAll(async () => {
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    const createAdmin = async (scopes: string[]) => {
      const user = await app.prisma.user.create({ data: {
        phone: '+' + randomUUID(), role: 'ADMIN', status: 'ACTIVE',
        adminProfile: { create: { scopes, preset: 'MODERATION' } },
      } });
      userIds.push(user.id);
      return { id: user.id, token: app.jwt.sign({ sub: user.id, role: 'ADMIN' }, { expiresIn: '15m' }) };
    };
    const reviewer = await createAdmin(['kyc:review']);
    reviewerId = reviewer.id;
    reviewerToken = reviewer.token;
    operatorToken = (await createAdmin(['users:write'])).token;
  });
  afterAll(async () => {
    if (!app) return;
    await app.prisma.kycSubmission.deleteMany({ where: { userId: { in: userIds } } });
    await app.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  for (const role of ROLES) {
    for (const decision of DECISIONS) {
      it(`${role} suspendu : ${decision} refusé au reviewer KYC, aucune mutation`, async () => {
        const { user, submission } = await professional(role, 'SUSPENDED');
        expect((await app.inject({ method: 'POST', url: `/api/v1/admin/users/${user.id}/activate`, headers: auth(reviewerToken) })).statusCode).toBe(403);
        expect((await review(submission.id, decision)).statusCode).toBe(403);
        await unchanged(user.id, submission.id);
      });
    }

    it(`${role} : réactivation explicite puis approbation KYC conservée`, async () => {
      const { user, submission } = await professional(role, 'SUSPENDED');
      expect((await app.inject({ method: 'POST', url: `/api/v1/admin/users/${user.id}/activate`, headers: auth(operatorToken) })).statusCode).toBe(200);
      const response = await review(submission.id, 'APPROVED');
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('APPROVED');
      if (role === 'MEDECIN') expect(response.json().cnom.source).toBe('FORMAT_HEURISTIC');
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    });

    it(`${role} : une suspension gagnante au verrou interdit l’approbation engagée en parallèle`, async () => {
      const { user, submission } = await professional(role, 'ACTIVE');
      let locked!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => { locked = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const suspension = app.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
        locked();
        await gate;
      });
      await ready;
      const approval = reviewSubmission(app, reviewerId, submission.id, { decision: 'APPROVED' });
      const rejected = expect(approval).rejects.toMatchObject({ statusCode: 403 });
      release();
      await suspension;
      await rejected;
      await unchanged(user.id, submission.id);
    });
  }
});
