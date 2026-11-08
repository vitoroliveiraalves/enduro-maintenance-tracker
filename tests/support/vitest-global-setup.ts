import { createFreshDb, urlFor } from './test-db'

export default async function setup() {
  await createFreshDb('enduro_test')
  // Workers get the same URL from vitest.config.ts `test.env`; truncateUsers() refuses anything but *_test.
  process.env.DATABASE_URL = urlFor('enduro_test')
  process.env.NUXT_DATABASE_URL = urlFor('enduro_test')
}
