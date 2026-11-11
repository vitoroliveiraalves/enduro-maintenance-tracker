import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

test.describe('Responsive Layout & Mobile Parity Audit', () => {
  test('mobile viewport (380x780) has zero horizontal overflow and uniform spacing', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 780 })
    await signUpFresh(page)

    // Seed a bike so the garage and detail views have real data
    const bikeRes = await page.request.post('/api/bikes', {
      data: bikeBody("KTM 300 EXC '23", [
        { name: 'Gearbox oil', everyHoursTenths: 150 },
        { name: 'Piston & rings', everyHoursTenths: 400 },
      ]),
    })
    const { id: bikeId } = (await bikeRes.json()) as { id: string }

    const routes = [
      '/',
      `/bikes/${bikeId}`,
      '/costs',
      '/history',
      '/shelf',
      '/invoice',
      '/settings',
    ]

    for (const path of routes) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      // 1. Verify zero horizontal overflow on mobile
      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      expect(overflow.hasOverflow, `Page ${path} has horizontal overflow! scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`).toBe(false)

      // 2. Mobile bottom tabs should be visible on non-auth screens
      await expect(page.locator('[data-testid="bottom-tabs"]')).toBeVisible()

      // 3. Desktop sidebar must NEVER be visible on mobile
      await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeHidden()
    }
  })

  test('desktop viewport (1440x900) has uniform container alignment across all screens', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signUpFresh(page)

    const bikeRes = await page.request.post('/api/bikes', {
      data: bikeBody("Husqvarna TE 300 '24", [
        { name: 'Gearbox oil', everyHoursTenths: 150 },
      ]),
    })
    const { id: bikeId } = (await bikeRes.json()) as { id: string }

    const routes = [
      '/',
      `/bikes/${bikeId}`,
      '/costs',
      '/history',
      '/shelf',
      '/invoice',
      '/settings',
    ]

    for (const path of routes) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      // 1. Desktop sidebar must be visible
      await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeVisible()

      // 2. Bottom tabs must be hidden on desktop
      await expect(page.locator('[data-testid="bottom-tabs"]')).toBeHidden()

      // 3. Main container has uniform desktop layout classes
      const main = page.locator('main')
      await expect(main).toBeVisible()
      const classAttr = await main.getAttribute('class')
      expect(classAttr).toContain('lg:max-w-7xl')
      expect(classAttr).toContain('lg:px-8')
      expect(classAttr).toContain('lg:py-8')
    }
  })
})
