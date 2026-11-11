import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

test.describe('App-like Directional Page Motion & UI Polish', () => {
  test('directional attributes update correctly: slide-left, slide-right, slide-up, slide-down', async ({ page }) => {
    await signUpFresh(page)
    await seedMockupBike(page.request, "KTM 300 EXC '23")

    // 1. Initial load
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // 2. Tab Navigation forward: Garage -> History should set data-direction="slide-left"
    await page.getByTestId('tab-history').click()
    await page.waitForURL(/\/history/)
    const dirHistory = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirHistory).toBe('slide-left')

    // 3. Tab Navigation backward: History -> Garage should set data-direction="slide-right"
    await page.getByTestId('tab-garage').click()
    await page.waitForURL('/')
    const dirGarage = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirGarage).toBe('slide-right')

    // 4. Drill-down push: Garage -> Bike Screen should set data-direction="slide-left"
    await page.getByTestId('bike-card').first().click()
    await page.waitForURL(/\/bikes\//)
    const dirBike = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirBike).toBe('slide-left')

    // 5. Hierarchical pop back: Bike Screen -> Garage should set data-direction="slide-right"
    await page.locator('main a[href="/"]').first().click()
    await page.waitForURL('/')
    const dirPop = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirPop).toBe('slide-right')

    // 6. Modal presentation flow: Garage -> Add Vehicle (/bikes/new) should set data-direction="slide-up"
    await page.getByTestId('add-bike').click()
    await page.waitForURL('/bikes/new')
    const dirModalEnter = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirModalEnter).toBe('slide-up')

    // Verify back button on /bikes/new does not render double arrows "‹ ‹"
    const backText = await page.locator('main a[href="/"]').first().innerText()
    expect(backText).not.toContain('‹ ‹')
    expect(backText).toMatch(/‹\s*Garage|‹\s*Garagem/i)

    // 7. Modal dismiss: /bikes/new -> Garage should set data-direction="slide-down"
    await page.locator('main a[href="/"]').first().click()
    await page.waitForURL('/')
    const dirModalExit = await page.evaluate(() => document.documentElement.getAttribute('data-direction'))
    expect(dirModalExit).toBe('slide-down')
  })

  test('desktop UI polish: no duplicate buttons and floating mic is hidden on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signUpFresh(page)
    await seedMockupBike(page.request, "KTM 300 EXC '23")

    // On Desktop Garage
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Verify top desktop button is visible, but bottom duplicate button is hidden
    await expect(page.locator('[data-testid="desktop-add-bike-btn"]')).toBeVisible()
    await expect(page.locator('[data-testid="add-bike"]')).toBeHidden()

    // Verify mobile floating mic is hidden on desktop
    await expect(page.locator('[data-testid="mic"]')).toBeHidden()

    // On Desktop Shelf
    await page.goto('/shelf')
    await page.waitForLoadState('networkidle')

    // Top desktop button visible, bottom duplicate is hidden
    await expect(page.locator('[data-testid="desktop-add-part-btn"]')).toBeVisible()
    await expect(page.locator('[data-testid="add-part"]')).toBeHidden()
  })
})
