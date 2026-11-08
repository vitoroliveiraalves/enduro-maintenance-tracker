import { sql } from 'drizzle-orm'
import { db } from '../../server/db/client'

/** Throws unless the connected database is a throwaway `*_test` one. */
export async function assertTestDatabase() {
  const [row] = (await db.execute(sql`select current_database() as name`)) as unknown as Array<{ name: string }>
  if (!row?.name.endsWith('_test')) throw new Error(`Refusing to wipe database "${row?.name}": tests only TRUNCATE a *_test database`)
}

/** Wipe every user (and, by cascade, all their data) — only ever in the test database. */
export async function truncateUsers() {
  await assertTestDatabase()
  await db.execute(sql`TRUNCATE "user" CASCADE`)
}
