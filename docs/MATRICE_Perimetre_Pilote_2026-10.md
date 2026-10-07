# Matrice CDC → périmètre du pilote → preuves → lots

> Baseline L0 · 6 octobre 2026 ; mise à jour L4 le 7 octobre, branche `feat/l4-protected-offline`.
> Source fonctionnelle : `docs/fonctionnel/CDC_DigiSante_Mobile_v1.0.docx`, §3 et §9.
> Décisions actuelles : `CLAUDE.md` prime sur les choix historiques contradictoires du CDC.
> Périmètre de travail : le plan L0–L11 demandé par le porteur, sept rôles et offre médecin L6.
> **Décision du porteur, 6 octobre 2026 :** conserver le plan actuel ; abonnements patient, pharmacie, laboratoire et diaspora **reportés après le pilote**. Ces offres ne sont pas déclarées livrées.

## Règles de lecture

« Présent/testé localement » n'atteste ni recette fournisseur ni ouverture clinique. Chaque lot doit fermer la boucle données → API → écran → incident → preuve, avec une revue du diff avant PR. Les 8 E2E actuels couvrent l'authentification et le triage : ils ne couvrent pas tous les parcours de cette matrice.

Les points du CDC incompatibles avec les décisions persistantes sont remplacés : Socket.io/Workbox ne sont pas imposés à la place du WebSocket et du service worker livrés ; l'admin n'accède jamais au DMP ; le patient contrôle les consentements ; l'ASC reste un relais sans lecture DMP ; pas de traduction médicale envoyée à un tiers ; le mode FedaPay est déduit de la clé, sans variable indépendante `FEDAPAY_MODE`.

## Matrice de clôture

