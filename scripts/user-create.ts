// Usage: pnpm user:create <email> <password>   (reads DATABASE_URL / BETTER_AUTH_SECRET from the env)
import { auth } from '../server/utils/auth'

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: pnpm user:create <email> <password>')
  process.exit(1)
}

try {
  const res = await auth.api.signUpEmail({ body: { email, password, name: email.split('@')[0]! } })
  console.log(`Created ${res.user.email} (${res.user.id})`)
  process.exit(0)
} catch (e) {
  console.error('Failed:', e instanceof Error ? e.message : e)
  process.exit(1)
}
