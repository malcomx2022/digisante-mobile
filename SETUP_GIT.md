# Démarrage Git → GitHub — commandes pas à pas

## 1. Déposer ton code existant
- pages Next.js  → `apps/web/src/app/`
- modules Fastify → `apps/api/src/modules/<domaine>/`, et enregistre-les dans `apps/api/src/server.ts`
- schéma Prisma  → remplace `apps/api/prisma/schema.prisma` par tes 36 modèles / 28 enums
- supprime l'exemple `User`/`AuditLog` du schéma squelette une fois tes modèles importés

## 2. Vérifier que ça tourne en local
```bash
corepack enable
pnpm install
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm services:up
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

## 3. Initialiser Git
```bash
git init -b main
git add .
git commit -m "chore: initialisation monorepo DigiSanté (web + api + prisma + CI)"
```

## 4. Créer le dépôt et pousser

### Option A — GitHub CLI (recommandé)
```bash
gh auth login
gh repo create digisante-mobile --private --source=. --remote=origin --push
```

### Option B — dépôt créé à la main sur github.com
```bash
git remote add origin git@github.com:<TON-USER>/digisante-mobile.git
git push -u origin main
```

## 5. Workflow de branches (cf. CLAUDE.md §5)
```bash
git switch -c feat/deploiement-vps
# … travail, commits conventionnels (feat: / fix: / chore:) …
git push -u origin feat/deploiement-vps
# puis ouvrir une Pull Request vers main → la CI se lance
```

## ⚠️ Rappels
- Le fichier `.env` n'est JAMAIS commité (déjà dans `.gitignore`). Seul `.env.example` l'est.
- Dépôt en **privé** (`--private`) : il contient le schéma métier santé.
- En production : PostgreSQL 16 natif sur le VPS, pas le docker-compose (réservé au dev).
