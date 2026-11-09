import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

// The real thing: a full reload with no network. The service worker serves the
// precached SPA shell, the auth middleware trusts the cached session, and the
// bike screen renders from Dexie.
test.use({ serviceWorkers: 'allow' })

test('full reload offline renders the bike screen from the SW shell and the Dexie cache', async ({ page, context }) => {
  await signUpFresh(page)
  const bikeId = await seedMockupBike(page.request, 'SW Bike')
  await page.goto(`/bikes/${bikeId}`)
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  // Installed (precache done) and controlling this page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
  })

  await context.setOffline(true)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/bikes/${bikeId}$`))
  await expect(page.getByTestId('bike-name')).toHaveText('SW Bike')
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  await expect(page.getByTestId('item-row')).toHaveCount(5)
  await expect(page.getByTestId('app-offline-banner')).toBeVisible()

  // A ride logged after the offline reload is queued, and syncs when back.
  await page.getByTestId('log-ride').click()
  await page.getByTestId('hours-input').fill('143,5')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('hours-value')).toHaveText('143.5 h')
  await expect(page.getByTestId('pending-badge')).toHaveText('1 change waiting')
  await context.setOffline(false)
  await expect(page.getByTestId('pending-badge')).toBeHidden()
})

test('the served HTML links the web app manifest, so phones offer to install it', async ({ request }) => {
  // Raw HTML, before any JS: install prompts and Add to Home Screen read this.
  const html = await (await request.get('/login')).text()
  const href = html.match(/<link[^>]*rel="manifest"[^>]*href="([^"]+)"/)?.[1]
  expect(href).toBe('/manifest.webmanifest')
  const manifest = (await (await request.get(href!)).json()) as { display: string; start_url: string; icons: Array<{ sizes: string }> }
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect((await request.get('/sw.js')).ok()).toBeTruthy()
})
