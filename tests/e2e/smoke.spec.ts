import { expect, test } from '@playwright/test'

test('home loads and shows the app name', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page.getByText('Enduro Tracker').first()).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/__screenshots__/task-1-smoke.png' })
})

test('health endpoint answers', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(await res.json()).toEqual({ ok: true })
})
