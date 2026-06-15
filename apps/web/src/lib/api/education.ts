// Contenus d'éducation à la santé publiés (feed patient — littératie en santé).
import { get } from './client';

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

export const educationApi = {
  /** Catalogue des contenus publiés (filtrable par catégorie). */
  list: (category?: string) =>
    get<HealthContent[]>(`/education?pageSize=50${category ? `&category=${encodeURIComponent(category)}` : ''}`),
};
