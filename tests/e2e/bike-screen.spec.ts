import { expect, test } from '@playwright/test'
import { loginAs } from './helpers/login'
import { bikeBody, seedMockupBike } from './helpers/seed'

test('rows follow urgency, show driver text, bars and open the item history', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Screen Bike')
  await page.goto(`/bikes/${id}`)
  await expect(page.getByTestId('bike-name')).toHaveText('Screen Bike')
  await expect(page.getByTestId('last-ride')).toHaveText(/^Last ride: \w{3}, \d{1,2} \w{3}$/)
  await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
  await expect(page.getByTestId('km-value')).toHaveText('3 812')
  await expect(page.getByTestId('vehicle-settings-link')).toHaveAttribute('href', `/bikes/${id}/settings`)

  const rows = page.getByTestId('item-row')
  await expect(rows).toHaveCount(5)
  const names = await rows.evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent))
  expect(names).toEqual(['Engine/gear oil', 'Chain & sprockets', 'Air filter clean', 'Piston & rings', 'Wheel bearings'])
  await expect(rows.nth(0).getByTestId('item-state')).toHaveText('overdue 0.5h')
  await expect(rows.nth(0).getByTestId('item-subline')).toHaveText(/^20\.5h since last done \(every 20h\) · \d{1,2} \w{3}$/)
  await expect(rows.nth(1).getByTestId('item-state')).toHaveText(/^220.km left$/)
  await expect(rows.nth(2).getByTestId('item-state')).toHaveText('1h left')
  await expect(rows.nth(4).getByTestId('item-subline')).toHaveText(/\(every 50h or 12 months\) · \d{1,2} \w{3} · garage$/)
  await expect(rows.nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expect(rows.nth(0).getByRole('progressbar').locator('i')).toHaveClass(/bg-danger/)
  await expect(rows.nth(4).getByRole('progressbar').locator('i')).toHaveClass(/bg-ok/)
  await expect(page.getByTestId('mark-done')).toHaveCount(0)

  await rows.filter({ hasText: 'Wheel bearings' }).click()
  await expect(page).toHaveURL(new RegExp(`/bikes/${id}/items/[0-9a-f-]{36}$`))
  await expect(page.getByTestId('item-name')).toHaveText('Wheel bearings')
  const entries = page.getByTestId('service-entry')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('130.5 h')
  await expect(entries.first()).toContainText('Garage · Moto Garage Braga')
})

test('item page: interval editor accepts a comma, mark done resets the item', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Item Bike')
  await page.goto(`/bikes/${id}`)
  await page.getByTestId('item-row').filter({ hasText: 'Engine/gear oil' }).click()
  await expect(page.getByTestId('item-status').getByTestId('item-state')).toHaveText('overdue 0.5h')
  await expect(page.getByTestId('iv-hours')).toHaveValue('20')

  await page.getByTestId('iv-hours').fill('abc')
  await page.getByTestId('iv-save').click()
  await expect(page.getByTestId('iv-error')).toBeVisible()
  await page.getByTestId('iv-hours').fill('25,5')
  await page.getByTestId('iv-save').click()
  await expect(page.getByTestId('iv-saved')).toBeVisible()
  await expect(page.getByTestId('item-status').getByTestId('item-state')).toHaveText('5h left')
  await expect(page.getByTestId('iv-hours')).toHaveValue('25.5')

  await page.getByTestId('mark-done').click()
  await expect(page.getByRole('dialog', { name: 'Mark done: Engine/gear oil' })).toBeVisible()
  await page.getByTestId('md-save').click()
  await expect(page.getByTestId('service-entry')).toHaveCount(2)
  await expect(page.getByTestId('item-status').getByTestId('item-state')).toHaveText('25.5h left')
})

