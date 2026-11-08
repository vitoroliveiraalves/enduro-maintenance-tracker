import type { Page } from '@playwright/test'
import postgres from 'postgres'

export const E2E_USER = { email: 'rider@example.com', password: 'enduro-pass-1' }
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
