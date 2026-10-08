# Inventaire L10 — noms seulement

> 8 octobre 2026. Aucun secret, domaine cible, accès ou compte fournisseur reçu/attesté. Coffre et accès de l'opérateur nécessaires. Cible native distincte selon `CONTRAT_Preproduction_L10.md`.

| Emplacement privé | Noms / contraintes |
|---|---|
| GitHub Variables | `PREPROD_DEPLOY_ENABLED` absent/false jusqu'à fenêtre autorisée ; production `DEPLOY_ENABLED` ET `DEPLOY_MAINTENANCE_READY` false hors fenêtre |
| GitHub Secrets préprod | `PREPROD_VPS_HOST`, `PREPROD_VPS_USER`, `PREPROD_VPS_SSH_KEY`, `PREPROD_VPS_FINGERPRINT` (empreinte SHA256 vérifiée hors canal SSH), `PREPROD_VPS_SSH_PORT` optionnel |
| API `.env` 0600 | `NODE_ENV=production`, `DATABASE_URL` locale base `digisante_preprod`, `REDIS_URL` local index `/0` dédié, `JWT_SECRET`, `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`, `KYC_STORAGE_DIR` privé, origines/domaine préprod selon `.env.example` |
| `/etc/digisante` 0700 | `backup.key` root 0400/0600, clé de sauvegarde distincte et copie hors VPS ; `reconcile.token` root 0400 identique à RECONCILE_TOKEN ; alert.conf privé et destinataire autorisé |
| FEDAPAY DB chiffrée | `secretKey` **sk_sandbox_…**, `publicKey`, `webhookSecret` ensemble ; webhook public HTTPS préprod configuré dans dashboard ; aucun live L10 |
| TWILIO DB chiffrée | `accountSid`, `authToken`, `fromNumber` ; permissions géographiques BJ/SMS/VOICE, numéros de recette MTN/Moov autorisés ; trial et limites à relever |
| DAILY DB chiffrée | `apiKey` ; sous-domaine compte de test et salle privée éphémère ; aucun token/URL nominatif dans les preuves publiques |
| FIREBASE DB chiffrée | `projectId`, `clientEmail`, `privateKey` ; projet isolé et permissions FCM ; identifiants exacts selon carte/admin et guide existants |
| RESEND DB chiffrée | `apiKey`, `fromEmail` ; domaine expéditeur SPF/DKIM/DMARC vérifié ; destinataire de recette autorisé |
| Web `.env.production` | `NEXT_PUBLIC_API_URL` vide pour même origine, six champs `NEXT_PUBLIC_FIREBASE_*` du guide (VAPID inclus) ; rebuild requis ; SOS public absent sauf destination expressément autorisée |
| Métadonnées smoke sans secrets | `SMOKE_ENVIRONMENT=preproduction`, `SMOKE_EXPECTED_SHA` complet, `SMOKE_DATABASE_NAME=digisante_preprod`, `SMOKE_REDIS_DB=0`, un seul opt-in fournisseur |
| Injection privée pendant smoke | `SMOKE_TWILIO_TO`, `EMAIL_RECIPIENT_TEST`, `SMOKE_FCM_TOKEN` ; aucun partage de valeurs/log brut ; FCM rejet explicite option `SMOKE_FCM_EXPECT_REJECTED=1` sur token réellement invalidé |

Infrastructure hors DB ; fournisseurs via SUPER_ADMIN/integrations:write, secrets chiffrés (HEALTH_ENCRYPTION_KEY) et jamais retournés en clair. `.env` fournisseur fallback seulement ; relever source effectivement résolue, pas seulement présence de variables. Utiliser les noms exacts de `.env.example` et des guides/cartes existants, pas une nouvelle convention. Ne pas copier la clé de santé de production sur préproduction. Chargement `.env` via Node24 `--env-file`, pas `source` de shell. Absence de clé/configuration est un échec, pas une activation fictive ou une validation.