test('empty bike offers an inline add-item form', async ({ page }) => {
  await loginAs(page)
  const res = await page.request.post('/api/bikes', { data: bikeBody('Empty Bike', []) })
  const { id } = (await res.json()) as { id: string }
  await page.goto(`/bikes/${id}`)
  await expect(page.getByTestId('empty-items')).toContainText('No maintenance items — add one')
  await page.getByTestId('new-item-save').click()
  await expect(page.getByTestId('new-item-error')).toBeVisible()
  await page.getByTestId('new-item-name').fill('Fork oil')
  await page.getByTestId('new-item-hours').fill('30,5')
  await page.getByTestId('new-item-save').click()
  const row = page.getByTestId('item-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Fork oil')
  await expect(row.getByTestId('item-state')).toHaveText('Unknown')
  await expect(page.getByTestId('empty-items')).toHaveCount(0)

  // A bike with existing items can add more maintenance items via the add-item button
  await page.getByTestId('open-add-item-btn').click()
  await expect(page.getByTestId('inline-add-item')).toBeVisible()
  await page.getByTestId('new-item-name').fill('Spark plug')
  await page.getByTestId('new-item-hours').fill('50')
  await page.getByTestId('new-item-save').click()
  await expect(page.getByTestId('item-row')).toHaveCount(2)
  await expect(page.getByTestId('item-row').filter({ hasText: 'Spark plug' })).toBeVisible()
})

test('an item link under the wrong bike goes to the right one', async ({ page }) => {
  await loginAs(page)
  const a = await seedMockupBike(page.request, `Deep A ${Date.now()}`)
  const b = await seedMockupBike(page.request, `Deep B ${Date.now()}`)
  const detail = (await (await page.request.get(`/api/bikes/${b}`)).json()) as { items: Array<{ id: string; name: string }> }
  const chain = detail.items.find((i) => i.name === 'Chain & sprockets')!
  await page.goto(`/bikes/${a}/items/${chain.id}`)
  await expect(page).toHaveURL(new RegExp(`/bikes/${b}/items/${chain.id}$`))
  await expect(page.getByRole('heading', { name: 'Chain & sprockets' })).toBeVisible()
})

test('2T bike shows premix chip and calculates fuel oil mix', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Premix Bike')
  await page.goto(`/bikes/${id}`)
  const chip = page.getByTestId('premix-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('1:50')

  await chip.click()
  await expect(page.getByTestId('premix-sheet')).toBeVisible()
  await expect(page.getByTestId('oil-amount')).toHaveText('100')

  await page.getByTestId('ratio-40').click()
  await expect(page.getByTestId('oil-amount')).toHaveText('125')

  await page.getByTestId('jerrycan-10').click()
  await expect(page.getByTestId('oil-amount')).toHaveText('250')

  // Switch to custom % mode: 10L at 1.8% should equal 180 mL
  await page.getByTestId('mode-custom').click()
  await page.getByTestId('custom-percent-input').fill('1.8')
  await expect(page.getByTestId('oil-amount')).toHaveText('180')

  await page.getByTestId('confirm-premix-btn').click()
  await expect(page.getByTestId('premix-sheet')).not.toBeVisible()
  await expect(chip).toContainText('1:56')
})

test('add license plate and quick IUC reminder directly on a motorcycle screen', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Plated KTM')
  await page.goto(`/bikes/${id}`)

  // Add license plate and notes to the motorcycle in vehicle settings
  await page.getByTestId('vehicle-settings-link').click()
  await expect(page).toHaveURL(`/bikes/${id}/settings`)
  await page.getByTestId('bike-plate-input').fill('99-ZZ-11')
  await page.getByTestId('bike-notes-input').fill('Motul 300V, 14T front sprocket')
  await page.getByTestId('bike-settings-save').click()
  await page.getByTestId('back-to-bike').click()
  await expect(page.getByTestId('bike-plate')).toHaveText('99-ZZ-11')
  await expect(page.getByTestId('bike-notes-card')).toContainText('Motul 300V')

  // Quick-add an IUC reminder due in 10 days from the vehicle page
  const d = new Date()
  d.setDate(d.getDate() + 10)
  const due = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  await page.getByTestId('add-reminder-chip').click()
  await expect(page.getByTestId('reminder-sheet')).toBeVisible()
  await page.getByTestId('preset-IUC').click()
  await page.getByTestId('rem-date').fill(due)
  await page.getByTestId('rem-save').click()

  await expect(page.getByTestId('reminder-chip').filter({ hasText: 'IUC · in 10 days' })).toBeVisible()
})

