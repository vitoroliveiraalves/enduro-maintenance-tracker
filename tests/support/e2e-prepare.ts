// Runs before the e2e server starts: fresh enduro_e2e database + the login test user.
import { createFreshDb, urlFor } from './test-db'

process.env.DATABASE_URL = urlFor('enduro_e2e')
await createFreshDb('enduro_e2e')
const { auth } = await import('../../server/utils/auth')
await auth.api.signUpEmail({ body: { email: 'rider@example.com', password: 'enduro-pass-1', name: 'rider' } })
process.exit(0)
