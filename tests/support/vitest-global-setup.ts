import { createFreshDb, urlFor } from './test-db'

export default async function setup() {
  await createFreshDb('enduro_test')
  process.env.DATABASE_URL = urlFor('enduro_test')
  delete process.env.NUXT_DATABASE_URL
}
