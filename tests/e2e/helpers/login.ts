import type { Page } from '@playwright/test'
import postgres from 'postgres'

export const E2E_USER = { email: 'rider@example.com', password: 'enduro-pass-1' }
/** In NUXT_ADMIN_EMAILS (playwright.config.ts). */
export const E2E_ADMIN = { email: 'admin@example.com', password: 'enduro-pass-1' }
export const E2E_DB_URL = 'postgres://enduro:enduro@localhost:5433/enduro_e2e'

/** Sign in through the real login form as the user created by the e2e prepare step. */
export async function loginAs(page: Page, user = E2E_USER) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

export function sql() {
  return postgres(E2E_DB_URL, { max: 1 })
}

/**
 * A brand-new user signed in on this page's context (default categories seeded
 * by the sign-up hook). Tests that upload invoices use one each, so dedupe,
 * document counts and bikes never leak between parallel tests.
 */
export async function signUpFresh(page: Page) {
  const user = { email: `rider-${crypto.randomUUID()}@example.com`, password: 'enduro-pass-1' }
  const res = await page.request.post('/api/auth/sign-up/email', { data: { ...user, name: 'rider' } })
  if (!res.ok()) throw new Error(`sign-up failed: ${res.status()} ${await res.text()}`)
  return user
}
