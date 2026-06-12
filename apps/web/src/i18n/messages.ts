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
  'offline.banner': 'Vous êtes hors-ligne — vos actions seront synchronisées.',
  'offline.pending': '{n} action(s) en attente',
  'common.loading': 'Chargement…',
  'common.continue': 'Continuer',
  'onboarding.welcome': 'Bienvenue sur DigiSanté',
  'onboarding.choose_language': 'Choisissez votre langue',
  'auth.title': 'Connexion',
  'auth.phone': 'Numéro de téléphone',
  'auth.send_code': 'Recevoir le code',
  'auth.code': 'Code à 6 chiffres',
  'auth.verify': 'Vérifier',
  'auth.resend': 'Renvoyer le code',
  'auth.code_sent': 'Code envoyé par SMS',
  'auth.new_account': 'Nouveau compte',
  'auth.have_account': 'J’ai déjà un compte',
  'auth.firstname': 'Prénom',
  'auth.lastname': 'Nom',
  'auth.role': 'Profil',
  'auth.logout': 'Déconnexion',
  'auth.error': 'Une erreur est survenue. Réessayez.',
  'space.patient': 'Espace Patient',
  'space.pro': 'Espace Médecin PRO',
  'space.diaspora': 'Espace Diaspora',
  'space.pharmacie': 'Espace Pharmacie',
  'space.labo': 'Espace Laboratoire',
  'space.admin': 'Espace Admin',
  'space.welcome': 'Bonjour, {name}',
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
  'offline.banner': 'You are offline — your actions will sync later.',
  'offline.pending': '{n} action(s) pending',
  'common.loading': 'Loading…',
  'common.continue': 'Continue',
  'onboarding.welcome': 'Welcome to DigiSanté',
  'onboarding.choose_language': 'Choose your language',
  'auth.title': 'Sign in',
  'auth.phone': 'Phone number',
  'auth.send_code': 'Get code',
  'auth.code': '6-digit code',
  'auth.verify': 'Verify',
  'auth.resend': 'Resend code',
  'auth.code_sent': 'Code sent by SMS',
  'auth.new_account': 'New account',
  'auth.have_account': 'I already have an account',
  'auth.firstname': 'First name',
  'auth.lastname': 'Last name',
  'auth.role': 'Profile',
  'auth.logout': 'Sign out',
  'auth.error': 'Something went wrong. Please try again.',
  'space.patient': 'Patient space',
  'space.pro': 'Doctor PRO space',
  'space.diaspora': 'Diaspora space',
  'space.pharmacie': 'Pharmacy space',
  'space.labo': 'Lab space',
  'space.admin': 'Admin space',
  'space.welcome': 'Hello, {name}',
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
