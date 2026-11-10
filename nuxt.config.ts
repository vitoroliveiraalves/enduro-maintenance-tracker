import tailwindcss from '@tailwindcss/vite'
import { SPLASH, splashFile } from './scripts/splash-sizes.mjs'

// Changes every build: revision of the precached SPA shell.
const BUILD_ID = Date.now().toString(36)

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  devServer: { port: 3010 },
  // The e2e build goes to its own dir so it never clobbers a running `nuxt dev`.
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',

  modules: ['@nuxt/eslint', '@pinia/nuxt', '@vueuse/nuxt', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  // Cross-fade between screens (browsers without the API just switch).
  experimental: { viewTransition: true },
  typescript: { strict: true, typeCheck: false },

  nitro: {
    ...(process.env.NUXT_OUTPUT_DIR ? { output: { dir: process.env.NUXT_OUTPUT_DIR } } : {}),
    // Hourly push due-check (server/tasks/notify.ts).
    experimental: { tasks: true },
    scheduledTasks: { '0 * * * *': ['notify'] },
  },

  // Baseline security headers. No script-src CSP yet: the QR reader (wasm) and
  // pdf.js need careful allow-listing, tested on real phones first.
  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        // Camera for invoice capture, microphone for voice notes; nothing else.
        'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
        'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
        // Browsers ignore HSTS over plain http, so this is safe in dev.
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      },
    },
    // Rider data never sits in a shared browser/proxy cache.
    '/api/**': { headers: { 'Cache-Control': 'no-store' } },
  },

  runtimeConfig: {
    databaseUrl: '',
    openrouterApiKey: '',
    openrouterModel: 'google/gemini-3.1-flash-lite',
    invoiceDailyCap: 30,
    invoiceGlobalDailyCap: 300,
    // '' = OpenRouter; 'mock' / 'mock-fail' = canned reader for e2e (NUXT_INVOICE_READER)
    invoiceReader: '',
    // Voice notes (NUXT_VOICE_*): model defaults to openrouterModel; 'mock' reader for e2e.
    voiceModel: '',
    voiceDailyCap: 60,
    voiceGlobalDailyCap: 600,
    voiceReader: '',
    // Comma-separated emails with the admin screen (NUXT_ADMIN_EMAILS).
    adminEmails: '',
    // Web Push (NUXT_VAPID_*; `pnpm vapid:generate`). No keys → push disabled, Settings says so.
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Dirt Garage',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
        { name: 'theme-color', content: '#0f1012' }, // the default (tricolor) look's bg; app/lib/theme.ts
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Dirt Garage' },
        { name: 'mobile-web-app-capable', content: 'yes' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/pwa-192x192.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        // In the static HTML, so browsers see the app as installable before any JS runs.
        { rel: 'manifest', href: '/manifest.webmanifest' },
        // iOS launch images (scripts/splash.mjs); without them the app opens on white.
        ...SPLASH.map(([w, h, r]: number[]) => ({
          rel: 'apple-touch-startup-image' as const,
          href: `/${splashFile(w, h, r)}`,
          media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
        })),
      ],
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    // Own service worker (app/sw.ts): workbox precache + SPA fallback + push handlers.
    strategies: 'injectManifest',
    srcDir: '.', // relative to the Nuxt srcDir (app/)
    filename: 'sw.ts',
    devOptions: { enabled: false },
    manifest: {
      name: 'Dirt Garage',
      short_name: 'Dirt Garage',
      description: 'Hours, service, parts and costs for your dirt bikes.',
      lang: 'en',
      theme_color: '#0f1012',
      background_color: '#0f1012',
      display: 'standalone',
      orientation: 'portrait',
      id: '/',
      categories: ['productivity', 'utilities', 'lifestyle'],
      // Long-press the home-screen icon.
      shortcuts: [
        { name: 'Read an invoice', short_name: 'Invoice', url: '/invoice', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        { name: 'Costs', url: '/costs', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
        { name: 'Parts shelf', short_name: 'Shelf', url: '/shelf', icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }] },
      ],
      // "Share → Dirt Garage" from the gallery or Files: handled by the worker (app/sw.ts), read on /invoice.
      share_target: {
        action: '/share-target',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: { files: [{ name: 'files', accept: ['image/jpeg', 'image/png', 'application/pdf'] }] },
      },
      start_url: '/',
      scope: '/',
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      // The SPA shell is rendered by Nitro (no index.html on disk): precache it
      // per build so the worker's navigation fallback has something to serve.
      additionalManifestEntries: [{ url: 'index.html', revision: BUILD_ID }],
      globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,ico,webmanifest}'],
      globIgnores: ['splash/**'], // iOS-only, fetched by the OS at launch: no need to precache ~10 images
      // ZXing's decoder wasm is ~1 MB+; the default 2 MB cap is too tight.
      maximumFileSizeToCacheInBytes: 4_000_000,
    },
  },
})
