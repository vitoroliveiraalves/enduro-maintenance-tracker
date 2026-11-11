import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody, seedMockupBike } from './helpers/seed'

const GARAGE = 'tests/e2e/fixtures/invoice-garage.jpg'

async function uploadInvoice(page: Page, file: string) {
  await page.goto('/invoice')
  await expect(page.getByRole('heading', { name: 'Add invoice' })).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(file)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  return new URL(page.url()).pathname.split('/').pop()!
}

test.describe('Responsive Modal & Sheet Layout', () => {
  test.describe('Desktop Viewport (1440x900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('opens sheet as a right-aligned desktop slide-over drawer', async ({ page }) => {
      await signUpFresh(page)
      const bikeId = await seedMockupBike(page.request, 'GasGas MC 250')

      await page.goto(`/bikes/${bikeId}`)
      await page.getByTestId('log-ride').click()

      const panel = page.locator('[data-testid="log-ride-sheet"], .sheet-panel, [role="dialog"]').first()
      await expect(panel).toBeVisible()

      const box = await panel.boundingBox()
      expect(box).toBeTruthy()

      // On desktop (1440x900), drawer is right-aligned against the right viewport edge
      expect(box!.x + box!.width).toBeGreaterThanOrEqual(1440 - 20)
      // Drawer height spans the majority of the desktop viewport
      expect(box!.height).toBeGreaterThanOrEqual(650)

      // Closes properly via close button
      await page.getByTestId('sheet-close').click()
      await expect(panel).toBeHidden()
    })
  })

  test.describe('Mobile Viewport (380x780)', () => {
    test.use({ viewport: { width: 380, height: 780 } })

    test('opens sheet as a bottom-aligned mobile sheet', async ({ page }) => {
      await signUpFresh(page)
      const bikeId = await seedMockupBike(page.request, 'GasGas MC 250')

      await page.goto(`/bikes/${bikeId}`)
      await page.getByTestId('log-ride').click()

      const panel = page.locator('[data-testid="log-ride-sheet"], .sheet-panel, [role="dialog"]').first()
      await expect(panel).toBeVisible()

      const box = await panel.boundingBox()
      expect(box).toBeTruthy()

      // On mobile (380x780), sheet is anchored to the bottom edge
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(780 - 20)
      // Width spans almost the entire mobile viewport
      expect(box!.width).toBeGreaterThanOrEqual(340)

      // Closes properly via close button
      await page.getByTestId('sheet-close').click()
      await expect(panel).toBeHidden()
    })
  })
})

test.describe('Invoice Studio Dual-Pane Layout', () => {
  test.describe('Desktop Viewport (1440x900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    test('renders invoice review in dual-pane studio layout (viewer left, form right)', async ({ page }) => {
      await signUpFresh(page)
      await page.request.post('/api/bikes', { data: bikeBody('Workshop Bike', []) })

      await uploadInvoice(page, GARAGE)

      const viewer = page.getByTestId('invoice-viewer')
      const form = page.getByTestId('invoice-header')

      await expect(viewer).toBeVisible({ timeout: 15_000 })
      await expect(form).toBeVisible()

      const viewerBox = await viewer.boundingBox()
      const formBox = await form.boundingBox()
      expect(viewerBox).toBeTruthy()
      expect(formBox).toBeTruthy()

      // In dual-pane desktop studio, viewer is on the left and form is on the right side-by-side
      expect(formBox!.x).toBeGreaterThan(viewerBox!.x + viewerBox!.width * 0.7)

      // Zero horizontal scroll overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })

  test.describe('Mobile Viewport (380x780)', () => {
    test.use({ viewport: { width: 380, height: 780 } })

    test('renders invoice review in vertical stacked flow without regression', async ({ page }) => {
      await signUpFresh(page)
      await page.request.post('/api/bikes', { data: bikeBody('Workshop Bike', []) })

      await uploadInvoice(page, GARAGE)

      const viewer = page.getByTestId('invoice-viewer')
      const form = page.getByTestId('invoice-header')

      await expect(viewer).toBeVisible({ timeout: 15_000 })
      await expect(form).toBeVisible()

      const viewerBox = await viewer.boundingBox()
      const formBox = await form.boundingBox()
      expect(viewerBox).toBeTruthy()
      expect(formBox).toBeTruthy()

      // Stacked vertically on phone
      expect(Math.abs(viewerBox!.x - formBox!.x)).toBeLessThan(20)
      expect(formBox!.y).toBeGreaterThanOrEqual(viewerBox!.y + viewerBox!.height - 10)

      // Zero horizontal scroll overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth
      })
      expect(hasHorizontalOverflow).toBe(false)
    })
  })
})
