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
    command: 'node .output-e2e/server/index.mjs',
    url: WEB,
    env: { PORT: '3210' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
