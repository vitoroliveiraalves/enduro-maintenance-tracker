import { expect, test } from '@playwright/test'
import { signUpFresh } from './helpers/login'
import { bikeBody } from './helpers/seed'

test.describe('a Portuguese phone', () => {
  test.use({ locale: 'pt-PT' })

  test('opens in European Portuguese, from the sign-in screen on', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT')
    await expect(page.getByRole('button', { name: 'Iniciar sessão' })).toBeVisible()
    await expect(page.getByText('Palavra-passe')).toBeVisible()

    await signUpFresh(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Garagem' })).toBeVisible()
    await expect(page.getByTestId('tab-history')).toHaveText('Histórico')
    await expect(page.getByTestId('add-bike')).toHaveText('+ Juntar mota')

    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Definições' })).toBeVisible()
    await expect(page.getByTestId('language-auto').getByRole('radio')).toBeChecked()
    await expect(page.getByTestId('language-auto')).toContainText('Segue o telemóvel: Português (Portugal)')
  })

  test('default categories, template items, dates and hours read in Portuguese', async ({ page }) => {
    await signUpFresh(page)
    const res = await page.request.post('/api/bikes', { data: bikeBody('KTM 300', [{ name: 'Gearbox oil', everyHoursTenths: 150 }]) })
    expect(res.ok()).toBe(true)
    const { id } = await res.json()
    await page.goto(`/bikes/${id}`)
    await expect(page.getByTestId('hours-value')).toHaveText(/^\d+,\d h$/)
    await expect(page.getByTestId('log-ride')).toContainText('Registar saída')
    // A template item stored in English (a bike added in English) reads in Portuguese
    await expect(page.getByTestId('item-row').first()).toContainText('Óleo da caixa')

    await page.goto('/history')
    await page.getByTestId('add-expense').click()
    await expect(page.getByTestId('ex-category').locator('option', { hasText: 'Combustível' })).toHaveCount(1)
    await page.getByTestId('ex-amount').fill('12,50')
    await page.getByTestId('ex-save').click()
    await expect(page.getByTestId('toast')).toContainText('Custo guardado')
    await expect(page.getByTestId('history-expense')).toContainText('Combustível')

    await page.goto('/bikes/new')
    await page.getByLabel('Nome', { exact: true }).fill('Beta')
    await page.getByLabel('Marca').fill('Beta')
    await page.getByLabel('Modelo').fill('RR')
    await page.getByLabel('Horas atuais').fill('10')
    await page.getByLabel('Km atuais').fill('100')
    await page.getByRole('button', { name: 'Seguinte: itens de manutenção' }).click()
    await expect(page.getByLabel('Nome do item').first()).toHaveValue('Óleo da caixa')
  })
})

test('an English phone can switch to Portuguese in Settings; it sticks on this phone and can follow the phone again', async ({ page }) => {
  await signUpFresh(page)
  await page.goto('/settings')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('lang', 'en')
  await expect(page.getByTestId('language-auto')).toContainText('Follows the phone: English')

  await page.getByTestId('language-pt').getByRole('radio').check()
  await expect(html).toHaveAttribute('lang', 'pt-PT')
  await expect(page.getByRole('heading', { name: 'Definições' })).toBeVisible()
  await expect(page.getByTestId('tab-costs')).toHaveText('Custos')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Definições' })).toBeVisible()
  await expect(page.getByTestId('language-pt').getByRole('radio')).toBeChecked()
  await page.goto('/costs')
  await expect(page.getByTestId('seg-all')).toHaveText('Sempre')

  await page.goto('/settings')
  await page.getByTestId('language-auto').getByRole('radio').check()
  await expect(html).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('reasons the server gives (in English) show in Portuguese', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('enduro.locale', 'pt'))
  await signUpFresh(page)
  await page.request.post('/api/bikes', { data: bikeBody('KTM 300', []) })
  await page.goto('/invoice')
  await page.getByTestId('file-input').setInputFiles('tests/e2e/fixtures/invoice-mock-fail.pdf')
  await page.waitForURL(/\/invoice\/[0-9a-f-]{36}/, { timeout: 30_000 })
  await expect(page.getByTestId('manual-notice')).toContainText('Não foi possível ler esta fatura automaticamente', { timeout: 15_000 })
  await expect(page.getByTestId('manual-reason')).toHaveText('A foto parece desfocada ou cortada.')
})
