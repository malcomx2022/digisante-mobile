# Comptes & clés API — DigiSanté Mobile

> Liste des comptes externes à créer, des liens d'inscription et des variables
> d'environnement associées. À ranger dans `docs/`. Ne **jamais** committer les
> valeurs réelles : elles vont dans `apps/api/.env` (modèle : `.env.example`).

## Vue d'ensemble

| Catégorie | Service | Nécessaire pour |
|---|---|---|
| Paiements | FedaPay | Mobile Money, cartes, wallet diaspora |
| Vidéo | Daily.co | Téléconsultation WebRTC |
| SMS / OTP | Twilio | OTP, rappels, alertes labo, SOS, OTP vocal |
| Push | Firebase (FCM) | Notifications mobiles/web |
| Email | Resend | Emails transactionnels |
| Hébergement | Infomaniak | VPS de production |
| Code / CI | GitHub | Dépôt + GitHub Actions |
| IA dev | Anthropic | Claude Code (CLI) |

---

## 1. FedaPay — paiements

- **Inscription :** https://www.fedapay.com (puis tableau de bord)
- **Workflow :** créer d'abord un **compte test (sandbox)**, puis un **compte live** une fois validé par l'équipe FedaPay.
- **Particularité Bénin :** un marchand établi au Bénin n'a pas besoin de compte bancaire pour démarrer ; le compte doit être vérifié avant les transactions réelles.
- **Docs :** https://docs.fedapay.com
- **Clés à récupérer :**
  - `FEDAPAY_PUBLIC_KEY`
  - `FEDAPAY_SECRET_KEY`
  - `FEDAPAY_WEBHOOK_SECRET` (vérification HMAC des webhooks)

## 2. Daily.co — téléconsultation vidéo

- **Inscription :** https://dashboard.daily.co/signup (free tier, sans carte bancaire)
- À l'inscription, tu choisis ton **sous-domaine** (`ton-domaine.daily.co`).
- **Clé :** onglet *Developers* du dashboard.
  - `DAILY_API_KEY`
- **Docs :** https://docs.daily.co/get-started

## 3. Twilio — SMS / OTP / SOS

- **Inscription :** https://www.twilio.com/try-twilio
- Acheter / configurer un **numéro expéditeur** capable d'envoyer à l'international (+229 Bénin).
- **Clés :**
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER`
- **Docs :** https://www.twilio.com/docs

## 4. Firebase (Google) — notifications push (FCM)

- **Console :** https://console.firebase.google.com (compte Google requis)
- Créer un projet → *Paramètres du projet* → *Comptes de service* → générer une clé privée.
- **Clés :**
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
- **Docs :** https://firebase.google.com/docs/cloud-messaging

## 5. Resend — email transactionnel

- **Inscription :** https://resend.com/signup
- Vérifier le **domaine d'envoi** (enregistrements DNS).
- **Clé :**
  - `RESEND_API_KEY`
- **Docs :** https://resend.com/docs

## 6. Infomaniak — hébergement (production)

- **VPS :** https://www.infomaniak.com/fr/hebergement/vps (Ubuntu 22.04)
- Héberge : PostgreSQL 16 natif, Redis, Nginx, PM2 (cf. `infra/deploy/DEPLOY_VPS.md`).
- Pas de clé applicative — accès **SSH** (clé publique/privée).
- Prévoir un **nom de domaine** : `digisante.bj` + `api.digisante.bj` (pour le SSL Certbot).
- **Variable de sauvegarde :** `BACKUP_PASSPHRASE` (chiffrement du pg_dump).

## 7. GitHub — dépôt & CI/CD

- **Inscription :** https://github.com/signup
- Dépôt **privé** (contient le schéma métier santé).
- **Secrets Actions à configurer** (Settings → Secrets → Actions) :
  - `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`

## 8. Anthropic — Claude Code (CLI)

- **Console :** https://console.anthropic.com
- Selon le mode d'accès : clé API (facturation à l'usage) ou abonnement Claude.
- Sert au développement assisté (voir `docs/PLAYBOOK_Codage_DigiSante.md`).

---

## Modèle `.env` (rappel)

```bash
# Base de données & cache
DATABASE_URL="postgresql://digisante:...@localhost:5432/digisante_dev?schema=public"
REDIS_URL="redis://localhost:6379"

# API
API_PORT=3001
JWT_SECRET="..."
CORS_ORIGIN="http://localhost:3000"

# FedaPay
FEDAPAY_PUBLIC_KEY=""
FEDAPAY_SECRET_KEY=""
FEDAPAY_WEBHOOK_SECRET=""

# Daily.co
DAILY_API_KEY=""

# Twilio
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_FROM_NUMBER=""

# Firebase
FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""

# Resend
RESEND_API_KEY=""
```

---

## Ordre de priorité

1. **Pour démarrer le codage (local) :** aucun compte externe requis — le projet
   fonctionne en **mode stub** quand les clés sont absentes (cf. playbook P2.2+).
   Il te faut seulement PostgreSQL 16 + Redis en local.
2. **Phase 4 (intégrations) :** FedaPay (sandbox), Daily.co (free tier), Twilio,
   Firebase, Resend.
3. **Mise en production :** Infomaniak (VPS + domaine), GitHub (secrets de déploiement),
   et le passage des comptes FedaPay/Daily en mode live.

> ⚠️ Les liens et conditions des fournisseurs peuvent évoluer. Vérifie les pages
> officielles au moment de la création des comptes.
