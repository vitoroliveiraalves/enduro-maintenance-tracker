import tailwindcss from '@tailwindcss/vite'

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
  typescript: { strict: true, typeCheck: false },

  nitro: {
    ...(process.env.NUXT_OUTPUT_DIR ? { output: { dir: process.env.NUXT_OUTPUT_DIR } } : {}),
  },

  runtimeConfig: {
    databaseUrl: '',
    openrouterApiKey: '',
    openrouterModel: 'google/gemini-3.1-flash-lite',
    invoiceDailyCap: 30,
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Enduro Tracker',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#121417' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
      ],
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    devOptions: { enabled: false },
    manifest: {
      name: 'Enduro Tracker',
      short_name: 'Enduro',
      description: 'Maintenance and costs for your enduro bikes.',
      lang: 'en',
      theme_color: '#121417',
      background_color: '#121417',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      icons: [],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,ico,webmanifest}'],
      // SPA: every navigation falls back to the app shell.
      navigateFallback: '/index.html',
    },
  },
})
