import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const DEFAULT_URL = 'postgres://enduro:enduro@localhost:5433/enduro'

let _db: PostgresJsDatabase<typeof schema> | undefined

/** Connection string, read lazily so tests/scripts can set the env first. */
export function databaseUrl() {
  return process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL
}

export function getDb() {
  _db ??= drizzle(postgres(databaseUrl(), { max: 10 }), { schema })
  return _db
}

/** Lazy proxy so importing this module never opens a connection. */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get: (_t, prop, receiver) => Reflect.get(getDb(), prop, receiver),
})

export { schema }
