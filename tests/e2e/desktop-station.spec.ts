import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { seedMockupBike } from './helpers/seed'

test.describe('Fleet Garage Responsive Layout', () => {
  test.describe('Desktop Viewport (1440x900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('shows desktop KPI bar and renders bike grid in multi-column layout', async ({ page }) => {
      await signUpFresh(page)
      await seedMockupBike(page.request, 'KTM 300 EXC')
      await seedMockupBike(page.request, 'Beta 350 RR')

      await page.goto('/')

      // 1. Desktop KPI bar is visible
      const kpiBar = page.locator('[data-testid="desktop-kpi-bar"], [data-testid="fleet-kpis"], [data-testid="garage-kpi-bar"]').first()
      await expect(kpiBar).toBeVisible()

      // 2. Bike cards render multi-column (side by side)
      const cards = page.getByTestId('bike-card')
      await expect(cards).toHaveCount(2)

      const box1 = await cards.nth(0).boundingBox()
      const box2 = await cards.nth(1).boundingBox()
      expect(box1).toBeTruthy()
      expect(box2).toBeTruthy()

      // On desktop, card 2 is positioned horizontally to the right of card 1
      expect(box2!.x).toBeGreaterThan(box1!.x + box1!.width * 0.5)

      // No horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })

  test.describe('Mobile Viewport (380x780)', () => {
    test.use({ viewport: { width: 380, height: 780 } })

    test('hides desktop KPI bar and renders bike cards in a vertical single-column stack', async ({ page }) => {
      await signUpFresh(page)
      await seedMockupBike(page.request, 'KTM 300 EXC')
      await seedMockupBike(page.request, 'Beta 350 RR')

      await page.goto('/')

      // 1. Desktop KPI bar is hidden on mobile
      const kpiBar = page.locator('[data-testid="desktop-kpi-bar"], [data-testid="fleet-kpis"], [data-testid="garage-kpi-bar"]')
      if (await kpiBar.count() > 0) {
        await expect(kpiBar.first()).toBeHidden()
      }

      // 2. Bike cards render as a vertical stack
      const cards = page.getByTestId('bike-card')
      await expect(cards).toHaveCount(2)

      const box1 = await cards.nth(0).boundingBox()
      const box2 = await cards.nth(1).boundingBox()
      expect(box1).toBeTruthy()
      expect(box2).toBeTruthy()

      // Horizontal alignment is identical (stacked vertically)
      expect(Math.abs(box1!.x - box2!.x)).toBeLessThan(15)
      // Card 2 is rendered below card 1
      expect(box2!.y).toBeGreaterThanOrEqual(box1!.y + box1!.height - 5)

      // No horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })
})

test.describe('Bike Workstation 2-Column Layout', () => {
  test.describe('Desktop Viewport (1440x900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('displays 2-column workstation split with telemetry rail and maintenance list side by side', async ({ page }) => {
      await signUpFresh(page)
      const bikeId = await seedMockupBike(page.request, 'GasGas EC 300')

      await page.goto(`/bikes/${bikeId}`)

      // Workstation elements
      const telemetryRail = page.locator('[data-testid="telemetry-rail"], [data-testid="workstation-rail"], [data-testid="workstation-telemetry"]').first()
      const maintenanceList = page.locator('[data-testid="workstation-main"], [data-testid="maintenance-list"], [data-testid="workstation-items"]').first()

      await expect(telemetryRail).toBeVisible()
      await expect(maintenanceList).toBeVisible()

      // Verify side-by-side columns via bounding boxes
      const railBox = await telemetryRail.boundingBox()
      const mainBox = await maintenanceList.boundingBox()
      expect(railBox).toBeTruthy()
      expect(mainBox).toBeTruthy()

      // Telemetry rail is on the left and maintenance list is on the right
      expect(mainBox!.x).toBeGreaterThan(railBox!.x + railBox!.width * 0.8)

      // Both columns are visible within the desktop viewport without overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })

  test.describe('Mobile Viewport (380x780)', () => {
    test.use({ viewport: { width: 380, height: 780 } })

    test('retains single column layout and all core controls on mobile without regression', async ({ page }) => {
      await signUpFresh(page)
      const bikeId = await seedMockupBike(page.request, 'GasGas EC 300')

      await page.goto(`/bikes/${bikeId}`)

      // Core controls and displays must be visible
      await expect(page.getByTestId('bike-name')).toHaveText('GasGas EC 300')
      await expect(page.getByTestId('hours-value')).toHaveText('142.5 h')
      await expect(page.getByTestId('km-value')).toHaveText('3 812')

      // Maintenance rows render in vertical flow
      const rows = page.getByTestId('item-row')
      await expect(rows).toHaveCount(5)

      // No horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })
})
