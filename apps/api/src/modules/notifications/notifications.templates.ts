// ─────────────────────────────────────────────────────────────
// Gabarits de notification multilingues (pur, testable).
// Chaque message part dans la langue de l'utilisateur ; à défaut de gabarit
// pour la langue, repli sur le français (FR), puis sur le contenu stocké.
// Les traductions FON/BARIBA/DENDI seront fournies par les traducteurs (P5.2) ;
// en attendant, repli FR pour éviter des messages médicaux erronés.
// ─────────────────────────────────────────────────────────────
import type { Lang, NotificationType } from '@digisante/shared';

type Template = { title: string; body: string };

const TEMPLATES: Partial<Record<NotificationType, Partial<Record<Lang, Template>>>> = {
  APPOINTMENT_REMINDER: {
    FR: { title: 'Rappel de rendez-vous', body: 'Vous avez un rendez-vous à venir.' },
    EN: { title: 'Appointment reminder', body: 'You have an upcoming appointment.' },
  },
  CONSULTATION_START: {
    FR: { title: 'Téléconsultation', body: 'Votre téléconsultation va commencer.' },
    EN: { title: 'Teleconsultation', body: 'Your teleconsultation is about to start.' },
  },
  PRESCRIPTION_READY: {
    FR: { title: 'Ordonnance', body: 'Votre ordonnance a été mise à jour.' },
    EN: { title: 'Prescription', body: 'Your prescription has been updated.' },
  },
  LAB_RESULT: {
    FR: { title: 'Résultat de laboratoire', body: 'Un résultat important est disponible.' },
    EN: { title: 'Lab result', body: 'An important result is available.' },
  },
  SOS_ALERT: {
    FR: { title: 'Alerte SOS', body: 'Une alerte d’urgence a été déclenchée.' },
    EN: { title: 'SOS alert', body: 'An emergency alert has been triggered.' },
  },
  PAYMENT_CONFIRMED: {
    FR: { title: 'Paiement confirmé', body: 'Votre paiement a été confirmé.' },
    EN: { title: 'Payment confirmed', body: 'Your payment has been confirmed.' },
  },
};

/**
 * Renvoie le contenu localisé pour un type + une langue.
 * Repli : langue demandée → FR → contenu stocké (fallback).
 */
export function localize(
  type: NotificationType,
  lang: Lang,
  fallback: Template,
): Template {
  const byLang = TEMPLATES[type];
  return byLang?.[lang] ?? byLang?.FR ?? fallback;
}
