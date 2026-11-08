// Applies server/db/migrations to DATABASE_URL with drizzle's runtime migrator
// (no drizzle-kit needed). Dev: `pnpm db:migrate:prod`. The Docker image ships
// it pre-bundled: `node .output/migrate.mjs` (MIGRATIONS_DIR defaults to
// server/db/migrations, relative to the working directory).
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}
const migrationsFolder = process.env.MIGRATIONS_DIR || 'server/db/migrations'

const conn = postgres(url, { max: 1, onnotice: () => {} })
try {
  await migrate(drizzle(conn), { migrationsFolder })
  console.log(`Migrations applied from ${migrationsFolder}`)
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  await conn.end()
}
