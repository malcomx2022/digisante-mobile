import type { Config } from 'tailwindcss';

// ─────────────────────────────────────────────────────────────
// Design System « Wax & Terre » v2 — tokens (cf. skill digisante-design-system).
// Thèmes par espace : patient sante / PRO indigo / diaspora ocre / admin indigo+terre.
// ─────────────────────────────────────────────────────────────
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vert forêt réchauffé — espace PATIENT (primaire produit)
        sante: {
          50: '#EFF8F1', 100: '#D8EEDD', 200: '#AEDCB9', 300: '#7CC48F',
          400: '#47A562', 500: '#2E8B4F', 600: '#1F7040', 700: '#1A5A36',
          800: '#15462B', 900: '#0E3120', 950: '#082016',
        },
        // Terre cuite — accent artisanal, CTA transverses
        terre: {
          50: '#FBF1EC', 100: '#F5DCD0', 200: '#EAB9A1', 300: '#DD9270',
          400: '#CF6F45', 500: '#C2542B', 600: '#A84421', 700: '#86361B',
        },
        // Indigo wax — espace MÉDECIN PRO + ADMIN
        indigo: {
          50: '#EEF1F8', 100: '#D8DEED', 200: '#B0BDDB', 300: '#8399C4',
          400: '#5C76A8', 500: '#3F578A', 600: '#2B3A67', 700: '#223055',
          800: '#1A2440', 900: '#121A2E', 950: '#0C1220',
        },
        // Or kola — espace DIASPORA, badges premium
        ocre: {
          50: '#FBF5E4', 100: '#F5E7BE', 200: '#EAD088', 300: '#DDB75A',
          400: '#D4A843', 500: '#B8891A', 600: '#94690F', 900: '#4A3A0E',
        },
        sos: { 50: '#FDF1EF', 100: '#F9DCD7', 500: '#D64533', 600: '#B93A2B', 700: '#962F23' },
        creme: { DEFAULT: '#FAF6F0', deep: '#F3ECE1' }, // fond app (JAMAIS gray-50)
        nuit: { DEFAULT: '#211C16', soft: '#2C261E' }, // écrans sombres (scanner, vidéo)
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'], // Bricolage Grotesque
        body: ['var(--font-body)', 'sans-serif'], // DM Sans
      },
    },
  },
  plugins: [],
};

export default config;
