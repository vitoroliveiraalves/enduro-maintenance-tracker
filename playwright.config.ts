import { defineConfig, devices } from '@playwright/test'

// E2E runs against the production build (`pnpm e2e` builds into .output-e2e) on 3210.
const WEB = 'http://localhost:3210'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'on-first-retry', serviceWorkers: 'block' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 380, height: 780 } } },
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
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
