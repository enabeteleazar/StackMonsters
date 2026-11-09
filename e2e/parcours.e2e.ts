import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const JOURNAL_API = 'e2e-results/api.log' // écrit par le serveur d'API (playwright.config.ts)
const PROPRIETAIRE = 'proprietaire-e2e@example.com'
let compteur = 0
const unique = () => `${Date.now()}${++compteur}`
const email = () => `e2e-${unique()}@example.com`

function avecCle(corps: string): string {
  const total = [...corps].reverse().reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 3 : 1), 0)
  return `${corps}${(10 - (total % 10)) % 10}`
}
const ean13 = () => avecCle(`20${unique().slice(-10).padStart(10, '0')}`)
const upcA = () => avecCle(`2${unique().slice(-10).padStart(10, '0')}`)

const codes = (adresse: string) =>
  [...readFileSync(JOURNAL_API, 'utf8').matchAll(new RegExp(`code de connexion pour ${adresse} : (\\d{6})`, 'g'))].map(
    (m) => m[1],
  )

async function connecter(page: Page, adresse: string) {
  const avant = codes(adresse).length
  await page.goto('/')
  await page.getByRole('button', { name: 'Se connecter' }).first().click()
  await page.fill('#f-email', adresse)
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await page.waitForSelector('#f-code')
  await expect.poll(() => codes(adresse).length).toBeGreaterThan(avant)
  await page.fill('#f-code', codes(adresse).at(-1)!)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(nav(page, 'Réglages')).toBeVisible()
}

const nav = (page: Page, nom: string) => page.locator('nav.nav-bas').getByRole('button', { name: nom })

async function ajouterParCode(page: Page, code: string, nom: string) {
  await page.getByLabel('Code saisi à la main').fill(code)
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.fill('#f-nom', nom)
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()
}

async function nouvellePage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

test('un code UPC-A est enregistré sur 13 chiffres et survit au rechargement', async ({ page }) => {
  const code = upcA()
  const nom = `Canette ${unique()}`
  await connecter(page, email())
  await ajouterParCode(page, code, nom)
  await page.reload()
  await nav(page, 'Collection').click()
  await page.getByText(nom).click()
  await expect(page.locator('.ean')).toHaveText(`0${code}`)
})

test('une collection reste privée, ses champs descriptifs alimentent le Wiki', async ({ page, browser }) => {
  const nom = `Partagée ${unique()}`
  await connecter(page, email())
  await ajouterParCode(page, ean13(), nom)

  const autre = await nouvellePage(browser)
  await connecter(autre, email())
  await nav(autre, 'Collection').click()
  await expect(autre.getByText(nom)).toHaveCount(0)
  await nav(autre, 'Wiki').click()
  await expect(autre.getByText(nom)).toBeVisible()
})

test('une canette sans code-barres reste hors du Wiki et se modifie', async ({ page }) => {
  const nom = `Perso ${unique()}`
  await connecter(page, email())
  await page.getByRole('button', { name: 'Ajouter sans code-barres' }).click()
  await page.waitForSelector('#f-nom')
  await expect(page.locator('#f-categorie')).toHaveCount(0)
  await page.fill('#f-nom', nom)
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()

  await nav(page, 'Wiki').click()
  await expect(page.getByText('Canettes répertoriées')).toBeVisible()
  await expect(page.getByText(nom)).toHaveCount(0)

  await nav(page, 'Collection').click()
  await page.getByText(nom).click()
  await page.getByRole('button', { name: 'Modifier la fiche' }).click()
  await page.fill('#f-nom', `${nom} modifiée`)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()
  await expect(page.getByText(`${nom} modifiée`).first()).toBeVisible()
})

test('le propriétaire ajoute puis retire la photo d’une fiche du Wiki', async ({ page }) => {
  const nom = `Photo ${unique()}`
  page.on('dialog', (d) => d.accept())
  await connecter(page, PROPRIETAIRE)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Wiki').click()
  await page.getByText(nom).click()
  await page.setInputFiles('input[aria-label="Choisir la photo de la fiche"]', 'public/icon-192.png')
  await expect(page.locator('.photo-hero img')).toBeVisible()
  await page.getByRole('button', { name: 'Retirer la photo' }).click()
  await expect(page.getByRole('button', { name: 'Ajouter une photo' })).toBeVisible()
  await expect(page.locator('.photo-hero img')).toHaveCount(0)
})

test('« Se déconnecter partout » ferme les autres appareils', async ({ page, browser }) => {
  const adresse = email()
  page.on('dialog', (d) => d.accept())
  await connecter(page, adresse)
  const autre = await nouvellePage(browser)
  await connecter(autre, adresse)

  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Se déconnecter partout' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' }).first()).toBeVisible()
  await autre.reload()
  await expect(autre.getByRole('button', { name: 'Se connecter' }).first()).toBeVisible()
})

test('la suppression du compte exige l’adresse et efface la collection', async ({ page }) => {
  const adresse = email()
  const nom = `À effacer ${unique()}`
  await connecter(page, adresse)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Réglages').click()

  page.once('dialog', (d) => d.accept('mauvaise@example.com'))
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()
  await expect(page.getByText('le compte n’a pas été supprimé')).toBeVisible()

  page.once('dialog', (d) => d.accept(adresse))
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' }).first()).toBeVisible()

  await connecter(page, adresse)
  await nav(page, 'Collection').click()
  await expect(page.getByText(nom)).toHaveCount(0)
})

test('la politique de confidentialité est accessible sans compte', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Confidentialité' }).click()
  await expect(page.getByText('NABET Eleazar')).toBeVisible()
  await page.getByRole('button', { name: 'Retour' }).click()
  await expect(page.getByRole('button', { name: 'Se connecter' }).first()).toBeVisible()
})
