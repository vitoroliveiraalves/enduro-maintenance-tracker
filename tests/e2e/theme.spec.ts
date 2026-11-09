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

  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'tricolor')
  await page.goto('/')
  await expect(html).toHaveAttribute('data-theme', 'tricolor')

  await page.goto('/settings')
  await page.getByRole('radio', { name: /Stamped Steel/ }).check()
  await expect(html).toHaveAttribute('data-theme', 'steel')
})
