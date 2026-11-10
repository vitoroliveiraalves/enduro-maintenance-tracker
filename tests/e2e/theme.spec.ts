import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'

test('the tricolor is the default; Settings switches to Stamped Steel and back, and it sticks on this phone', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/settings')
  const html = page.locator('html')
  const bar = page.locator('meta[name="theme-color"]')
  await expect(html).toHaveAttribute('data-theme', 'tricolor')
  await expect(page.getByRole('radio', { name: /Old-school tricolor/ })).toBeChecked()
  await expect(bar).toHaveAttribute('content', '#0f1012')

  await page.getByRole('radio', { name: /Stamped Steel/ }).check()
  await expect(html).toHaveAttribute('data-theme', 'steel')
  await expect(bar).toHaveAttribute('content', '#0e0e0e')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'steel')

  await page.getByRole('radio', { name: /Old-school tricolor/ }).check()
  await expect(html).toHaveAttribute('data-theme', 'tricolor')
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())
  expect(accent.toLowerCase()).toBe('#d21f2a')
  await expect(bar).toHaveAttribute('content', '#0f1012')

  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'tricolor')
  await expect(bar).toHaveAttribute('content', '#0f1012')
  await page.goto('/')
  await expect(html).toHaveAttribute('data-theme', 'tricolor')

  await page.goto('/settings')
  await page.getByRole('radio', { name: /Stamped Steel/ }).check()
  await expect(html).toHaveAttribute('data-theme', 'steel')
  await expect(bar).toHaveAttribute('content', '#0e0e0e')
})

test('the Garage header carries the tyre mark (red rim ring in the default look)', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/')
  const mark = page.getByTestId('brand-mark')
  await expect(mark).toBeVisible()
  await expect(mark.locator('rect')).toHaveCount(34)
  const ring = mark.locator('circle').nth(1)
  expect(await ring.evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(210, 31, 42)')
})

test('manifest: Dirt Garage name, tricolor background, stable id and home-screen shortcuts', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m.name).toBe('Dirt Garage')
  expect(m.short_name).toBe('Dirt Garage')
  expect(m.theme_color).toBe('#0f1012')
  expect(m.background_color).toBe('#0f1012')
  expect(m.id).toBe('/')
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/invoice', '/costs', '/shelf'])
})
