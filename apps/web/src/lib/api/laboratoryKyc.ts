// L2 : identité administrative et dossier KYC laboratoire, actions en ligne.
import { ApiRequestError, get, postNow, putNow } from './client';

export interface LabIdentity { name: string; address: string; phone: string; licenseNumber: string }
export interface LaboratoryProfile extends LabIdentity {
  verifiedAt: string | null;
  accountStatus: string;
  kycStatus: string;
  canProcess: boolean;
}
export interface LaboratorySubmission {
  id: string;
  status: string;
  rejectionReason: string | null;
  reviews: { notes: string | null }[];
  documents: { id: string; type: string; verified: boolean }[];
}
export const laboratoryKycApi = {
  profile: () => get<LaboratoryProfile>('/kyc/laboratory'),
  save: (identity: LabIdentity) => putNow('/kyc/laboratory', identity),
  submission: async () => {
    try { return await get<LaboratorySubmission>('/kyc/me'); }
    catch (e) { if (e instanceof ApiRequestError && e.status === 404) return null; throw e; }
  },
  open: () => postNow('/kyc'),
  submit: () => postNow('/kyc/submit'),
};
