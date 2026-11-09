const EXAMPLE_SECRET = 'change-me-to-a-long-random-string'

/**
 * Production settings that must be right before serving riders. Returns
 * `errors` (refuse to start) and `warnings` (start, but say so in the log).
 */
export function checkProductionEnv(env: Record<string, string | undefined>) {
  const errors: string[] = []
  const warnings: string[] = []
  const secret = env.BETTER_AUTH_SECRET ?? ''
  if (!secret) errors.push('BETTER_AUTH_SECRET is not set (sign-in would fail with 500s).')
  else if (secret === EXAMPLE_SECRET) errors.push('BETTER_AUTH_SECRET is still the .env.example placeholder.')
  else if (secret.length < 32) errors.push('BETTER_AUTH_SECRET is shorter than 32 characters; use `openssl rand -base64 48`.')

  const url = env.BETTER_AUTH_URL ?? ''
  if (!url) errors.push('BETTER_AUTH_URL is not set (must be the public https origin riders open).')
  else if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    warnings.push(`BETTER_AUTH_URL (${url}) is not https; cookies and push need https in production.`)
  }

  if ((env.DATABASE_URL ?? '').includes('change-me-hex-only')) errors.push('POSTGRES_PASSWORD is still the .env.example placeholder.')

  if (!env.NUXT_VAPID_PUBLIC_KEY || !env.NUXT_VAPID_PRIVATE_KEY) warnings.push('NUXT_VAPID_* not set: push notifications are off.')
  else if (!/^mailto:.+@.+/.test(env.NUXT_VAPID_SUBJECT ?? '') || /you@example\.com/.test(env.NUXT_VAPID_SUBJECT ?? '')) {
    warnings.push('NUXT_VAPID_SUBJECT should be a real mailto: address (Apple rejects placeholders).')
  }
  if (!env.NUXT_OPENROUTER_API_KEY) warnings.push('NUXT_OPENROUTER_API_KEY not set: invoice lines are typed by hand.')
  return { errors, warnings }
}
