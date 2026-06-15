// ─────────────────────────────────────────────────────────────
// Génère le récapitulatif DOCX des fonctionnalités par profil.
//   export NODE_PATH=$(npm root -g)
//   node scripts/docs/recap-profils.js
// Conventions docx-js (CLAUDE.md §8) : A4 explicite, un Paragraph par ligne
// (jamais de \n), puces natives (pas d'unicode), pieds de page « Conforme audit ».
// ─────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  Header,
  PageNumber,
  PageBreak,
  convertMillimetersToTwip,
} = require('docx');

const NAVY = '1E2347';
const GREEN = '2E7D46';
const INDIGO = '3B4A8F';
const OCRE = 'B07D1E';
const GREY = '6B6155';

const profiles = [
  {
    name: 'Patient',
    accent: GREEN,
    tagline: 'Espace Patient — vert « santé »',
    features: [
      'Compte : inscription et connexion par téléphone + OTP (verrouillage 30 min après 5 échecs) ; le profil Patient et le portefeuille sont créés automatiquement à l’inscription.',
      'Profil & paramètres : nom, langues parlées, langue de l’application (FR, EN, Fɔ̀ngbè, Baatɔnum, Dendi), déconnexion.',
      'Dossier Médical Personnel (DMP) : consultation du dossier chiffré au repos (AES-256) ; export FHIR en libre-service (portabilité).',
      'Partage consenti par soignant : génération d’un QR / lien avec date d’expiration ; liste des accès accordés, révocation persistante et ré-autorisation.',
      'Médecins & rendez-vous : annuaire vérifié (spécialité, langues, tarif) ; prise de rendez-vous présentiel ou téléconsultation.',
      'Téléconsultation (Daily.co) avec bascule automatique vidéo → audio → chat sur réseau faible.',
      'Messagerie patient ↔ médecin en temps réel (WebSocket), chiffrée au repos, avec file d’attente hors-ligne.',
      'Ordonnances : liste, QR de vérification, paiement par Mobile Money (FedaPay) ou portefeuille.',
      'Résultats de laboratoire : consultation, mise en avant des valeurs critiques, écoute audio en Fɔ̀ngbè.',
      'Rappels de traitement ; SOS géolocalisé (alerte au contact d’urgence dans la langue du patient, repli SMS hors-ligne).',
      'Portefeuille (solde, historique) ; application offline-first (PWA, file de synchronisation).',
    ],
  },
  {
    name: 'Médecin PRO',
    accent: INDIGO,
    tagline: 'Espace Médecin — indigo',
    features: [
      'Compte & vérification : inscription avec spécialité et numéro d’Ordre ; KYC (pré-contrôle de format + revue manuelle de l’admin) → badge « Vérifié ».',
      'Tableau de bord : file du jour, compteurs (en attente / confirmés / en cours), confirmation des rendez-vous.',
      'Agenda : vue par plage de dates ; confirmation, annulation (signal de remboursement), triage / priorisation.',
      'Téléconsultation : démarrage (création de la salle Daily.co + jeton), join, clôture avec notes, bascule réseau faible.',
      'Messagerie temps réel avec les patients (chiffrée), initiable depuis la vue 360° du patient.',
      'Vue 360° patient : accès au DMP uniquement sous partage consenti actif (scan du QR du patient) ; gating strict, aucun accès sans consentement, tout accès journalisé.',
      'Ordonnances : prescription avec détection bloquante des conflits d’allergie, signature numérique et QR.',
      'Laboratoire & orientations : demandes d’analyse, interprétation des résultats ; orientation vers un autre médecin.',
      'Statistiques & revenus (commission plateforme 3 %) ; abonnement professionnel (FREE / STARTER / PRO / CLINIC).',
      'Rédaction de contenus d’éducation à la santé (workflow éditorial : brouillon → relecture médicale → traduction → publié).',
    ],
  },
  {
    name: 'Pharmacie',
    accent: OCRE,
    tagline: 'Espace Pharmacie — or / nuit',
    features: [
      'Compte pharmacie avec profil dédié et déconnexion.',
      'Scan caméra du QR d’ordonnance (API native BarcodeDetector ; repli jsQR sur iOS) ou saisie manuelle.',
      'Vérification de l’authenticité (signature) et de la validité de l’ordonnance.',
      'Délivrance ligne par ligne, avec suggestion de générique le cas échéant.',
    ],
  },
  {
    name: 'Laboratoire',
    accent: OCRE,
    tagline: 'Espace Laboratoire — or / nuit',
    features: [
      'Compte laboratoire avec profil dédié et déconnexion.',
      'Réception des demandes d’analyse (référence de demande).',
      'Saisie des résultats (valeurs structurées).',
      'Marquage d’une valeur critique → alerte du prescripteur (SMS dans la langue du destinataire).',
    ],
  },
  {
    name: 'Diaspora',
    accent: OCRE,
    tagline: 'Espace Diaspora — or',
    features: [
      'Compte diaspora ; portefeuille créé automatiquement à l’inscription.',
      'Portefeuille : solde, recharge € → FCFA (taux fixe), historique des mouvements.',
      'Paiement à distance pour la famille au Bénin (Mobile Money et cartes internationales via FedaPay).',
      'Gestion de la famille ; profil & déconnexion.',
    ],
  },
  {
    name: 'Administration',
    accent: NAVY,
    tagline: 'Espace Admin — indigo nuit',
    features: [
      'Tableau de bord & métriques (KPI : utilisateurs, consultations, volume FedaPay, KYC en attente, disponibilité).',
      'Gestion des utilisateurs : suspension et réactivation des comptes.',
      'File KYC : revue, approbation ou rejet des dossiers de vérification des médecins.',
      'Journal d’audit immuable : table append-only, hash SHA-256 chaîné, rétention 5 ans.',
      'Modération des contenus d’éducation à la santé.',
      'Cloisonnement strict : l’administration ne peut JAMAIS lire le contenu médical du DMP.',
    ],
  },
];

