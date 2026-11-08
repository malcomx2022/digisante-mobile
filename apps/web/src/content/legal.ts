// ─────────────────────────────────────────────────────────────
// Textes légaux de DigiSanté Mobile — PROJETS À VALIDER (juriste / porteur).
// Rédigés d'après la loi n° 2017-20 (Code du numérique, livre V — protection des
// données à caractère personnel, APDP) et le fonctionnement RÉEL de l'application.
// Les [CHAMPS ENTRE CROCHETS] sont inconnus du code et doivent être fournis.
// Toute modification de fond impose de changer TERMS_VERSION (@digisante/shared) :
// chaque compte ré-accepte alors la nouvelle version.
// Contenu (et non libellés d'interface) : FR fait foi ; EN est une traduction ;
// FON/YOR retombent sur FR tant qu'aucune traduction native relue n'existe.
// ─────────────────────────────────────────────────────────────
import type { Lang } from '@digisante/shared';

export type LegalDocId = 'cgu' | 'confidentialite' | 'mentions';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDoc {
  title: string;
  sections: LegalSection[];
}

const FR: Record<LegalDocId, LegalDoc> = {
  cgu: {
    title: 'Conditions générales d’utilisation',
    sections: [
      { title: '1. Objet', paragraphs: [
        'Les présentes conditions régissent l’utilisation de DigiSanté Mobile, application web progressive de e-santé destinée aux patients, professionnels de santé, pharmacies, laboratoires, agents de santé communautaires et membres de la diaspora au Bénin.',
        'L’utilisation du service suppose l’acceptation expresse de ces conditions et de la politique de confidentialité, dans leur version en vigueur.',
      ] },
      { title: '2. Accès au service', paragraphs: [
        'La connexion se fait par numéro de téléphone et code à usage unique (SMS ou appel vocal). Vous êtes responsable de la confidentialité de votre téléphone et des codes reçus.',
        'Les comptes professionnels (médecin, pharmacie, laboratoire) ne donnent accès aux fonctions cliniques qu’après vérification de leurs pièces par l’équipe DigiSanté.',
      ] },
      { title: '3. Nature du service — avertissement médical', paragraphs: [
        'DigiSanté est un outil d’aide à l’organisation des soins. Les fonctions d’orientation (triage), de rappel, de calendrier vaccinal, de suivi de grossesse et de posologie illustrée ne constituent ni un diagnostic ni une prescription.',
        'En cas d’urgence, appelez le 112 ou le service d’urgence le plus proche. L’alerte SOS de l’application ne remplace pas un appel aux secours.',
        'La téléconsultation est réalisée par des médecins vérifiés ; elle n’est pas enregistrée par DigiSanté.',
      ] },
      { title: '4. Engagements de l’utilisateur', paragraphs: [
        'Fournir des informations exactes, ne pas usurper l’identité d’un tiers, ne pas tenter d’accéder aux données d’autrui, respecter le secret médical et la confidentialité des échanges.',
        'Les professionnels s’engagent à n’agir que dans le cadre de leur exercice légal et du consentement du patient.',
      ] },
      { title: '5. Dossier médical et partage', paragraphs: [
        'Le patient reste maître de son dossier : il choisit, entrée par entrée et pour une durée limitée, ce qu’il partage avec un médecin, et peut révoquer ce partage à tout moment.',
      ] },
      { title: '6. Paiements', paragraphs: [
        'Les paiements Mobile Money et cartes sont traités par FedaPay. DigiSanté ne conserve aucune donnée de carte. Les reçus émis par l’application ne sont pas des factures fiscales.',
      ] },
      { title: '7. Suspension et fermeture', paragraphs: [
        'Un compte peut être suspendu en cas de manquement grave ou de risque pour la sécurité des utilisateurs. Vous pouvez demander la suppression de votre compte depuis votre profil.',
      ] },
      { title: '8. Responsabilité', paragraphs: [
        'DigiSanté met en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, sans garantie de fonctionnement ininterrompu, notamment en cas de faible connectivité. [Clauses de responsabilité à valider par le juriste.]',
      ] },
      { title: '9. Modification des conditions', paragraphs: [
        'Toute modification de fond fait l’objet d’une nouvelle version, présentée à votre prochaine connexion pour acceptation.',
      ] },
      { title: '10. Droit applicable', paragraphs: [
        'Les présentes conditions sont soumises au droit béninois. [Juridiction compétente à préciser.]',
      ] },
    ],
  },
  confidentialite: {
    title: 'Politique de confidentialité',
    sections: [
      { title: '1. Responsable du traitement', paragraphs: [
        '[RAISON SOCIALE], [ADRESSE DU SIÈGE], [IFU / RCCM], représentée par [NOM DU REPRÉSENTANT LÉGAL]. Contact données personnelles : [ADRESSE E-MAIL DU DÉLÉGUÉ / CONTACT].',
        'Formalités auprès de l’Autorité de Protection des Données Personnelles (APDP) : [NUMÉRO ET DATE DE LA DÉCLARATION OU DE L’AUTORISATION].',
      ] },
      { title: '2. Données traitées', paragraphs: [
        'Identification et contact : nom, prénom, téléphone, e-mail facultatif, langue, rôle.',
        'Données de santé (catégorie particulière) : dossier médical, constantes, ordonnances, résultats d’analyse, vaccinations, suivi de grossesse, observance, fiche d’urgence, messages avec votre médecin, position géographique au moment d’une alerte SOS.',
        'Professionnels : pièces d’identité et d’autorisation d’exercice transmises pour vérification.',
        'Paiements : montants, statuts et références de transaction (aucune donnée de carte).',
        'Données techniques : jeton de notification de l’appareil, journaux de sécurité.',
      ] },
      { title: '3. Finalités et bases légales', paragraphs: [
        'Fournir le service de santé demandé (exécution des conditions d’utilisation) ; traiter les données de santé sur la base de votre consentement exprès et pour la coordination des soins ; prévenir la fraude et sécuriser le service (intérêt légitime) ; respecter les obligations légales (comptabilité, réquisitions).',
      ] },
      { title: '4. Destinataires', paragraphs: [
        'Votre dossier médical n’est lisible que par vous et par les médecins vérifiés auxquels vous l’avez partagé, entrée par entrée. Les administrateurs de DigiSanté n’ont jamais accès au contenu médical.',
        'Sous-traitants techniques : IONOS (hébergement des serveurs, Espagne), Twilio (SMS, codes et appels, États-Unis), Daily.co (vidéo de téléconsultation, États-Unis), Google Firebase (notifications, États-Unis), Resend (e-mails, États-Unis), FedaPay (paiements, Bénin).',
      ] },
      { title: '5. Transferts hors du Bénin', paragraphs: [
        'L’hébergement et certains sous-traitants sont situés hors du Bénin. Ces transferts sont encadrés par [GARANTIES : AUTORISATION APDP / CLAUSES CONTRACTUELLES — À COMPLÉTER].',
      ] },
      { title: '6. Durées de conservation', paragraphs: [
        'Les durées par catégorie de données sont fixées par la politique de conservation en cours de validation : [DURÉES À COMPLÉTER]. Le journal d’audit de sécurité est conservé 5 ans.',
      ] },
      { title: '7. Sécurité', paragraphs: [
        'Données de santé chiffrées au repos (AES-256) et en transit (TLS), accès par consentement nominatif et limité dans le temps, journal d’audit infalsifiable, verrouillage après échecs de connexion, coffre local chiffré facultatif sur l’appareil.',
      ] },
      { title: '8. Vos droits', paragraphs: [
        'Accès et portabilité : export de votre dossier au format FHIR depuis votre espace. Rectification : depuis votre profil. Retrait du consentement : révocation des partages de dossier à tout moment. Effacement : demande depuis votre profil, traitée par l’équipe DigiSanté ; certaines données peuvent être conservées sous forme pseudonymisée lorsqu’une obligation légale l’impose.',
        'Opposition et limitation : [CONTACT]. Vous pouvez introduire une réclamation auprès de l’APDP.',
      ] },
    ],
  },
  mentions: {
    title: 'Mentions légales',
    sections: [
      { title: 'Éditeur', paragraphs: [
        '[RAISON SOCIALE], [FORME JURIDIQUE], [ADRESSE], [IFU / RCCM]. Directeur de la publication : [NOM].',
        'Projet soutenu par le programme NEXT IMPACT (FP2E / Sèmè City / Banque mondiale).',
      ] },
      { title: 'Hébergement', paragraphs: [
        'IONOS — serveur privé virtuel situé en Espagne. [COORDONNÉES DE L’HÉBERGEUR À VÉRIFIER].',
      ] },
      { title: 'Contact', paragraphs: ['[ADRESSE E-MAIL / TÉLÉPHONE DE CONTACT].'] },
    ],
  },
};

