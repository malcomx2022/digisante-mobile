/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@digisante/shared'],
  // PWA / offline-first : brancher next-pwa ou un service worker custom ici.
  // L'offline-first n'est pas optionnel (cf. CLAUDE.md §3).
};
export default nextConfig;
