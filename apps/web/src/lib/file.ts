/**
 * Encode un fichier en base64 (sans le préfixe `data:<mime>;base64,`) pour les
 * téléversements JSON de l'API (pièces KYC, pièces jointes du DMP).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result); // data:<mime>;base64,<data>
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Formats acceptés au téléversement — miroir de `UPLOAD_MIME_TYPES` côté API. */
export const UPLOAD_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Limite de taille alignée sur l'API (5 Mo). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