const EN: Record<LegalDocId, LegalDoc> = {
  cgu: {
    title: 'Terms of use',
    sections: [
      { title: '1. Purpose', paragraphs: [
        'These terms govern the use of DigiSanté Mobile, an e-health progressive web app for patients, health professionals, pharmacies, laboratories, community health workers and diaspora members in Benin.',
        'Using the service requires express acceptance of these terms and of the privacy policy, in their current version.',
      ] },
      { title: '2. Access', paragraphs: [
        'You sign in with your phone number and a one-time code (SMS or voice call). You are responsible for keeping your phone and codes confidential.',
        'Professional accounts (doctor, pharmacy, laboratory) only access clinical features after their documents are verified by the DigiSanté team.',
      ] },
      { title: '3. Nature of the service — medical notice', paragraphs: [
        'DigiSanté is a care-organisation aid. Triage guidance, reminders, vaccination schedule, pregnancy follow-up and illustrated dosage are neither a diagnosis nor a prescription.',
        'In an emergency, call 112 or the nearest emergency service. The in-app SOS alert does not replace a call to emergency services.',
        'Teleconsultations are carried out by verified doctors and are not recorded by DigiSanté.',
      ] },
      { title: '4. User commitments', paragraphs: [
        'Provide accurate information, do not impersonate others, do not try to access other people’s data, respect medical confidentiality.',
        'Professionals act only within their legal practice and the patient’s consent.',
      ] },
      { title: '5. Medical record and sharing', paragraphs: [
        'Patients stay in control: they choose, entry by entry and for a limited time, what they share with a doctor, and can revoke it at any time.',
      ] },
      { title: '6. Payments', paragraphs: [
        'Mobile Money and card payments are processed by FedaPay. DigiSanté stores no card data. Receipts issued by the app are not tax invoices.',
      ] },
      { title: '7. Suspension and closure', paragraphs: [
        'An account may be suspended for serious breach or safety risk. You can request deletion of your account from your profile.',
      ] },
      { title: '8. Liability', paragraphs: [
        'DigiSanté takes reasonable measures for availability and security, without guaranteeing uninterrupted operation, especially on poor connectivity. [Liability clauses to be validated by counsel.]',
      ] },
      { title: '9. Changes', paragraphs: ['Any substantive change creates a new version, presented for acceptance at your next sign-in.'] },
      { title: '10. Governing law', paragraphs: ['These terms are governed by the law of Benin. [Competent jurisdiction to be specified.]'] },
    ],
  },
  confidentialite: {
    title: 'Privacy policy',
    sections: [
      { title: '1. Data controller', paragraphs: [
        '[COMPANY NAME], [REGISTERED ADDRESS], [TAX / TRADE REGISTER NUMBER], represented by [LEGAL REPRESENTATIVE]. Data protection contact: [E-MAIL].',
        'Formalities with Benin’s data protection authority (APDP): [DECLARATION / AUTHORISATION NUMBER AND DATE].',
      ] },
      { title: '2. Data processed', paragraphs: [
        'Identity and contact: name, phone, optional e-mail, language, role.',
        'Health data (special category): medical record, vital signs, prescriptions, lab results, vaccinations, pregnancy follow-up, adherence, emergency card, messages with your doctor, location at the time of an SOS alert.',
        'Professionals: identity and practice-licence documents sent for verification.',
        'Payments: amounts, statuses and transaction references (no card data).',
        'Technical data: device notification token, security logs.',
      ] },
      { title: '3. Purposes and legal bases', paragraphs: [
        'Provide the requested health service (terms of use); process health data on the basis of your explicit consent and for care coordination; prevent fraud and secure the service (legitimate interest); comply with legal obligations.',
      ] },
      { title: '4. Recipients', paragraphs: [
        'Your medical record can only be read by you and by the verified doctors you shared it with, entry by entry. DigiSanté administrators never access medical content.',
        'Processors: IONOS (server hosting, Spain), Twilio (SMS, codes and calls, USA), Daily.co (teleconsultation video, USA), Google Firebase (notifications, USA), Resend (e-mail, USA), FedaPay (payments, Benin).',
      ] },
      { title: '5. Transfers outside Benin', paragraphs: ['Hosting and some processors are outside Benin. These transfers are covered by [SAFEGUARDS: APDP AUTHORISATION / CONTRACTUAL CLAUSES — TO BE COMPLETED].'] },
      { title: '6. Retention', paragraphs: ['Retention periods per data category are set by the retention policy under validation: [PERIODS TO BE COMPLETED]. The security audit log is kept for 5 years.'] },
      { title: '7. Security', paragraphs: ['Health data encrypted at rest (AES-256) and in transit (TLS), named and time-limited consent, tamper-evident audit log, lockout after failed sign-ins, optional encrypted local vault on the device.'] },
      { title: '8. Your rights', paragraphs: [
        'Access and portability: export your record in FHIR format from your space. Rectification: from your profile. Withdrawal of consent: revoke record shares at any time. Erasure: request from your profile, handled by the DigiSanté team; some data may be kept pseudonymised where the law requires it.',
        'Objection and restriction: [CONTACT]. You may lodge a complaint with the APDP.',
      ] },
    ],
  },
  mentions: {
    title: 'Legal notice',
    sections: [
      { title: 'Publisher', paragraphs: [
        '[COMPANY NAME], [LEGAL FORM], [ADDRESS], [TAX / TRADE REGISTER NUMBER]. Publication director: [NAME].',
        'Project supported by the NEXT IMPACT programme (FP2E / Sèmè City / World Bank).',
      ] },
      { title: 'Hosting', paragraphs: ['IONOS — virtual private server located in Spain. [HOST DETAILS TO BE VERIFIED].'] },
      { title: 'Contact', paragraphs: ['[CONTACT E-MAIL / PHONE].'] },
    ],
  },
};

/** Texte d'un document dans la langue demandée (repli FR, qui fait foi). */
export function legalDoc(id: LegalDocId, lang: Lang): LegalDoc {
  return (lang === 'EN' ? EN : FR)[id];
}

export const LEGAL_DOC_IDS: readonly LegalDocId[] = ['cgu', 'confidentialite', 'mentions'];
