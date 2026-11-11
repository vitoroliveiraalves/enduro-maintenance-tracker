import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'

test.describe('Desktop Shell (1440x900 viewport)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('desktop viewport shows DesktopSidebar and hides BottomTabs', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const sidebar = page.locator('[data-testid="desktop-sidebar"]')
    const bottomTabs = page.locator('[data-testid="bottom-tabs"]')

    await expect(sidebar).toBeVisible()
    await expect(bottomTabs).toBeHidden()
  })

  test('desktop navigation links allow navigating between main sections', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const sidebar = page.locator('[data-testid="desktop-sidebar"]')
    await expect(sidebar).toBeVisible()

    // Navigate to History
    const historyLink = sidebar.locator('a[href="/history"]').first()
    await expect(historyLink).toBeVisible()
    await historyLink.click()
    await page.waitForURL(/\/history/)
    await expect(page).toHaveURL(/\/history/)

    // Navigate to Costs
    const costsLink = sidebar.locator('a[href="/costs"]').first()
    await expect(costsLink).toBeVisible()
    await costsLink.click()
    await page.waitForURL(/\/costs/)
    await expect(page).toHaveURL(/\/costs/)

    // Navigate to Invoices if available
    const invoiceLink = sidebar.locator('a[href="/invoice"]').first()
    if (await invoiceLink.count() > 0) {
      await invoiceLink.click()
      await page.waitForURL(/\/invoice/)
      await expect(page).toHaveURL(/\/invoice/)
    }

    // Navigate to MCP / AI section
    const mcpLink = sidebar.locator('[data-testid="desktop-nav-mcp"]')
    await expect(mcpLink).toBeVisible()
    await mcpLink.click()
    await page.waitForURL(/\/settings#mcp/)
    await expect(page).toHaveURL(/\/settings#mcp/)

    // Navigate back to Garage
    const garageLink = sidebar.locator('a[href="/"]').first()
    await expect(garageLink).toBeVisible()
    await garageLink.click()
    await page.waitForURL('/')
    await expect(page).toHaveURL('/')

    // AI Hub visible on desktop
    await expect(page.locator('[data-testid="desktop-ai-hub"]')).toBeVisible()
  })

  test('desktop layout has no horizontal overflow', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    expect(hasHorizontalOverflow).toBe(false)
  })
})

test.describe('Mobile Viewport (380x780 viewport)', () => {
  test.use({ viewport: { width: 380, height: 780 } })

  test('phone viewport shows BottomTabs and hides DesktopSidebar', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const sidebar = page.locator('[data-testid="desktop-sidebar"]')
    const bottomTabs = page.locator('[data-testid="bottom-tabs"]')

    await expect(bottomTabs).toBeVisible()
    await expect(sidebar).toBeHidden()
    await expect(page.locator('[data-testid="desktop-ai-hub"]')).toBeHidden()
  })

  test('mobile navigation functions properly without regression', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const bottomTabs = page.locator('[data-testid="bottom-tabs"]')
    await expect(bottomTabs).toBeVisible()

    // Test tab navigation across primary tabs
    await page.getByTestId('tab-history').click()
    await page.waitForURL(/\/history/)
    await expect(page).toHaveURL(/\/history/)

    await page.getByTestId('tab-costs').click()
    await page.waitForURL(/\/costs/)
    await expect(page).toHaveURL(/\/costs/)

    await page.getByTestId('tab-garage').click()
    await page.waitForURL('/')
    await expect(page).toHaveURL('/')
  })

  test('mobile layout has no horizontal overflow', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    expect(hasHorizontalOverflow).toBe(false)
  })
})

test.describe('Responsive Viewport Resizing', () => {
  test('dynamically toggles between DesktopSidebar and BottomTabs on resize', async ({ page }) => {
    await signUpFresh(page)
    await page.goto('/')

    // Start at desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="bottom-tabs"]')).toBeHidden()

    // Resize down to phone viewport
    await page.setViewportSize({ width: 380, height: 780 })
    await expect(page.locator('[data-testid="bottom-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeHidden()

    // Resize back to desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-testid="desktop-sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="bottom-tabs"]')).toBeHidden()
  })
})
