import { expect, test, type Page } from '@playwright/test'
import { sql, signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

/** Local calendar day `n` days from today, "YYYY-MM-DD". */
function dayFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function seedBike(page: Page, name = 'Reminder Bike') {
  const res = await page.request.post('/api/bikes', { data: bikeBody(name, [{ name: 'Gearbox oil', everyHoursTenths: 150 }]) })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { id: string }).id
}

/**
 * Headless Chromium can't reach a real push service (and e2e blocks service
 * workers), so stand in a registration whose pushManager hands out a fake
 * subscription (mocking PushManager is the agreed fallback). Everything after that — the subscribe call and the stored
 * row — is real.
 */
async function fakePushManager(page: Page) {
  await page.addInitScript(() => {
    let current: object | null = null
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`
    const sub = {
      endpoint,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }),
      unsubscribe: async () => ((current = null), true),
    }
    const reg = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async () => (current = sub),
      },
    }
    Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', { get: () => Promise.resolve(reg) })
    // Headless Chromium reports 'denied' before the first request even with the
    // permission granted to the context; a fresh phone reports 'default'.
    // requestPermission() itself stays real (granted via grantPermissions).
    Object.defineProperty(Notification, 'permission', { get: () => 'default' })
  })
}

test('IUC reminder: add from Settings, chip on the bike screen, mark done rolls a year', async ({ page }) => {
  await signUpFresh(page)
  const bikeId = await seedBike(page)
  const due = dayFromNow(12)

  await page.goto('/settings')
  await page.getByTestId('add-reminder').click()
  await page.getByTestId('preset-IUC').click()
  await expect(page.getByTestId('rem-title')).toHaveValue('IUC')
  await page.getByTestId('rem-date').fill(due)
  await page.getByTestId('rem-save').click()
  const row = page.getByTestId('reminder-row')
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('reminder-title')).toHaveText('IUC')
  await expect(row.getByTestId('reminder-when')).toContainText('in 12 days')
  await expect(row).toContainText('Reminder Bike · yearly') // the only bike is picked by default

  // A reminder further out than 30 days gets no chip.
  const far = await page.request.post('/api/reminders', { data: { clientId: crypto.randomUUID(), title: 'Insurance', dueOn: dayFromNow(45) } })
  expect(far.ok()).toBeTruthy()
  const overdue = await page.request.post('/api/reminders', { data: { clientId: crypto.randomUUID(), title: 'Inspection', dueOn: dayFromNow(-2), bikeId } })
  expect(overdue.ok()).toBeTruthy()
  // Impossible dates are a 400, never a 500.
  expect((await page.request.post('/api/reminders', { data: { clientId: crypto.randomUUID(), title: 'X', dueOn: '2026-13-45' } })).status()).toBe(400)

  await page.goto(`/bikes/${bikeId}`)
  const chips = page.getByTestId('reminder-chip')
  await expect(chips).toHaveText(['Inspection · overdue', 'IUC · in 12 days'])
  await expect(chips.filter({ hasText: 'IUC' })).toHaveClass(/text-warn-text/)
  await expect(chips.filter({ hasText: 'Inspection' })).toHaveClass(/text-danger-text/)

  await chips.filter({ hasText: 'IUC' }).click()
  await expect(page).toHaveURL(/\/settings#reminders$/)
  const iuc = page.getByTestId('reminder-row').filter({ hasText: 'IUC' })
  await iuc.getByTestId('reminder-done').click()
  const nextYear = String(Number(due.slice(0, 4)) + 1)
  await expect(iuc.getByTestId('reminder-when')).toContainText(nextYear)

  // A one-off reminder leaves the list when done.
  await page.getByTestId('reminder-row').filter({ hasText: 'Inspection' }).getByTestId('reminder-done').click()
  await expect(page.getByTestId('reminder-row')).toHaveCount(2)
  await expect(page.getByTestId('reminder-row').filter({ hasText: 'Inspection' })).toHaveCount(0)
})

test('turning notifications on stores the subscription with the timezone; off removes it', async ({ page, context }) => {
  await context.grantPermissions(['notifications'])
  await fakePushManager(page)
  const user = await signUpFresh(page)
  await page.goto('/settings')
  const toggle = page.getByTestId('push-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  const db = sql()
  try {
    const rows = await db`SELECT s.endpoint, s.timezone, s.p256dh FROM push_subscriptions s JOIN "user" u ON u.id = s.user_id WHERE u.email = ${user.email}`
    expect(rows).toHaveLength(1)
    expect(rows[0]!.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\/e2e-/)
    expect(rows[0]!.timezone).toBe(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone))

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect
      .poll(async () => (await db`SELECT 1 FROM push_subscriptions s JOIN "user" u ON u.id = s.user_id WHERE u.email = ${user.email}`).length)
      .toBe(0)
  } finally {
    await db.end()
  }
})

test('push off on the server: Settings says so calmly', async ({ page }) => {
  await signUpFresh(page)
  await page.route('**/api/push/vapid-key', (r) => r.fulfill({ status: 404, body: '{}' }))
  await page.goto('/settings')
  await expect(page.getByTestId('push-not-configured')).toHaveText("Notifications aren't set up on this server.")
  await expect(page.getByTestId('push-toggle')).toHaveCount(0)
})

test.describe('iPhone in Safari (not installed)', () => {
  test.use({ userAgent: IPHONE_UA })

  test('a popup explains Add to Home Screen once; Got it snoozes it; Settings keeps the help', async ({ page }) => {
    await signUpFresh(page)
    const bikeId = await seedBike(page)
    await page.goto(`/bikes/${bikeId}`)
    await expect(page.getByTestId('install-popup')).toBeVisible()
    await expect(page.getByTestId('install-popup-ios')).toContainText("Choose 'Add to Home Screen'.")
    await page.getByTestId('install-popup-ok').click()
    await expect(page.getByTestId('install-popup')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('bike-name')).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('install-popup')).toHaveCount(0)

    await page.goto('/settings')
    await expect(page.getByTestId('push-ios')).toHaveText('Add to Home Screen first, then turn notifications on.')
    await expect(page.getByTestId('install-ios')).toHaveText("To get notifications, add Dirt Garage to your Home Screen: tap Share , then 'Add to Home Screen'.")
    await expect(page.getByTestId('push-toggle')).toHaveCount(0)
  })

  test('no popup before sign-in', async ({ page }) => {
    await page.goto('/login')
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('install-popup')).toHaveCount(0)
  })
})

test('Chrome/Android: the popup opens the browser install dialog', async ({ page }) => {
  await signUpFresh(page)
  const bikeId = await seedBike(page)
  await page.goto(`/bikes/${bikeId}`)
  await expect(page.getByTestId('bike-name')).toBeVisible()
  // What Chrome fires when the site is installable.
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
    e.prompt = async () => {
      ;(window as unknown as { prompted: boolean }).prompted = true
    }
    e.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(e)
  })
  await expect(page.getByTestId('install-popup')).toBeVisible()
  await page.getByTestId('install-popup-install').click()
  await expect(page.getByTestId('install-popup')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true)
})

test('Chrome/Android: Not now hides the popup and it stays hidden after a reload', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/settings')
  const fire = () =>
    page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
      e.prompt = async () => {}
      e.userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(e)
    })
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible()
  await fire()
  await expect(page.getByTestId('install-popup')).toBeVisible()
  await page.getByTestId('install-popup-later').click()
  await expect(page.getByTestId('install-popup')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible()
  await fire()
  await page.waitForTimeout(2000)
  await expect(page.getByTestId('install-popup')).toHaveCount(0)
  // Settings still offers it.
  await expect(page.getByTestId('install-button')).toBeVisible()
})

test('sign out returns to the login page', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/settings')
  await page.getByTestId('sign-out').click()
  await page.waitForURL('/login')
  await page.goto('/settings')
  await page.waitForURL('/login')
})

test('delete my account: type DELETE, everything goes, the login then fails', async ({ page }) => {
  const user = await signUpFresh(page)
  await seedBike(page, 'Doomed Bike')
  await page.request.post('/api/reminders', { data: { clientId: crypto.randomUUID(), title: 'IUC', dueOn: dayFromNow(5) } })
  await page.goto('/settings')

  const button = page.getByTestId('delete-account-button')
  await expect(button).toBeDisabled()
  await page.getByTestId('delete-confirm').fill('delete')
  await expect(button).toBeDisabled()
  await page.getByTestId('delete-confirm').fill('DELETE')
  await expect(button).toBeEnabled()
  // No browser dialog may appear on the way.
  page.on('dialog', () => {
    throw new Error('unexpected browser dialog')
  })
  await button.click()
  await page.waitForURL('/login?deleted=1')
  await expect(page.getByTestId('deleted-notice')).toHaveText('Your account and data were deleted.')

  const db = sql()
  try {
    expect(await db`SELECT 1 FROM "user" WHERE email = ${user.email}`).toHaveLength(0)
    expect(await db`SELECT 1 FROM bikes WHERE name = 'Doomed Bike'`).toHaveLength(0)
  } finally {
    await db.end()
  }

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password')
  await expect(page).toHaveURL(/\/login/)
})
