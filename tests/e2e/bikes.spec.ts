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

  // The Garage tab opens the garage (never a bike on its own), which lists it with an overdue count
  await page.getByTestId('tab-costs').click()
  await expect(page.getByRole('heading', { name: 'Running costs' })).toBeVisible()
  await page.getByTestId('tab-garage').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Garage' })).toBeVisible()
  const card = page.getByTestId('bike-card').filter({ has: page.getByText('KTM 300 EXC', { exact: true }) })
  await expect(card.getByTestId('count-overdue')).toContainText('1')
  await expect(card).toContainText('142.5')
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'tests/e2e/__screenshots__/garage.png' })
})

test('add a car with license plate and verify car templates and garage card', async ({ page }) => {
  await loginAs(page)
  await page.getByTestId('add-bike').click()
  await expect(page).toHaveURL(/\/bikes\/new$/)

  // Select Car
  await page.getByTestId('type-car').click()
  await page.getByLabel('Name').fill('Daily Golf')
  await page.getByLabel('Make').fill('Volkswagen')
  await page.getByLabel('Model').fill('Golf GTI')
  await page.getByTestId('vehicle-plate-input').fill('AA-00-BB')
  await page.getByTestId('vehicle-km-input').fill('45000')

  await page.getByRole('button', { name: 'Next: maintenance items' }).click()

  // Verify car specific items are in the draft
  await expect(page.getByLabel('Cabin air filter every km')).toBeVisible()
  await expect(page.getByLabel('Timing belt & water pump every km')).toBeVisible()

  await page.getByRole('button', { name: 'Save bike' }).click()
  await expect(page).toHaveURL(/\/bikes\/[0-9a-f-]{36}$/)

  // Header should show car name and plate
  await expect(page.getByTestId('bike-name')).toContainText('Daily Golf')
  await expect(page.getByTestId('bike-plate')).toHaveText('AA-00-BB')

  // Premix chip should NOT be visible on cars
  await expect(page.getByTestId('premix-chip')).toHaveCount(0)

  // Go to Garage and check card
  await page.getByTestId('tab-garage').click()
  await expect(page).toHaveURL(/\/$/)
  const card = page.getByTestId('bike-card').filter({ has: page.getByText('Daily Golf', { exact: true }) })
  await expect(card).toBeVisible()
  await expect(card.getByTestId('plate-badge')).toHaveText('AA-00-BB')
  await expect(card).toContainText('🚗')
})

test('tabs are hidden on login', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByTestId('bottom-tabs')).toHaveCount(0)
})
