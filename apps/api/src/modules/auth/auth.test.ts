// Tests d'intégration du module Auth via app.inject().
// Exécutés UNIQUEMENT si DATABASE_URL et REDIS_URL sont présents (CI) ;
// sinon le bloc est ignoré (pnpm test reste vert en local sans infra).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_INFRA = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const PHONE = '+2290196000777';
// Numéros dédiés aux tests de rôle (isolés du parcours principal).
const PHONE_DOC = '+2290196000778';
const PHONE_DOC_KO = '+2290196000779';
const PHONE_ADMIN = '+2290196000780';
const PHONE_LOGOUT = '+2290196000781';
const PHONE_SUSPEND = '+2290196000782';
const ALL_PHONES = [PHONE, PHONE_DOC, PHONE_DOC_KO, PHONE_ADMIN, PHONE_LOGOUT, PHONE_SUSPEND];
const otpKeysFor = (p: string) => [`otp:${p}`, `otp:attempts:${p}`, `otp:lock:${p}`];
const otpKeys = otpKeysFor(PHONE);
const allOtpKeys = ALL_PHONES.flatMap(otpKeysFor);

describe.skipIf(!HAS_INFRA)('Auth (intégration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Import dynamique : ne charge env/serveur que lorsque l'infra est disponible.
    const { buildServer } = await import('@/server.js');
    app = await buildServer();
    await app.ready();
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
    await app.redis.del(...allOtpKeys);
  });

  afterAll(async () => {
    if (!app) return;
    await app.prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
    await app.redis.del(...allOtpKeys);
    await app.close();
  });

  it('inscription → OTP → vérification → tokens → /me → refresh', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone: PHONE, role: 'PATIENT', lang: 'FR', firstName: 'Test', lastName: 'User' },
    });
    expect(reg.statusCode).toBe(201);
    const devCode = reg.json().otp.devCode as string;
    expect(devCode).toMatch(/^\d{6}$/);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: devCode },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json();
    expect(body.user.status).toBe('ACTIVE');
    expect(body.accessToken).toBeTruthy();
    // Le refresh N'EST PLUS dans le corps : il est posé en cookie HttpOnly (C6).
    expect(body.refreshToken).toBeUndefined();
    const rt = verify.cookies.find((c) => c.name === 'digisante_rt');
    expect(rt?.value).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().phone).toBe(PHONE);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { digisante_rt: rt!.value },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTruthy();
    expect(refreshed.json().user.phone).toBe(PHONE); // reprise de session en un appel

    // L'enregistrement de rôle DOIT exister (bug racine corrigé) :
    // un PATIENT a un Patient + un Wallet.
    const userId = body.user.id as string;
    const patient = await app.prisma.patient.findUnique({ where: { userId } });
    const wallet = await app.prisma.wallet.findUnique({ where: { userId } });
    expect(patient).not.toBeNull();
    expect(wallet).not.toBeNull();
    expect(wallet?.currency).toBe('XOF');
  });

  it('register MEDECIN → crée un Doctor (speciality + licenseNumber)', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: PHONE_DOC,
        role: 'MEDECIN',
        lang: 'FR',
        firstName: 'Dr',
        lastName: 'Test',
        speciality: 'Cardiologie',
        licenseNumber: 'ORD-TEST-001',
        consultFee: 5000,
      },
    });
    expect(reg.statusCode).toBe(201);
    const userId = reg.json().user.id as string;
    const doctor = await app.prisma.doctor.findUnique({ where: { userId } });
    expect(doctor).not.toBeNull();
    expect(doctor?.speciality).toBe('Cardiologie');
    expect(doctor?.licenseNumber).toBe('ORD-TEST-001');
    expect(doctor?.verifiedAt).toBeNull();
  });

  it('register MEDECIN sans licenseNumber → 422 (validation)', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: PHONE_DOC_KO,
        role: 'MEDECIN',
        lang: 'FR',
        firstName: 'Dr',
        lastName: 'Incomplet',
        speciality: 'Cardiologie',
      },
    });
    expect(reg.statusCode).toBe(422);
    // Aucun compte ne doit avoir été créé.
    const u = await app.prisma.user.findUnique({ where: { phone: PHONE_DOC_KO } });
    expect(u).toBeNull();
  });

  it('register ADMIN → rejeté (422, auto-inscription interdite)', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: PHONE_ADMIN,
        role: 'ADMIN',
        lang: 'FR',
        firstName: 'Admin',
        lastName: 'Test',
      },
    });
    expect(reg.statusCode).toBe(422);
    const u = await app.prisma.user.findUnique({ where: { phone: PHONE_ADMIN } });
    expect(u).toBeNull();
  });

  it('logout → révoque le refresh token (refresh ensuite en 401)', async () => {
    // Inscription + activation pour obtenir des jetons valides.
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone: PHONE_LOGOUT, role: 'PATIENT', lang: 'FR', firstName: 'Log', lastName: 'Out' },
    });
    expect(reg.statusCode).toBe(201);
    const devCode = reg.json().otp.devCode as string;

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE_LOGOUT, code: devCode },
    });
    expect(verify.statusCode).toBe(200);
    const accessToken = verify.json().accessToken as string;
    const rtValue = verify.cookies.find((c) => c.name === 'digisante_rt')!.value;

    // Appareil enregistré pour le push (FCM) avant la déconnexion.
    const device = await app.inject({
      method: 'POST', url: '/api/v1/users/me/device',
      headers: { authorization: `Bearer ${accessToken}` }, payload: { fcmToken: 'fcm-device-token-logout' },
    });
    expect(device.statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      cookies: { digisante_rt: rtValue },
    });
    expect(logout.statusCode).toBe(204);
    // Le cookie de refresh est effacé (Max-Age=0).
    expect(logout.cookies.find((c) => c.name === 'digisante_rt')?.value).toBe('');
    // Appareil partagé : plus aucune notification du compte après déconnexion (§4).
    const after = await app.prisma.user.findUniqueOrThrow({ where: { phone: PHONE_LOGOUT }, select: { fcmToken: true } });
    expect(after.fcmToken).toBeNull();

    // Le refresh révoqué ne doit plus fonctionner (même en présentant l'ancien cookie).
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { digisante_rt: rtValue },
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it('compte suspendu : refresh ET reconnexion OTP refusés (401)', async () => {
    // Inscription + activation.
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone: PHONE_SUSPEND, role: 'PATIENT', lang: 'FR', firstName: 'Sus', lastName: 'Pendu' },
    });
    expect(reg.statusCode).toBe(201);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE_SUSPEND, code: reg.json().otp.devCode },
    });
    expect(verify.statusCode).toBe(200);
    const user = verify.json().user;
    const rtValue = verify.cookies.find((c) => c.name === 'digisante_rt')!.value;

    // L'admin suspend le compte.
    await app.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    // Le refresh ne doit plus délivrer de jetons (sinon session 30 j).
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { digisante_rt: rtValue },
    });
    expect(refreshed.statusCode).toBe(401);

    // La reconnexion par OTP doit aussi échouer même avec un code valide.
    const req = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONE_SUSPEND } });
    expect(req.statusCode).toBe(200);
    const reVerify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE_SUSPEND, code: req.json().devCode },
    });
    expect(reVerify.statusCode).toBe(401);
    await app.redis.del(...otpKeysFor(PHONE_SUSPEND));
  });

  it('rejette /me sans token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('verrouille après 5 OTP erronés (429)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONE } });

    let last = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: '999999' },
    });
    for (let i = 0; i < 4; i++) {
      last = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { phone: PHONE, code: '999999' },
      });
    }
    expect(last.statusCode).toBe(429);

    const locked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { phone: PHONE, code: '999999' },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('TOO_MANY_REQUESTS');

    await app.redis.del(...otpKeys); // libère le verrou pour les exécutions suivantes
  });
});
