// Config Tailwind dédiée au bundle Claude Design (« Wax & Terre »).
// Reprend les tokens de apps/web/tailwind.config.ts. Scanne les primitives UI
// ET les aperçus auteurés (.design-sync/previews) pour n'émettre que les
// utilitaires réellement utilisés. Lancé depuis apps/web.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/components/ui/**/*.tsx',
    './src/i18n/**/*.tsx',
    '../../.design-sync/previews/**/*.tsx',
  ],
  // Safelist : émet TOUTE la palette de tokens « Wax & Terre » pour que les
  // designs construits par l'agent Claude Design soient on-brand, quelle que
  // soit la teinte choisie (pas seulement celles utilisées dans les previews).
  safelist: [
    { pattern: /^(bg|text|border|ring|from|to|fill|stroke)-(sante|terre|indigo|ocre|sos)-(50|100|200|300|400|500|600|700|800|900|950)$/ },
    { pattern: /^(bg|text|border)-(creme|nuit)$/ },
    'bg-creme', 'bg-creme-deep', 'bg-nuit', 'bg-nuit-soft', 'text-nuit', 'text-creme',
    'font-display', 'font-body',
  ],
  theme: {
    extend: {
      colors: {
        sante: {
          50: '#EFF8F1', 100: '#D8EEDD', 200: '#AEDCB9', 300: '#7CC48F',
          400: '#47A562', 500: '#2E8B4F', 600: '#1F7040', 700: '#1A5A36',
          800: '#15462B', 900: '#0E3120', 950: '#082016',
        },
        terre: {
          50: '#FBF1EC', 100: '#F5DCD0', 200: '#EAB9A1', 300: '#DD9270',
          400: '#CF6F45', 500: '#C2542B', 600: '#A84421', 700: '#86361B',
        },
        indigo: {
          50: '#EEF1F8', 100: '#D8DEED', 200: '#B0BDDB', 300: '#8399C4',
          400: '#5C76A8', 500: '#3F578A', 600: '#2B3A67', 700: '#223055',
          800: '#1A2440', 900: '#121A2E', 950: '#0C1220',
        },
        ocre: {
          50: '#FBF5E4', 100: '#F5E7BE', 200: '#EAD088', 300: '#DDB75A',
          400: '#D4A843', 500: '#B8891A', 600: '#94690F', 900: '#4A3A0E',
        },
        sos: { 50: '#FDF1EF', 100: '#F9DCD7', 500: '#D64533', 600: '#B93A2B', 700: '#962F23' },
        creme: { DEFAULT: '#FAF6F0', deep: '#F3ECE1' },
        nuit: { DEFAULT: '#211C16', soft: '#2C261E' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
