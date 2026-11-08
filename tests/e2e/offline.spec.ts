import { expect, test, type Page } from '@playwright/test'
import { signUpFresh, sql } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

// Playwright blocks service workers in this project, so the shell can't come
// from the SW cache here: load online, go offline, then navigate client-side
// (tab taps). The full offline reload through the SW is in offline-sw.spec.ts.

const OFFLINE = "You're offline — try again when you're back online."

async function userId(page: Page): Promise<string> {
  const s = await page.request.get('/api/auth/get-session')
  return ((await s.json()) as { user: { id: string } }).user.id
}

/** Fresh rider + the mockup bike, with the bike screen, history and costs opened once online (that's the sync). */
async function primed(page: Page) {
  await signUpFresh(page)
  const bikeId = await seedMockupBike(page.request, 'Offline Bike')
  await page.goto(`/bikes/${bikeId}`)
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-service').first()).toBeVisible()
  await page.getByTestId('tab-costs').click()
  await expect(page.getByTestId('costs-total')).toBeVisible()
  await page.getByTestId('tab-bike').click()
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  return bikeId
}

test('bike screen, history and costs open offline; a ride logged offline syncs exactly once', async ({ page, context }) => {
  const bikeId = await primed(page)
  const uid = await userId(page)

  await context.setOffline(true)
  await expect(page.getByTestId('app-offline-banner')).toBeVisible()
  // Client-side navigation offline: the auth middleware trusts the cached session (no bounce to /login).
  await page.getByTestId('tab-history').click()
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByTestId('history-service').first()).toBeVisible()
  await page.getByTestId('tab-costs').click()
  await expect(page.getByTestId('costs-total')).toBeVisible()
  await page.getByTestId('tab-bike').click()
  await expect(page).toHaveURL(new RegExp(`/bikes/${bikeId}$`))
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')

  // Log a ride offline: hours card moves, badge shows it's waiting.
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('145,0')
  await page.getByTestId('km-input').fill('3900')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-sheet')).toBeHidden()
  await expect(page.getByTestId('hours-value')).toHaveText('145.0 h')
  await expect(page.getByTestId('last-ride')).toContainText('waiting to sync')
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')

  const db = sql()
  try {
    expect((await db`select count(*)::int as n from meter_readings where bike_id = ${bikeId} and hours_tenths = 1450`)[0]!.n).toBe(0)

    // Back online: the `online` event flushes the outbox.
    await context.setOffline(false)
    await expect(page.getByTestId('pending-badge')).toBeHidden()
    await expect(page.getByTestId('app-offline-banner')).toBeHidden()
    await expect(page.getByTestId('last-ride')).not.toContainText('waiting to sync')
    await expect(page.getByTestId('hours-value')).toHaveText('145.0 h')
    const rows = await db`select client_id from meter_readings where user_id = ${uid} and hours_tenths = 1450`
    expect(rows).toHaveLength(1)

    // Review Focus 3: a replay of that same write (lost response, double flush) creates nothing new.
    const again = await page.request.post('/api/readings', { data: { clientId: rows[0]!.client_id, bikeId, hoursTenths: 1450, km: 3900 } })
    expect(again.status()).toBe(200)
    expect((await db`select count(*)::int as n from meter_readings where user_id = ${uid} and hours_tenths = 1450`)[0]!.n).toBe(1)
  } finally {
    await db.end()
  }
})

