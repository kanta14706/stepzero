/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The journey planner talks to OpenTripPlanner at /otp on the app's origin (src/features/journey/otp.ts).
// The dev and preview servers forward it to a local OTP (`cd otp && docker compose up otp`).
const otpProxy = {
  '/otp': { target: process.env['OTP_URL'] ?? 'http://localhost:8080', changeOrigin: true },
};

export default defineConfig({
  server: { proxy: otpProxy },
  preview: { proxy: otpProxy },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'StepZero ステップゼロ',
        short_name: 'StepZero',
        description: '改札からホーム、扉まで。段差ゼロのルート案内',
        lang: 'ja',
        theme_color: '#0b5d57',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Offline (step 2.9, D-025): the app shell and every station's data are precached, so a
      // station works underground even if it was never opened. Basemap tiles and glyphs are
      // cached as they are viewed; the station's own layers do not need them.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'data/**/*.json'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/experimental_bvmap\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gsi-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/maps\.gsi\.go\.jp\/xyz\/noto-jp\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gsi-glyphs',
              expiration: { maxEntries: 100, maxAgeSeconds: 90 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Unit tests never talk to a real back end, whatever .env files exist.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
});
