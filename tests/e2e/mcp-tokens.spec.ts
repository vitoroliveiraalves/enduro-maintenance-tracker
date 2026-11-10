import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'

test('MCP access token lifecycle: generate, display config, list, and revoke', async ({ page }) => {
  await signUpFresh(page)

  await page.goto('/settings')
  await expect(page.getByTestId('mcp-section')).toBeVisible()
  await expect(page.getByTestId('mcp-no-tokens')).toBeVisible()

  // 1. Open the key creation sheet
  await page.getByTestId('create-mcp-key-btn').click()
  await expect(page.getByTestId('mcp-sheet')).toBeVisible()

  // 2. Submit a new key name
  await page.getByTestId('mcp-token-name-input').fill('Claude Desktop Mac')
  await page.getByTestId('mcp-token-submit').click()

  // 3. Verify success step displays secret token
  await expect(page.getByTestId('mcp-token-success')).toBeVisible()
  const rawTokenEl = page.getByTestId('mcp-raw-token')
  await expect(rawTokenEl).toBeVisible()
  const token = (await rawTokenEl.textContent())?.trim() ?? ''
  expect(token.startsWith('dirt_pat_')).toBe(true)

  // Close sheet
  await page.getByTestId('mcp-token-done').click()
  await expect(page.getByTestId('mcp-sheet')).not.toBeVisible()

  // 4. Verify token appears in settings list
  const row = page.getByTestId('mcp-token-row')
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('mcp-token-name')).toHaveText('Claude Desktop Mac')

  // 5. Test token authentication via SSE endpoint (aborted immediately after headers)
  const sseRes = await page.evaluate(async (tok) => {
    const ctrl = new AbortController()
    try {
      const res = await fetch(`/api/mcp/sse?token=${tok}`, { signal: ctrl.signal })
      const contentType = res.headers.get('content-type')
      const status = res.status
      ctrl.abort()
      return { status, contentType }
    } catch {
      return { status: 0, contentType: '' }
    }
  }, token)
  expect(sseRes.status).toBe(200)
  expect(sseRes.contentType).toContain('text/event-stream')

  // 6. Revoke token
  await row.getByTestId('mcp-revoke-btn').click()
  await row.getByTestId('mcp-revoke-confirm').click()

  // 7. Verify token is gone from UI
  await expect(page.getByTestId('mcp-token-row')).toHaveCount(0)
  await expect(page.getByTestId('mcp-no-tokens')).toBeVisible()

  // 8. Verify revoked token is now rejected with 401
  const revokedRes = await page.request.get(`/api/mcp/sse?token=${token}`)
  expect(revokedRes.status()).toBe(401)
})
