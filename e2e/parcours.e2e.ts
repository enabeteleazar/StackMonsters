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
const codeReel = () => avecCle(`3${unique().slice(-11).padStart(11, '0')}`) // hors préfixe interne 20
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

async function saisirCode(page: Page, code: string) {
  await nav(page, 'Accueil').click()
  await page.getByLabel('Code saisi à la main').fill(code)
  await page.getByRole('button', { name: 'OK', exact: true }).click()
}

/** Code inconnu : écran « pionnier », création rapide, puis choix de l'état. */
async function ajouterParCode(page: Page, code: string, nom: string) {
  await saisirCode(page, code)
  await page.getByRole('button', { name: 'Ajouter au Wiki' }).click()
  await page.fill('#s-nom', nom)
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await page.getByRole('button', { name: 'Pleine', exact: true }).click()
  await expect(page.getByText('Ajoutée à ta collection · Pleine')).toBeVisible()
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

test('une canette sans code-barres reçoit un code tiré de son nom et rejoint le Wiki', async ({ page }) => {
  const nom = `Perso ${unique()}`
  await connecter(page, email())
  await page.getByRole('button', { name: 'Ajouter sans code-barres' }).click()
  await page.waitForSelector('#f-nom')
  await expect(page.locator('#f-categorie')).toHaveCount(1)
  await page.fill('#f-nom', nom)
  await page.getByRole('button', { name: 'Ajouter à la collection' }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()

  await nav(page, 'Wiki').click()
  await expect(page.getByText('Canettes répertoriées')).toBeVisible()
  await expect(page.getByText(nom).first()).toBeVisible()

  await nav(page, 'Collection').click()
  await page.getByText(nom).click()
  await page.getByRole('button', { name: 'Modifier la fiche' }).click()
  // Le nom vient désormais du Wiki : il ne se modifie plus depuis la collection.
  await expect(page.locator('#f-nom')).toBeDisabled()
  await page.fill('#f-volume', '500 ml')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()
})

test('le propriétaire ajoute puis retire la photo d’une fiche du Wiki', async ({ page }) => {
  const nom = `Photo ${unique()}`
  page.on('dialog', (d) => d.accept())
  await connecter(page, PROPRIETAIRE)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Wiki').click()
  await page.getByText(nom).click()
  await expect(page.locator('.bandeau-info .ean')).toBeVisible() // le propriétaire voit les codes-barres
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

test('scan : canette inconnue, puis présente dans le Wiki, puis déjà possédée', async ({ page, browser }) => {
  const code = ean13()
  const nom = `Scannée ${unique()}`
  await connecter(page, email())
  await saisirCode(page, code)
  await expect(page.getByText('Canette inconnue')).toBeVisible()
  await page.getByRole('button', { name: 'Fermer' }).click()
  await ajouterParCode(page, code, nom)

  // Un autre compte scanne le même code : ajout immédiat, lueur de succès, choix de l'état.
  const autre = await nouvellePage(browser)
  await connecter(autre, email())
  await saisirCode(autre, code)
  await expect(autre.locator('.carte-scan.succes')).toBeVisible()
  await expect(autre.getByText(nom)).toBeVisible()
  await autre.getByRole('button', { name: 'Vide', exact: true }).click()
  await expect(autre.getByText('Ajoutée à ta collection · Vide')).toBeVisible()

  // Nouveau scan : fiche miniature et « +1 ».
  await saisirCode(autre, code)
  await expect(autre.getByText('Déjà dans ta collection')).toBeVisible()
  await autre.getByRole('button', { name: 'Ajouter un doublon / +1' }).click()
  await expect(autre.locator('.scan-quantite')).toHaveText('Quantité : 2')
  await autre.getByRole('button', { name: 'Voir la fiche' }).click()
  await expect(autre.locator('.meta-item').filter({ hasText: 'Quantité' })).toContainText('2')
})

test('scan : l’ajout automatique depuis le Wiki peut être annulé', async ({ page, browser }) => {
  const code = ean13()
  const nom = `Annulée ${unique()}`
  await connecter(page, email())
  await ajouterParCode(page, code, nom)

  const autre = await nouvellePage(browser)
  await connecter(autre, email())
  await saisirCode(autre, code)
  await autre.getByRole('button', { name: 'Annuler l’ajout' }).click()
  await expect(autre.getByText('Ajout annulé')).toBeVisible()
  await nav(autre, 'Collection').click()
  await expect(autre.getByText(nom)).toHaveCount(0)
})

test('une Nouveauté validée par le propriétaire affiche sa bannière dans le Wiki', async ({ page }) => {
  const nom = `Nouveauté ${unique()}`
  await connecter(page, PROPRIETAIRE)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Wiki').click()
  await page.getByText(nom).click()
  await expect(page.locator('.photo-hero .bandeau-nouveaute')).toHaveCount(0)

  await page.getByRole('button', { name: 'Modifier la fiche' }).click()
  await page.selectOption('#w-status', 'Nouveauté')
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.locator('.photo-hero .bandeau-nouveaute')).toHaveText('Nouveauté')

  await page.getByRole('button', { name: 'Fermer' }).click()
  const carte = page.locator('.carte-wiki').filter({ hasText: nom })
  await expect(carte.locator('.bandeau-nouveaute')).toBeVisible()
})

test('un scan donne son vrai code-barres à une fiche du Wiki qui n’en avait pas', async ({ page, browser }) => {
  const nom = `Sans code ${unique()}`
  const interne = ean13() // préfixe 20 : comme les fiches générées par convert.py
  const reel = codeReel()
  await connecter(page, email())
  await ajouterParCode(page, interne, nom)

  const autre = await nouvellePage(browser)
  autre.on('dialog', (d) => d.accept())
  await connecter(autre, email())
  await saisirCode(autre, reel)
  await autre.getByRole('button', { name: 'Ajouter au Wiki' }).click()
  await autre.fill('#s-nom', nom.slice(0, 12))
  await autre.getByRole('button', { name: 'Associer ce code-barres' }).click()
  await expect(autre.getByText('Code-barres associé')).toBeVisible()
  await autre.getByRole('button', { name: 'Pleine', exact: true }).click()

  await nav(autre, 'Wiki').click()
  await autre.getByText(nom).click()
  await expect(autre.locator('.bandeau-info .ean')).toHaveCount(0) // codes réservés au propriétaire
  await autre.getByRole('button', { name: 'Fermer' }).click()
  await saisirCode(autre, reel)
  await expect(autre.getByText('Déjà dans ta collection')).toBeVisible()
  // Le premier collectionneur a suivi : sa canette porte maintenant le vrai code.
  await nav(page, 'Collection').click()
  await page.reload()
  await nav(page, 'Collection').click()
  await page.getByText(nom).click()
  await expect(page.locator('.ean')).toHaveText(reel)
})

test('un second code-barres rejoint une fiche qui a déjà un vrai code', async ({ page, browser }) => {
  const nom = `Deux codes ${unique()}`
  const principal = codeReel()
  const second = codeReel()
  await connecter(page, email())
  await ajouterParCode(page, principal, nom)

  const autre = await nouvellePage(browser)
  autre.on('dialog', (d) => d.accept())
  await connecter(autre, email())
  await saisirCode(autre, second)
  await autre.getByRole('button', { name: 'Ajouter au Wiki' }).click()
  await autre.fill('#s-nom', `Monster ${nom} 500ml`) // la marque et le volume ne gênent pas la correspondance
  await autre.getByRole('button', { name: 'Associer ce code-barres' }).click()
  await autre.getByRole('button', { name: 'Vide', exact: true }).click()

  await nav(autre, 'Wiki').click()
  await autre.getByText(nom).click()
  await expect(autre.locator('.bandeau-info .ean')).toHaveCount(0) // codes réservés au propriétaire
  await expect(autre.locator('.autre-code')).toHaveCount(0)
  // Un nouveau scan du second code retrouve la canette déjà possédée.
  await autre.getByRole('button', { name: 'Fermer' }).click()
  await saisirCode(autre, second)
  await expect(autre.getByText('Déjà dans ta collection')).toBeVisible()
})