const transverse = [
  'Conformité RGPD / APDP (Loi béninoise n°2017-20) : consentement nominatif par soignant, audit immuable chaîné, chiffrement AES-256 au repos et TLS en transit, cloisonnement de l’administration.',
  'Offline-first : Progressive Web App, service worker, file de synchronisation des actions ; multilingue (FR, EN, Fɔ̀ngbè, Baatɔnum, Dendi).',
  'Temps réel : messagerie par WebSocket avec heartbeat et fan-out inter-workers via Redis.',
  'Intégrations prêtes (activées par les clés des fournisseurs) : Twilio (SMS / OTP), Daily.co (téléconsultation), FedaPay (Mobile Money & cartes), Firebase (notifications push), Resend (e-mails).',
];

// ── Helpers de mise en forme ──
const bullet = (text) => new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } });

const sectionHeading = (text, color) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, color, size: 30 })],
  });

const subtle = (text) =>
  new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text, italics: true, color: GREY, size: 20 })] });

// ── Page de garde ──
const cover = [
  new Paragraph({ spacing: { before: 1800 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'DigiSanté Mobile', bold: true, color: GREEN, size: 56 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120 },
    children: [new TextRun({ text: 'Récapitulatif des fonctionnalités par profil', bold: true, size: 32, color: NAVY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80 },
    children: [new TextRun({ text: 'Patient · Médecin · Pharmacie · Laboratoire · Diaspora · Administration', size: 22, color: GREY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600 },
    children: [
      new TextRun({ text: 'Programme NEXT IMPACT (FP2E / Sèmè City / Banque Mondiale)', size: 20, color: GREY }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Convention FP2E/NI/IDÉ/2025', size: 20, color: GREY })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({ text: `PWA e-santé offline-first — Bénin · ${process.env.DOC_DATE || ''}`, size: 18, color: GREY })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// ── Corps : un bloc par profil ──
const body = [];
profiles.forEach((p) => {
  body.push(sectionHeading(p.name, p.accent));
  body.push(subtle(p.tagline));
  p.features.forEach((f) => body.push(bullet(f)));
});
body.push(sectionHeading('Socle transverse', GREY));
transverse.forEach((f) => body.push(bullet(f)));

const doc = new Document({
  creator: 'DigiSanté Mobile',
  title: 'Récapitulatif des fonctionnalités par profil',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
          margin: {
            top: convertMillimetersToTwip(22),
            bottom: convertMillimetersToTwip(22),
            left: convertMillimetersToTwip(22),
            right: convertMillimetersToTwip(22),
          },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'DigiSanté Mobile — NEXT IMPACT', size: 16, color: GREY })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Conforme audit RGPD / APDP (Loi n°2017-20)  ·  page ', size: 16, color: GREY }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
              ],
            }),
          ],
        }),
      },
      children: [...cover, ...body],
    },
  ],
});

const outDir = path.resolve(__dirname, '..', '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'Recap_Fonctionnalites_Profils_DigiSante.docx');

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log(`✅ DOCX généré : ${outPath} (${buf.length} octets)`);
});
