import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const testEmails = new Set<string>()

function nouvelleAdresse() {
  const email = `e2e-${randomUUID()}@example.test`
  testEmails.add(email)
  return email
}

async function connecter(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect(page.getByText(`Code envoyé à ${email}. Il est valable 10 minutes.`)).toBeVisible()

  const response = await page.request.get(
    `http://127.0.0.1:18055/__e2e__/mailbox/${encodeURIComponent(email)}`,
  )
  expect(response.ok()).toBeTruthy()
  const { code } = (await response.json()) as { code: string }

  await page.getByLabel('Code').fill(code)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { name: /Ta collection/ })).toBeVisible()
}

async function deconnecter(page: Page) {
  await page.locator('nav.nav-bas').getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(page.getByRole('heading', { name: /Chaque canette/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    })
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: class {
        async detect() {
          return [{ rawValue: '0049000000016' }]
        }
      },
    })
  })
})

test.afterEach(async ({ request }) => {
  for (const email of testEmails) {
    await request.delete(
      `http://127.0.0.1:18055/__e2e__/accounts/${encodeURIComponent(email)}`,
    )
  }
  testEmails.clear()
})

test('connexion par code, ajout par scan et saisie, modification, suppression et déconnexion', async ({
  page,
}) => {
  await connecter(page, nouvelleAdresse())

  await page.getByRole('button', { name: 'Scan canette' }).click()
  await expect(page.locator('#f-nom')).toBeVisible()
  await page.locator('#f-nom').fill('Monster scan E2E')
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await expect(page.getByRole('button', { name: 'Monster scan E2E' })).toBeVisible()

  await page.getByLabel('Code saisi à la main').fill('0049000000023')
  await page.getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('#f-nom')).toBeVisible()
  await page.locator('#f-nom').fill('Monster manuel E2E')
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await page.getByRole('button', { name: 'Monster manuel E2E' }).click()

  await page.getByRole('button', { name: 'Modifier la fiche' }).click()
  await page.locator('#f-nom').fill('Monster modifié E2E')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('button', { name: 'Monster modifié E2E' }).click()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Retirer de la collection' }).click()
  await expect(page.getByText('Retirée de la collection')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Monster modifié E2E' })).toHaveCount(0)

  await deconnecter(page)
})

test('deux comptes ont des collections privées distinctes', async ({ page }) => {
  const compteA = nouvelleAdresse()
  const compteB = nouvelleAdresse()

  await connecter(page, compteA)
  await page.getByLabel('Code saisi à la main').fill('0049000000030')
  await page.getByRole('button', { name: 'OK' }).click()
  await page.locator('#f-nom').fill('Collection compte A')
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await expect(page.getByRole('button', { name: 'Collection compte A' })).toBeVisible()
  await deconnecter(page)

  await connecter(page, compteB)
  await expect(page.getByRole('button', { name: 'Collection compte A' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ta collection' })).toBeVisible()
  await deconnecter(page)

  await connecter(page, compteA)
  await expect(page.getByRole('button', { name: 'Collection compte A' })).toBeVisible()
})
