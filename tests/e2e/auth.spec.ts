import { expect, test } from '@playwright/test'
import { E2E_USER, loginAs, sql } from './helpers/login'

const uniq = () => `rider-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('register lands on an empty garage with default categories; duplicate email is refused', async ({ page, context }) => {
  const email = uniq()
  await page.goto('/login')
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(page).toHaveURL(/\/register$/)
  await expect(page.getByText('Your bikes, costs and invoice photos are stored on our server.')).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password (min. 8 characters)').fill('longenough1')
  await page.getByLabel('Confirm password').fill('longenough1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('/')
  await expect(page.getByTestId('empty-garage')).toBeVisible()

  const db = sql()
  const rows = await db`select c.name from categories c join "user" u on u.id = c.user_id where u.email = ${email} order by c.name`
  await db.end()
  expect(rows.map((r) => r.name).sort()).toEqual(
    ['Maintenance', 'Parts', 'Tyres & mousse', 'Fuel & 2T oil', 'Race entries', 'Insurance / IUC / inspection', 'Upgrades', 'Gear', 'Labour', 'Other'].sort(),
  )

  await context.clearCookies()
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password (min. 8 characters)').fill('longenough1')
  await page.getByLabel('Confirm password').fill('longenough1')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('An account with this email already exists')).toBeVisible()
})

test('password shorter than 8 characters is rejected', async ({ page, request }) => {
  await page.goto('/register')
  await page.getByLabel('Email').fill(uniq())
  await page.getByLabel('Password (min. 8 characters)').fill('short')
  await page.getByLabel('Confirm password').fill('short')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible()
  await expect(page).toHaveURL(/\/register$/)

  // and the server enforces it too
  const res = await request.post('/api/auth/sign-up/email', {
    data: { email: uniq(), password: 'short', name: 'x' },
  })
  expect(res.status()).toBe(400)
})

test('wrong password shows the error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(E2E_USER.email)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong email or password')).toBeVisible()
})

test('correct login reaches the garage', async ({ page }) => {
  await loginAs(page)
  await expect(page.getByTestId('empty-garage')).toBeVisible()
})

test("user A cannot GET user B's bike", async ({ page }) => {
  const db = sql()
  const [b] = await db`insert into "user" (name, email) values ('b', ${uniq()}) returning id`
  const [bike] = await db`insert into bikes (user_id, name, make, model, year, stroke) values (${b!.id}, 'B bike', 'KTM', '300', 2022, '2T') returning id`
  await db.end()

  const anon = await page.request.get(`/api/bikes/${bike!.id}`)
  expect(anon.status()).toBe(401)

  await loginAs(page)
  const res = await page.request.get(`/api/bikes/${bike!.id}`)
  expect(res.status()).toBe(404)
})

test('login screenshot', async ({ page }) => {
  test.skip(!process.env.SCREENSHOTS, 'screenshots only with SCREENSHOTS=1')
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/login.png' })
})
