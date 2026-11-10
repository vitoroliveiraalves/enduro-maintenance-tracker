import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db, schema } from '../db/client'
import { ipAddressOptions } from './auth-ip'
import { DEFAULT_CATEGORIES } from './categories-seed'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3010'

const authMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10)

export const auth = betterAuth({
  appName: 'Dirt Garage',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  advanced: {
    database: { generateId: 'uuid' },
    ipAddress: ipAddressOptions(),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  // better-auth's built-in IP rate limiter; credential endpoints get a tighter window.
  rateLimit: {
    enabled: true,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: authMax },
      '/sign-up/email': { window: 60, max: authMax },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(schema.categories)
            .values(DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: user.id })))
        },
      },
    },
  },
})
