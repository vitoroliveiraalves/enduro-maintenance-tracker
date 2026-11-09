import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/login'

test('add a 2T bike with Gearbox oil last done, see overdue and unknown rows', async ({ page }) => {
  await loginAs(page)
  await page.getByTestId('add-bike').click()
  await expect(page).toHaveURL(/\/bikes\/new$/)
  await expect(page.getByTestId('bottom-tabs')).toBeVisible()
  await page.getByLabel('Name').fill('KTM 300 EXC')
  await page.getByLabel('Make').fill('KTM')
  await page.getByLabel('Model').fill('300 EXC')
  await page.getByLabel('Current hours').fill('142,5')
  await page.getByLabel('Current km').fill('3812')
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/bike-new.png' })
  await page.getByRole('button', { name: 'Next: maintenance items' }).click()

  const draft = page.getByTestId('item-draft').filter({ has: page.locator('input[aria-label="Item name"]') }).first()
  await expect(draft).toBeVisible()
  await draft.locator('summary').click()
  await page.getByLabel('Gearbox oil last done hours').fill('122')
  await draft.locator('summary').click() // folded again: what was typed still counts
  await page.getByRole('button', { name: 'Remove Coolant' }).click()
  await page.getByRole('button', { name: 'Save bike' }).click()

  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)
  const gearbox = page.getByTestId('item-row').filter({ hasText: 'Gearbox oil' })
  await expect(gearbox).toBeVisible()
  await expect(gearbox.getByTestId('item-state')).toHaveText(/overdue/)
  await expect(page.getByTestId('item-row').first()).toContainText('Gearbox oil')
  await expect(page.getByTestId('item-state').filter({ hasText: /^Unknown$/ }).first()).toBeVisible()
  await expect(page.getByTestId('item-row').filter({ hasText: 'Coolant' })).toHaveCount(0)

  // Garage lists it with an overdue count; Bike tab returns to the last bike
  await page.getByTestId('tab-costs').click()
  await expect(page.getByRole('heading', { name: 'Running costs' })).toBeVisible()
  await page.getByTestId('tab-bike').click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)
  await page.goto('/')
  const card = page.getByTestId('bike-card').filter({ has: page.getByText('KTM 300 EXC', { exact: true }) })
  await expect(card.getByTestId('count-overdue')).toContainText('1')
  await expect(card).toContainText('142.5 h')
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/garage.png' })
})

test('tabs are hidden on login', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByTestId('bottom-tabs')).toHaveCount(0)
})