test('offline service and expense show as pending, then sync', async ({ page, context }) => {
  const bikeId = await primed(page)
  const uid = await userId(page)
  const db = sql()
  const services = async () => (await db`select count(*)::int as n from services where bike_id = ${bikeId}`)[0]!.n as number
  const before = await services()
  // The air filter's page was opened online once (cached); the chain's never was.
  await page.getByTestId('item-row').filter({ hasText: 'Air filter clean' }).click()
  await expect(page.getByTestId('service-entry').first()).toBeVisible()
  await page.getByTestId('back-to-bike').click()
  await context.setOffline(true)

  await page.getByTestId('item-row').filter({ hasText: 'Chain & sprockets' }).click()
  await expect(page.getByTestId('item-name')).toHaveText('Chain & sprockets')
  await expect(page.getByTestId('history-not-cached')).toBeVisible()
  await page.getByTestId('back-to-bike').click()

  // Mark the air filter done offline: the row says pending sync (status is recomputed by the server later).
  await page.getByTestId('item-row').filter({ hasText: 'Air filter clean' }).click()
  await expect(page.getByTestId('item-name')).toHaveText('Air filter clean')
  await page.getByTestId('mark-done').click()
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('mark-done-sheet')).toBeHidden()
  await expect(page.getByTestId('service-pending')).toBeVisible()
  await page.getByTestId('back-to-bike').click()
  await expect(page.getByTestId('item-row').filter({ hasText: 'Air filter clean' }).getByTestId('item-pending')).toBeVisible()

  // An expense offline lands at the top of history, marked pending.
  await page.getByTestId('tab-history').click()
  await page.getByTestId('add-expense').click()
  await page.getByTestId('ex-amount').fill('41,60')
  await page.getByTestId('ex-description').fill('Fuel offline')
  await page.getByTestId('ex-save').click()
  await expect(page.getByTestId('expense-sheet')).toBeHidden()
  const pendingExpense = page.getByTestId('history-expense').filter({ hasText: 'Fuel offline' })
  await expect(pendingExpense).toContainText('41,60 €')
  await expect(pendingExpense.getByTestId('history-pending')).toBeVisible()
  await expect(page.getByTestId('pending-badge')).toHaveText('2 changes waiting')

  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toBeHidden()
  await expect(pendingExpense.getByTestId('history-pending')).toBeHidden()
  await expect(pendingExpense.getByTestId('delete-expense')).toBeVisible()

  try {
    expect((await db`select count(*)::int as n from expenses where user_id = ${uid} and description = 'Fuel offline'`)[0]!.n).toBe(1)
    expect(await services()).toBe(before + 1)
  } finally {
    await db.end()
  }
  await page.getByTestId('tab-bike').click()
  await expect(page.getByTestId('item-row').filter({ hasText: 'Air filter clean' }).getByTestId('item-pending')).toHaveCount(0)
})

test('a queued write the server refuses is dropped and explained, with Dismiss', async ({ page, context }) => {
  const bikeId = await primed(page)
  await context.setOffline(true)
  // Meanwhile, another device logged 150.0 h (the API request context isn't offline).
  const other = await page.request.post('/api/readings', { data: { clientId: crypto.randomUUID(), bikeId, hoursTenths: 1500, km: 3950 } })
  expect(other.ok()).toBeTruthy()

  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('145')
  await page.getByTestId('km-input').fill('3900')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')

  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toHaveText("1 change couldn't be saved")
  await page.getByTestId('pending-badge').click()
  await expect(page.getByTestId('pending-failed')).toContainText("1 change couldn't be saved:")
  await expect(page.getByTestId('pending-failed-reason')).toHaveText("Hours can't go down (last: 150.0 h)")
  await page.getByTestId('pending-dismiss').click()
  await expect(page.getByTestId('pending-badge')).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('hours-value')).toHaveText('150.0 h')
})

test('offline: a ride lower than the last synced one is caught before it is queued', async ({ page, context }) => {
  await primed(page)
  await context.setOffline(true)
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('140')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('log-error')).toHaveText("Hours can't go down (last: 142.5 h)")
  await page.getByTestId('hours-input').fill('200')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('jump-prompt')).toBeVisible()
  await expect(page.getByTestId('pending-badge')).toHaveCount(0)
  await context.setOffline(false)
})

test('online-only actions say so offline and queue nothing', async ({ page, context }) => {
  await primed(page)
  await page.getByTestId('settings-link').click()
  await expect(page.getByTestId('account-email')).toContainText('@example.com')
  await context.setOffline(true)
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('sign-out-error')).toHaveText(OFFLINE)
  await expect(page).toHaveURL(/\/settings$/)
  await page.getByTestId('delete-confirm').fill('DELETE')
  await page.getByTestId('delete-account-button').click()
  await expect(page.getByTestId('delete-account').getByRole('alert')).toHaveText(OFFLINE)
  await expect(page.getByTestId('pending-badge')).toHaveCount(0)
  await context.setOffline(false)
})

test('sign out wipes the offline cache and outbox from this device', async ({ page }) => {
  await primed(page)
  const count = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('enduro-offline')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const db = req.result
            const names = [...db.objectStoreNames]
            if (!names.length) return resolve(0)
            const tx = db.transaction(names, 'readonly')
            let total = 0
            let left = names.length
            for (const n of names) {
              const c = tx.objectStore(n).count()
              c.onsuccess = () => {
                total += c.result
                if (--left === 0) {
                  db.close()
                  resolve(total)
                }
              }
            }
          }
        }),
    )
  expect(await count()).toBeGreaterThan(0)
  expect(await page.evaluate(() => localStorage.getItem('enduro:session'))).toContain('@example.com')
  await page.getByTestId('settings-link').click()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await count()).toBe(0)
  expect(await page.evaluate(() => [localStorage.getItem('enduro:session'), localStorage.getItem('enduro:lastBike')])).toEqual([null, null])
})
