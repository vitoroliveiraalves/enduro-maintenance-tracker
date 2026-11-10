import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'

test('Settings switches the look between Stamped Steel and the tricolor, and it sticks on this phone', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/settings')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'steel')
  await expect(page.getByRole('radio', { name: /Stamped Steel/ })).toBeChecked()

  await page.getByRole('radio', { name: /Old-school tricolor/ }).check()
  await expect(html).toHaveAttribute('data-theme', 'tricolor')
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())
  expect(accent.toLowerCase()).toBe('#d21f2a')

  const bar = page.locator('meta[name="theme-color"]')
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

test('manifest: stable id and home-screen shortcuts', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m.id).toBe('/')
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/invoice', '/costs', '/shelf'])
})