| ID | Exigence / workflow | État vérifié et preuve de départ | Clôture prévue |
|---|---|---|---|
| P01 | Authentification, OTP, session, sept rôles | Modules auth/RBAC ; tests auth et authenticate ; E2E inscription, routage et accès refusé. Suspension effective à la prochaine requête JWT et nouvelle connexion WS. | L0 ; résiduels L8 ; recette réelle L10/L11 |
| P02 | DMP, partage temporaire, révocation, export | Tests dmp/consent/documents présents ; l'expiration par entrée et l'auteur restent incomplets. | L1 |
| P03 | Pièces médicales chiffrées | Upload/téléchargement et tests dmp.documents présents ; droits à revérifier avec les nouvelles échéances. | L1, L11 |
| P04 | RDV, conflits de créneaux, agenda | Tests réservation/confirmation/annulation, concurrence et minuit ; verrou médecin ajouté. | L0 ; recette L11 |
| P05 | Téléconsultation, vidéo/audio/chat | API et bascule présentes ; jeton Daily non consommé par le client et média réel à vérifier. | L5, L10/L11 |
| P06 | Chat médical et communication multilingue | Chat chiffré/WS et tests présents ; phrasier local, FON/YOR et recettes faibles réseaux à valider. | L3/L4, L9, L11 |
| P07 | Ordonnance DCI, QR, délivrance | Tests règles/signature, pharmacie et parcours API présents. Le sceau applicatif ne prouve pas une signature réglementaire qualifiée/CAMES. | L9 validation professionnelle ; L11 appareils |
| P08 | Aide médicamenteuse | Détection de correspondances d'allergies présente ; petit catalogue de génériques. Aucune attestation de base complète d'interactions ou de prescription assistée par IA. | Référentiel complet / IA hors pilote ; validation des limites L9 |
| P09 | Pharmacie : scan, délivrance partielle, journal, stock | Modules/tests pharmacy et stock ; confidentialité des délivrances à vérifier en recette. | L11 ; extension catalogue après pilote |
| P10 | Laboratoire : pool, claim, résultat, interprétation | Tests inbox/interpret/règles présents ; habilitation structure et appropriation à renforcer. | L2, L11 |
| P11 | Paiement consultation Mobile Money et wallet | Tests payments/wallet ; montants imposés serveur, HMAC et idempotence. Fournisseur simulé dans la baseline. | L0 puis L10 sandbox/live contrôlé |
| P12 | Annulation médecin et restitution WALLET | REFUND_IN atomique ajouté et testé ; ancien REFUND reste reversal de recharge. | L0, rapprochement L7 |
| P13 | Réconciliation et supervision financière | PENDING/PROCESSING anciens, identifiant fournisseur présent ; tests cron et aperçu admin. | L0, recette fournisseur L10 |
| P14 | Abonnements médecins et droits de plan | Changement de plan présent mais activation payante gratuite possible. Pas de cycle de période/droits lié au paiement. | L6 ; aucune commercialisation avant sa validation |
| P15 | Revenus, annulations, satisfaction, export comptable | Page revenus indisponibles ; commission calculée, pas de boucle comptable complète attestée. | L7 |
| P16 | Reversement et remboursement externe sous 48 h ouvrables | Remboursement interne ≠ versement opérateur ; action externe actuellement manuelle. | L7 procédure/preuve ; automatisation séparée |
| P17 | Diaspora : proches, recharge, transfert | Tests beneficiaries/wallet ; transfert interne au bénéficiaire présent, aucun accès médical au payeur. | L11 ; lien accepté du bénéficiaire après pilote |
| P18 | Rappels, observance, vaccination, maternité | Tests reminders/adherence/vaccinations/maternity présents ; contenu embarqué et envois réels à valider. | L9, L10/L11 |
| P19 | SOS, géolocalisation et suivi de clôture | Module/test SOS présents ; sans réseau, aucune alerte serveur ne peut être promise. Un stub ou une notification au patient ne prouve pas que le contact a reçu le SMS. | L9 textes et numéros ; L10/L11 preuve opérateur et exactitude du statut |
| P20 | Hors-ligne médical, QR d'urgence et synchronisation | L3 livré sur main (#183) : huit mutations dédupliquées par reçus transactionnels. L4 candidate : coffre opt-in, lectures minimales datées 24 h et files scellées, tickets sans corps/GET seuls ; héritage en clair à migrer/effacer explicitement avant appareil partagé. QR/partage/validité courante et SOS serveur exigent le réseau. | Livraison/revue L4 : LOT_L4 ; tests appareils L11 |
| P21 | Déclaration de couverture assurance | Module/tests insurance présents. Déclarer une couverture ne constitue ni contrôle assureur ni tiers payant. | Recette déclaration L11 ; intégration assureur hors pilote |
| P22 | ASC et relais village | Module/tests ASC et roster présents ; pas de DMP tiers ni réservation au nom d'autrui. | L11 ; ASC v2 après pilote |
| P23 | Administration, KYC, support, CMS, campagnes, intégrations | Tests admin/kyc/education/campaigns/integrations ; scopes et cloisonnement médical. | L2 habilitation labo ; L8 sécurité ; L11 recette |
| P24 | FR/EN/FON/YOR et contenus cliniques | EN complet ; FON/YOR 76 clés manquantes chacun, dont 6 critiques SOS à la baseline. Parité UI seule insuffisante pour SMS/phrasier. | L9 |
| P25 | Audit, chiffrement, restauration et sécurité de release | Audit immuable et tests locaux ; risques résiduels et validations externes encore ouverts. | L8, L10/L11 |
| P26 | CI, builds reproductibles, VPS et exploitation | Baseline locale verte ; installation neuve avec pnpm 9 et CI complète à prouver ; dernier run main observé est l'échec du 22 septembre. | L0 candidate CI ; L10/L11 exploitation |

## Extensions du CDC reportées après le pilote

Les abonnements **patient, pharmacie, laboratoire et diaspora** du CDC §3.1/§9 ne sont pas couverts par l'offre médecin L6 et sont reportés par décision explicite du porteur. Lors de leur reprise, ajouter des lots distincts (catalogue, paiement, période, droits, reprise et UI de chaque rôle) et compléter les recettes financières. Les montants historiques ne sont pas approuvés automatiquement : vérifier tarifs, avantages et conditions avec le porteur.

Autres extensions distinctes : enregistrement des consultations (consentement et rétention), alertes SOS automatiques depuis les constantes, accès SOS anonyme, rappels programmés par la diaspora et cascades d'alerte, facturation légalement validée, prise en charge assurance, interconnexion des structures, interprète humain et contrats B2B. Elles doivent avoir une décision, un responsable et un lot avant d'annoncer une conformité intégrale au CDC initial. Aucune de ces fonctions n'est déclarée implémentée par L0.

## Porte d'ouverture

Le pilote ne peut ouvrir avant les validations L9–L11, les droits DMP/labo, la synchronisation sûre et les recettes financières requises. Aucun plan payant ne doit être commercialisé avant L6/L7 validés. Les extensions reportées sont indiquées dans les supports du pilote ; aucune mention « CDC intégralement terminé » sur cette seule baseline.
