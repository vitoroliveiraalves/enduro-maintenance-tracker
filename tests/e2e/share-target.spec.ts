import { test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { signUpFresh } from './helpers/login'

// Needs the real service worker: it receives the OS share (a multipart POST) and hands the file to /invoice.
test.use({ serviceWorkers: 'allow' })

test('Share → Dirt Garage: the worker parks the file and the Invoice screen reads it', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/invoice')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
  })
  const jpg = readFileSync('tests/e2e/fixtures/invoice-garage.jpg').toString('base64')
  // What the OS does: a form POST with the shared file; the worker answers with a redirect to /invoice.
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'shared.jpg', { type: 'image/jpeg' }))
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/share-target'
    form.enctype = 'multipart/form-data'
    const input = document.createElement('input')
    input.type = 'file'
    input.name = 'files'
    input.files = dt.files
    form.append(input)
    document.body.append(form)
    form.submit()
  }, jpg)
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
})
