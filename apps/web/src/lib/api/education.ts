// Contenus d'éducation à la santé : feed patient (publié) + CMS admin (pipeline).
import { get, patch, post } from './client';

export interface HealthContent {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  translations: Record<string, { title?: string; body?: string }> | null;
  createdAt: string;
  updatedAt: string;
}

// ── CMS admin (education:write) — pipeline éditorial. §4 : pas de DMP. ──
export type ContentStatus = 'DRAFT' | 'MEDICAL_REVIEW' | 'TRANSLATION' | 'PUBLISHED';
export interface Translation {
  title: string;
  body: string;
}
export interface AdminContent {
  id: string;
  title: string;
  body: string;
  category: string;
  status: ContentStatus;
  isPublished: boolean;
  tags: string[];
  translations: Record<string, Translation> | null;
  reviewedById: string | null;
  updatedAt: string;
}
export interface ManageList {
  data: AdminContent[];
  total: number;
  page: number;
  pageSize: number;
}

export const educationApi = {
  /** Catalogue des contenus publiés (filtrable par catégorie). */
  list: (category?: string) =>
    get<HealthContent[]>(`/education?pageSize=50${category ? `&category=${encodeURIComponent(category)}` : ''}`),

  /** Liste de gestion (tous statuts) — pipeline éditorial admin. */
  manage: (status?: ContentStatus, page = 1, pageSize = 20) => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) p.set('status', status);
    return get<ManageList>(`/education/manage?${p.toString()}`);
  },
  create: (input: { title: string; body: string; category: string; tags?: string[] }) => post<AdminContent>('/education', input),
  submitReview: (id: string) => post<AdminContent>(`/education/${id}/submit-review`),
  setTranslations: (id: string, translations: Record<string, Translation>) => patch<AdminContent>(`/education/${id}/translations`, { translations }),
  publish: (id: string) => post<AdminContent>(`/education/${id}/publish`),
};
