// Admin : revue enrichie des dossiers KYC (pièces justificatives + checklist).
import { get, post } from './client';

export interface KycDocument {
  id: string;
  type: string;
  fileUrl: string;
  verified: boolean;
}

export interface KycQueueItem {
  id: string;
  status: string;
  user: { phone: string; role: string; profile: { firstName: string; lastName: string } | null };
}

export interface KycDetail {
  id: string;
  status: string;
  user: {
    phone: string;
    role: string;
    profile: { firstName: string; lastName: string } | null;
    doctor: { licenseNumber: string } | null;
  };
  documents: KycDocument[];
  cnom: { verified: boolean; source: string } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
}

type Decision = 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';

function online<T>(result: T | { queued: true }): T {
  if (result && typeof result === 'object' && 'queued' in result) {
    throw new Error('Connexion réseau requise pour cette action');
  }
  return result as T;
}

export const adminKycApi = {
  queue: () => get<Paginated<KycQueueItem>>('/kyc/submissions?pageSize=20'),
  detail: (id: string) => get<KycDetail>(`/kyc/submissions/${id}`),
  verifyDocument: (docId: string, verified: boolean) =>
    post<{ id: string; verified: boolean }>(`/kyc/documents/${docId}/verify`, { verified }).then(online),
  review: (id: string, body: { decision: Decision; notes?: string }) =>
    post<{ status: string }>(`/kyc/submissions/${id}/review`, body).then(online),
};
