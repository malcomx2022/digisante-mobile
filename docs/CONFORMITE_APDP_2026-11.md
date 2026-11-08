# Conformité APDP / RGPD — dossier de travail (7 novembre 2026)

**PROJET — non validé.** Ce document est préparé à partir du code, pour le porteur et son conseil juridique. Il ne vaut ni déclaration ni autorisation APDP, et ne constitue pas un avis juridique.

Cadre : loi n° 2017-20 du 20 avril 2018 portant Code du numérique en République du Bénin, livre V (protection des données à caractère personnel), sous le contrôle de l'APDP. Le RGPD sert de référence de bonnes pratiques. Les éléments entre crochets doivent être fournis par le porteur.

## 1. Livré dans le code (branche `claude/compassionate-goldberg-5fdh2j`)

| Exigence | Mise en œuvre | Preuve |
|---|---|---|
| Information des personnes | Pages publiques `/legal/cgu`, `/legal/confidentialite` et `/legal/mentions`, en **projet**. Un bandeau « Projet de texte » s'affiche et le contenu est dans `apps/web/src/content/legal.ts` (FR fait foi, EN traduit). | Build : pages statiques |
| Consentement explicite et versionné | À l'inscription, une case non cochée par défaut et `acceptTerms` sont exigés. La version doit être `TERMS_VERSION`, sinon 422. `User.termsVersion` et `termsAcceptedAt` sont enregistrés. | `users.privacy.test.ts` |
| Comptes existants | Une version absente ou ancienne déclenche un écran de ré-acceptation (`TermsGate`). Il n'est jamais bloquant hors-ligne ni sur SOS, fiche d'urgence ou triage. Les comptes admin en sont exclus (personnel). L'acceptation est journalisée `TERMS_ACCEPTED`. | `users.privacy.test.ts` |
| Droit d'accès et portabilité | Export FHIR du dossier, existant. | — |
| Droit à l'effacement | Le titulaire fait sa demande depuis son profil (`POST /users/me/deletion-request`, idempotent, audit `ACCOUNT_DELETION_REQUEST`). L'admin la traite dans `/admin/deletions` : lecture avec `users:read`, exécution ou refus motivé avec `users:write`. Aucune destruction automatique (décision du porteur du 7/11). | `users.privacy.test.ts` |
| Exécution de l'effacement | Une seule transaction (détail ci-dessous), suivie de la suppression des fichiers chiffrés du magasin. | idem |
| Fichiers orphelins | Le retrait d'une pièce DMP efface désormais le fichier chiffré du disque, après la ligne en base (B4). | `dmp.documents.test.ts` |

Détail de l'exécution de l'effacement :
- **Données de santé du patient effacées** : DMP et pièces, consentements, vaccination, maternité, observance, SOS, assurance, messagerie, notifications, carnet de bénéficiaires, reçus de synchronisation. Pour un ASC, son roster est aussi effacé.
- **Identité anonymisée** : le numéro devient `deleted:<id>`, l'e-mail et le jeton push sont effacés, le profil devient « Compte supprimé ».
- **Compte fermé** : statut `SUSPENDED` et `deletedAt` posés ; tout jeton existant est refusé.
- **Traçabilité** : audit `ACCOUNT_DELETION_EXECUTED`, métadonnées seulement.

Limite assumée : tant que D-8 n'est pas tranchée, sont **conservés pseudonymisés** :
- le journal d'audit (5 ans, immuable) ;
- les paiements, portefeuilles et écritures financières ;
- les rendez-vous, ordonnances, analyses, orientations et avis, tenus par les soignants.

Ils restent rattachés à un identifiant interne sans identité. Le portefeuille est conservé avec son solde.

## 2. Registre des activités de traitement (projet)

