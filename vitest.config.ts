import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const TEST_DB_URL = 'postgres://enduro:enduro@localhost:5433/enduro_test'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/support/vitest-global-setup.ts'],
    // Workers always talk to the throwaway test database (both names server/db/client.ts reads).
    env: { DATABASE_URL: TEST_DB_URL, NUXT_DATABASE_URL: TEST_DB_URL },
    // DB-backed tests share one database: run files one at a time.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
