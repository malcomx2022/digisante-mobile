// ─────────────────────────────────────────────────────────────
// Messages i18n — 5 langues (FR·EN·FON·BARIBA·DENDI, alignées sur l'enum Lang
// du backend). Clés plates `namespace.key`. AUCUNE chaîne d'UI en dur ailleurs.
// FR est la langue de repli ; FON/BARIBA/DENDI seront complétées par les
// traducteurs (gouvernance + double validation des clés critiques, cf. backend).
// ─────────────────────────────────────────────────────────────
import type { Lang } from '@digisante/shared';

export type Messages = Record<string, string>;

const fr: Messages = {
  'common.greeting': 'Bonjour',
  'common.spoken': 'Langues parlées',
  'common.language': 'Langue',
  'home.hello': 'Bonjour, {name}',
  'home.next_appointment': 'Prochain rendez-vous',
  'home.confirmed': 'Confirmé',
  'home.join': 'Rejoindre',
  'home.details': 'Détails',
  'home.appointment_when': 'Demain, 10:30 · Téléconsultation',
  'home.doctor_specialty': 'Cardiologie',
  'nav.home': 'Accueil',
  'nav.dossier': 'Dossier',
  'nav.agenda': 'Agenda',
  'nav.profil': 'Profil',
  'showcase.components': 'Composants',
  'badge.normal': 'Normal',
  'badge.eleve': 'Élevé ▲',
  'badge.priorite': 'Priorité',
  'badge.pro': 'PRO',
};

const en: Messages = {
  'common.greeting': 'Hello',
  'common.spoken': 'Spoken languages',
  'common.language': 'Language',
  'home.hello': 'Hello, {name}',
  'home.next_appointment': 'Next appointment',
  'home.confirmed': 'Confirmed',
  'home.join': 'Join',
  'home.details': 'Details',
  'home.appointment_when': 'Tomorrow, 10:30 · Teleconsultation',
  'home.doctor_specialty': 'Cardiology',
  'nav.home': 'Home',
  'nav.dossier': 'Records',
  'nav.agenda': 'Agenda',
  'nav.profil': 'Profile',
  'showcase.components': 'Components',
  'badge.normal': 'Normal',
  'badge.eleve': 'High ▲',
  'badge.priorite': 'Priority',
  'badge.pro': 'PRO',
};

// Fɔ̀ngbè — salutation native (cf. design system) ; le reste reprend FR (repli).
const fon: Messages = {
  'common.greeting': 'Kú dó gbɛ̀',
  'home.hello': 'Kú dó gbɛ̀, {name}',
};

// Baatɔnum & Dɛndi : à compléter par les traducteurs ; repli FR pour l'instant.
const bariba: Messages = {};
const dendi: Messages = {};

export const messages: Record<Lang, Messages> = {
  FR: fr,
  EN: en,
  FON: fon,
  BARIBA: bariba,
  DENDI: dendi,
};