| # | Traitement | Personnes | Données | Finalité | Base légale (à valider) | Destinataires | Durée |
|---|---|---|---|---|---|---|---|
| T1 | Comptes et authentification | Tous les utilisateurs | Identité, téléphone, e-mail, langue, rôle, OTP (empreinte), journaux d'accès | Accès sécurisé au service | Exécution du contrat | Équipe technique ; Twilio (SMS/voix) | [D-8] |
| T2 | Dossier médical partagé | Patients | Entrées DMP chiffrées, pièces, constantes, fiche d'urgence | Suivi et coordination des soins | Consentement exprès | Patient, médecins vérifiés consentis (par entrée, durée limitée) | [D-8] |
| T3 | Téléconsultation et messagerie | Patients, médecins | Métadonnées de salle, messages chiffrés, compte rendu (DMP) | Consultation à distance | Consentement, exécution | Daily.co (vidéo, sans enregistrement) | [D-8] |
| T4 | Prescriptions, délivrance, analyses | Patients, médecins, pharmacies, labos | Ordonnances (QR signé), délivrances, demandes et résultats | Soins | Consentement, exécution | Professionnels concernés vérifiés | [D-8 — obligations des professionnels] |
| T5 | Prévention et suivi (PEV, CPN, observance, triage) | Patients, enfants | Calendriers, prises, réponses de triage (non stockées) | Rappels, orientation | Consentement | Patient ; Firebase (push générique) | [D-8] |
| T6 | SOS | Patients, contacts d'urgence | Position, horodatage, numéro du contact | Alerte d'urgence | Intérêts vitaux | Contact d'urgence ; Twilio | [D-8] |
| T7 | Vérification professionnelle (KYC) | Médecins, pharmacies, labos | Pièces d'identité et d'autorisation (chiffrées) | Habilitation | Obligation légale, intérêt légitime | Admins `kyc:review` | [D-8] |
| T8 | Paiements, abonnements, finances | Payeurs, médecins | Montants, statuts, références FedaPay, écritures | Paiement des soins et revenus | Exécution, obligation comptable | FedaPay ; admins finance | [D-8 — légal comptable] |
| T9 | Relais communautaire (ASC) | Habitants suivis par un ASC | Roster, observations opérationnelles | Relais vers un médecin | [À qualifier : consentement oral recueilli par l'ASC ?] | ASC, médecin signalé | [D-8] |
| T10 | Campagnes de santé publique | Utilisateurs ciblés | Rôle, langue, e-mail (canal e-mail) | Prévention | Intérêt public / légitime | Resend, Twilio, Firebase | [D-8] |
| T11 | Audit et sécurité | Tous | Journal chaîné (identifiants, actions) | Sécurité, preuve | Obligation légale, intérêt légitime | Admins `audit:read` (méta expurgées) | 5 ans |

Sous-traitants à contractualiser (clauses de protection des données) :

| Sous-traitant | Rôle | Localisation |
|---|---|---|
| IONOS | Hébergement | Serveur en Espagne |
| Twilio | SMS, OTP, voix | États-Unis |
| Daily.co | Vidéo de téléconsultation | États-Unis |
| Google Firebase | Notifications push | États-Unis |
| Resend | E-mail | États-Unis |
| FedaPay | Paiements | Bénin |

## 3. AIPD — analyse d'impact (trame à compléter)

Une AIPD est attendue : il s'agit de données de santé à grande échelle, de personnes vulnérables (enfants, femmes enceintes, personnes illettrées suivies par un ASC) et de transferts hors du Bénin.

1. **Description** : traitements T1 à T11 ; flux réseau limité à l'API sous une seule origine ; mode hors ligne avec coffre chiffré facultatif.
2. **Nécessité et proportionnalité** :
   - partage du DMP par entrée et limité dans le temps ;
   - push au texte générique ;
   - admins sans accès au contenu médical ;
   - minimisation dans l'audit.
3. **Risques** :
   - accès illégitime au DMP ;
   - fuite par un sous-traitant ;
   - appareil partagé ;
   - erreur d'orientation clinique ;
   - réattribution d'un numéro de téléphone ;
   - transfert hors du Bénin ;
   - hôte partagé (I2).
4. **Mesures existantes** : chiffrement AES-256 au repos, TLS, consentement par entrée (L1), coffre local (L4), audit chaîné, rate-limit, verrouillage OTP, CSP.
5. **Mesures restantes** :
   - pentest ;
   - rôle de base de données non propriétaire de l'audit ;
   - ACL Valkey ;
   - arbitrage de la CSP `unsafe-inline` ;
   - contrats avec les sous-traitants ;
   - politique de conservation.
6. **Avis** : du délégué ou du conseil, [à recueillir] ; puis consultation de l'APDP si le risque résiduel reste élevé.

## 4. Politique de conservation — PROPOSITION pour la décision D-8 (non appliquée)

**Aucune durée n'est codée.** Les valeurs ci-dessous sont des hypothèses de travail à confirmer par le conseil juridique, au regard du droit béninois de la santé et du droit comptable :

| Catégorie | Proposition | Point à confirmer |
|---|---|---|
| Dossier médical (DMP) d'un compte actif | Tant que le compte est actif | Durée après dernière activité ? |
| DMP après demande d'effacement | Effacement à l'exécution (déjà implémenté) | Obligation de conservation des soignants ? |
| Ordonnances, délivrances, analyses | [N] ans après la dernière intervention | Durée légale de conservation pour le prescripteur et le pharmacien |
| Paiements et écritures financières | 10 ans (pratique comptable courante) | Durée légale au Bénin |
| Journal d'audit | 5 ans (CLAUDE.md §4), purge au-delà par un job dédié | Mécanisme compatible avec les triggers append-only |
| Pièces KYC | Durée d'exercice + [N] ans | — |
| Notifications, reçus de synchronisation | 90 jours (reçus : 14 j déjà purgés) | — |
| Comptes inactifs | Alerte puis anonymisation après [N] ans | — |

Une fois D-8 validée :
- implémenter les purges planifiées (crons, avec la règle « générateur ajouté = crontab mis à jour ») ;
- mettre à jour la politique de confidentialité ;
- incrémenter `TERMS_VERSION`.

## 5. Actions restant au porteur

1. Fournir les champs entre crochets des textes : raison sociale, adresse, IFU/RCCM, représentant, contact, numéro APDP, garanties de transfert. Faire valider CGU, politique et mentions par un juriste, puis incrémenter `TERMS_VERSION` à la publication définitive.
2. Déposer la déclaration ou la demande d'autorisation auprès de l'APDP : données de santé et transferts hors du Bénin.
3. Trancher D-8 (conservation) et la base légale du traitement T9 (ASC).
4. Contractualiser avec les sous-traitants.
5. Désigner un délégué ou un contact « données personnelles ».
6. Faire traduire les textes FON/YOR par des natifs. En attendant, ils s'affichent en français.
