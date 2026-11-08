import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const ADMIN = 'postgres://enduro:enduro@localhost:5433/postgres'

export function urlFor(name: string) {
  return `postgres://enduro:enduro@localhost:5433/${name}`
}

/** (Re)create database `name` from scratch and apply all migrations. */
export async function createFreshDb(name: string) {
  const admin = postgres(ADMIN, { max: 1 })
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${name}`)
  await admin.end()
  const conn = postgres(urlFor(name), { max: 1 })
  await migrate(drizzle(conn), { migrationsFolder: 'server/db/migrations' })
  await conn.end()
}
