import { defineConfig, devices } from '@playwright/test'
import webpush from 'web-push'

const vapid = webpush.generateVAPIDKeys()

// E2E runs against the production build (`pnpm e2e` builds into .output-e2e) on 3210.
const WEB = 'http://localhost:3210'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'on-first-retry', serviceWorkers: 'block' },
  projects: [
    // English phone unless a test says otherwise (the app follows the phone's language).
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 380, height: 780 }, locale: 'en-US' } },
  ],
  webServer: {
    // Fresh enduro_e2e database (never the dev one) + the login user, then the production server.
    command: 'tsx tests/support/e2e-prepare.ts && node .output-e2e/server/index.mjs',
    url: WEB,
    env: {
      PORT: '3210',
      DATABASE_URL: 'postgres://enduro:enduro@localhost:5433/enduro_e2e',
      BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-0123456789',
      BETTER_AUTH_URL: WEB,
      AUTH_RATE_LIMIT_MAX: '200',
      // Canned invoice reader: 3 lines, or a failure for files carrying MOCK-FAIL (see server/utils/invoice-read.ts).
      NUXT_INVOICE_READER: 'mock',
      // Canned voice reader: fixed rules on the transcript (see mockVoice in server/utils/voice.ts).
      NUXT_VOICE_READER: 'mock',
      // Fresh throwaway key pair per run (push is never actually delivered in tests).
      NUXT_VAPID_PUBLIC_KEY: vapid.publicKey,
      NUXT_VAPID_PRIVATE_KEY: vapid.privateKey,
      NUXT_VAPID_SUBJECT: 'mailto:e2e@example.com',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
