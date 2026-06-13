# Guide d'implémentation — Daily.co (téléconsultation vidéo)

> **Destiné à Claude Code.** À lire avec `CLAUDE.md` et `docs/PLAYBOOK_Codage_DigiSante.md`
> (prompt **P3.2 — RDV, agenda, téléconsultation**). Stack : backend **Fastify** (crée les
> salles et jetons), frontend **Next.js** (rejoint l'appel). Écrans concernés : **D-06**
> (téléconsultation patient) et **D-14/D-16** (côté médecin).

---

## 1. Objet & périmètre
- Créer une **salle privée** Daily par consultation, avec expiration.
- Émettre des **meeting tokens** par participant (médecin = `is_owner`, patient = invité).
- Joindre l'appel côté web ; basculer audio/chat si réseau faible.
- Nettoyer les salles expirées.

## 2. Prérequis (`apps/api/.env`)
```
DAILY_API_KEY        # onglet Developers du dashboard Daily
DAILY_DOMAIN         # ton sous-domaine, ex. "digisante" (=> digisante.daily.co)
```
Frontend : pas de clé (le frontend reçoit l'URL de salle + le token depuis l'API).

## 3. Contraintes techniques
- API REST Daily, **Bearer `DAILY_API_KEY`**. Endpoints :
  - `POST https://api.daily.co/v1/rooms`
  - `POST https://api.daily.co/v1/meeting-tokens`
- **Ne jamais** exposer `DAILY_API_KEY` au navigateur : la création de salle et de token
  se fait **uniquement côté Fastify**.
- Salle **privée** + token obligatoire (un patient ne peut pas rejoindre sans token).
- URL de jonction = `https://<DAILY_DOMAIN>.daily.co/<room>?t=<token>`.
- **Mode stub** : sans `DAILY_API_KEY`, l'API démarre ; les fonctions loggent un warning.

---

## 4. Tâches d'implémentation

### T1 — Service Daily (backend)
- `apps/api/src/services/daily.ts` (fetch natif, pas de SDK requis) :
```ts
const BASE = 'https://api.daily.co/v1';
const headers = () => ({
  Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
  'Content-Type': 'application/json',
});

export async function createRoom(consultId: string) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // expire dans 1h
  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      name: `consult-${consultId}`,
      privacy: 'private',
      properties: { exp, eject_at_room_exp: true, enable_prejoin_ui: true },
    }),
  });
  if (!res.ok) throw new Error(`Daily room error ${res.status}`);
  return res.json(); // { name, url, ... }
}

export async function createMeetingToken(roomName: string, userName: string, isOwner: boolean) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const res = await fetch(`${BASE}/meeting-tokens`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ properties: { room_name: roomName, user_name: userName, is_owner: isOwner, exp } }),
  });
  if (!res.ok) throw new Error(`Daily token error ${res.status}`);
  const { token } = await res.json();
  return token;
}
```

### T2 — Lier à la consultation (Prisma)
- Sur le modèle `Consultation`, ajouter `roomName`, `roomUrl`. La salle est créée à
  l'ouverture de la téléconsultation (ou à la confirmation du RDV).

### T3 — Endpoint « rejoindre »
- `POST /api/v1/consultations/:id/join` (protégé JWT) :
  1. vérifier que l'appelant est bien le **patient** ou le **médecin** de cette consultation,
  2. créer la salle si absente,
  3. émettre un **token** adapté au rôle (`is_owner = true` pour le médecin),
  4. renvoyer `{ roomUrl, token }`. **Ne jamais** renvoyer la clé API.

### T4 — Frontend (Next.js)
```bash
pnpm --filter @digisante/web add @daily-co/daily-js
```
- Sur l'écran D-06 : appeler l'endpoint join, puis :
```ts
import DailyIframe from '@daily-co/daily-js';
const call = DailyIframe.createFrame(containerEl, { showLeaveButton: true });
await call.join({ url: roomUrl, token });
```
- Réseau faible : écouter les événements qualité (`network-quality-change`) et proposer
  la **bascule audio seul / chat** (cohérent avec la maquette D-06).
- Bouton « raccrocher » → `call.leave()` puis redirection (ex. vers l'ordonnance D-08).

### T5 — Nettoyage
- Les salles expirent via `exp` + `eject_at_room_exp`. Optionnel : cron qui supprime les
  salles `consult-*` terminées (`DELETE /v1/rooms/:name`).

### T6 — Tests (Vitest)
- création de salle (mock fetch),
- token médecin = `is_owner: true`, patient = `false`,
- refus de join si l'utilisateur n'appartient pas à la consultation,
- mode stub.

---

## 5. Critères d'acceptation
- [ ] `POST /consultations/:id/join` renvoie `{ roomUrl, token }` au bon rôle.
- [ ] La clé API n'apparaît jamais côté client (vérifier le bundle / réseau).
- [ ] Médecin et patient se rejoignent dans la même salle ; le médecin est owner.
- [ ] Une salle expirée éjecte les participants.
- [ ] Sans clé, l'API démarre en mode stub.

## 6. Sécurité & confidentialité
- Salles **privées** + tokens à durée de vie courte (`exp`).
- L'accès à une consultation respecte le **lien patient↔médecin** (et le consentement DMP
  pour l'accès au dossier, géré ailleurs).
- Ne pas enregistrer la consultation sans base légale (APDP / consentement explicite).

## 7. Prompt prêt à coller
```
Lis CLAUDE.md, docs/PLAYBOOK_Codage_DigiSante.md et docs/GUIDE_DailyCo_Teleconsultation.md.
Implémente l'intégration Daily.co : service backend (createRoom, createMeetingToken via
l'API REST, clé jamais exposée, mode stub), champs roomName/roomUrl sur Consultation,
endpoint POST /consultations/:id/join (token owner pour le médecin), intégration frontend
@daily-co/daily-js sur l'écran D-06 avec bascule réseau faible, nettoyage des salles,
et tests. Commit : "feat: téléconsultation Daily.co".
```