test('specs and torques: quick chip and specs sheet with search and card preview', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Specs Bike')
  await page.goto(`/bikes/${id}`)

  // 1. Initial state: specs chip visible
  const chip = page.getByTestId('specs-chip')
  await expect(chip).toBeVisible()
  await chip.click()

  // 2. Empty state in sheet with target items
  await expect(page.getByTestId('specs-sheet')).toBeVisible()
  await expect(page.getByTestId('specs-empty')).toBeVisible()
  await page.getByTestId('item-spec-target').filter({ hasText: 'Engine/gear oil' }).click()

  // 3. Navigated to item page -> Add a note with specs
  await expect(page).toHaveURL(new RegExp(`/bikes/${id}/items/[0-9a-f-]{36}$`))
  await page.getByTestId('note-add').click()
  await page.getByTestId('note-sheet').getByRole('button', { name: 'Torque specs' }).click()
  const specRows = page.getByTestId('note-spec-row')
  await specRows.nth(0).locator('input').nth(0).fill('Drain plug')
  await specRows.nth(0).locator('input').nth(1).fill('20 Nm')
  await page.getByTestId('note-save').click()
  await expect(page.getByTestId('note-sheet')).toHaveCount(0)

  // 4. Return to bike page
  await page.goto(`/bikes/${id}`)
  await expect(page.getByTestId('specs-chip')).toContainText('(1)')

  // 5. Open sheet via Specs & Torques chip
  await page.getByTestId('specs-chip').click()
  await expect(page.getByTestId('specs-sheet')).toBeVisible()
  await expect(page.getByTestId('spec-label')).toHaveText('Drain plug')
  await expect(page.getByTestId('spec-value')).toHaveText('20 Nm')

  // 7. Search filter in sheet
  await page.getByTestId('specs-search-input').fill('axle')
  await expect(page.getByTestId('specs-empty-search')).toBeVisible()
  await page.getByTestId('specs-search-input').fill('drain')
  await expect(page.getByTestId('spec-label')).toHaveText('Drain plug')
})

test('pre-ride inspection: optional setting, alert icon after ride, and quick verification sheet', async ({ page }) => {
  await loginAs(page)
  const id = await seedMockupBike(page.request, 'Inspection Bike')
  await page.goto(`/bikes/${id}`)

  // 1. By default, pre-ride check is disabled: no icon visible on the vehicle page
  await expect(page.getByTestId('preride-due-icon')).toHaveCount(0)

  // 2. Go to Vehicle Settings and enable Pre-Ride Inspection
  await page.getByTestId('vehicle-settings-link').click()
  await expect(page).toHaveURL(`/bikes/${id}/settings`)
  const section = page.getByTestId('checklist-settings-section')
  await expect(section).toBeVisible()

  const toggle = page.getByTestId('checklist-toggle')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // 3. Customize checklist for this vehicle: add a custom check
  await page.getByTestId('customize-checklist-btn').click()
  await expect(page.getByTestId('checklist-custom-sheet')).toBeVisible()
  await expect(page.getByTestId('active-checks-count')).toContainText('6')

  await page.getByTestId('new-check-title-input').fill('Bleed fork air')
  await page.getByTestId('add-check-submit').click()
  await expect(page.getByTestId('active-checks-count')).toContainText('7')

  await page.getByTestId('save-custom-checklist-btn').click()
  await expect(page.getByTestId('checklist-custom-sheet')).toHaveCount(0)

  // 4. Return to bike page: since a ride already exists from seeding, icon is now visible!
  await page.goto(`/bikes/${id}`)
  const dueIcon = page.getByTestId('preride-due-icon')
  await expect(dueIcon).toBeVisible()

  // 5. Tap the due icon to open Pre-Ride sheet: now has 7 items
  await dueIcon.click()
  await expect(page.getByTestId('preride-sheet')).toBeVisible()
  await expect(page.getByTestId('checklist-progress')).toContainText('0 of 7')

  // 6. Toggle a check item
  await page.getByTestId('check-item-tires').click()
  await expect(page.getByTestId('checklist-progress')).toContainText('1 of 7')

  // 7. Complete checklist
  await page.getByTestId('checklist-done-btn').click()
  await expect(page.getByTestId('preride-sheet')).toHaveCount(0)

  // 8. Due icon is cleared immediately
  await expect(page.getByTestId('preride-due-icon')).toHaveCount(0)
})
