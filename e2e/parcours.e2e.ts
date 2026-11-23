import { devices, expect, test, type Browser, type Page } from '@playwright/test'
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
  await page.getByRole('button', { name: 'Entrez' }).click()
  await page.fill('#f-email', adresse)
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await page.waitForSelector('#f-code')
  await expect.poll(() => codes(adresse).length).toBeGreaterThan(avant)
  await page.fill('#f-code', codes(adresse).at(-1)!)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(nav(page, 'Réglages')).toBeVisible()
  // Invitation à installer l'appli (première connexion sur cet appareil) : refermée pour la suite du parcours.
  const invitation = page.getByRole('dialog', { name: /Installe StackMonsters/ })
  if (await invitation.isVisible()) await invitation.getByRole('button', { name: /Compris|Plus tard/ }).click()
}

const nav = (page: Page, nom: string) => page.locator('nav.nav-bas').getByRole('button', { name: nom })

async function saisirCode(page: Page, code: string) {
  await nav(page, 'Accueil').click()
  await page.getByRole('button', { name: 'Scan canette' }).click()
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
  await expect(page.locator('.wiki-tete .collec-compte')).toContainText('canettes')
  await expect(page.getByText(nom).first()).toBeVisible()

  await nav(page, 'Collection').click()
  await page.getByText(nom).click()
  await page.getByRole('button', { name: 'Modifier la fiche' }).click()
  // Le nom vient désormais du Wiki : il ne se modifie plus depuis la collection.
  await expect(page.locator('#f-nom')).toBeDisabled()
  await page.selectOption('#f-volume', '500') // volume pris dans la liste des formats (en ml)
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(page.getByText('Fiche enregistrée')).toBeVisible()
  await page.getByRole('button', { name: nom }).click()
  await expect(page.locator('.fiche-infos div', { hasText: 'Volume' })).toContainText('500 ml')
  await expect(page.locator('.verdict.fiche-wiki .fiche-saveur')).toBeVisible() // même design que le Wiki
})

test('le propriétaire ajoute puis retire la photo d’une fiche du Wiki', async ({ page }) => {
  const nom = `Photo ${unique()}`
  page.on('dialog', (d) => d.accept())
  await connecter(page, PROPRIETAIRE)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Wiki').click()
  await page.getByText(nom).click()
  await expect(page.locator('.bandeau-info .ean')).toBeVisible() // le propriétaire voit les codes-barres
  // Fiche du Wiki : la saveur seule, puis un bloc unique pour les autres informations ; photo étirable.
  await expect(page.locator('.fiche-wiki .fiche-saveur')).toBeVisible()
  await expect(page.locator('.fiche-wiki .fiche-infos dt')).toHaveText(['Catégorie', 'Pays', 'Volume', 'Variante', 'Status'])
  await expect(page.locator('.fiche-wiki .photo-etirable')).toBeVisible()
  await page.setInputFiles('input[aria-label="Choisir la photo de la fiche"]', 'public/icon-192.png')
  await expect(page.locator('.photo-hero img')).toBeVisible()
  await page.getByRole('button', { name: 'Retirer la photo' }).click()
  await expect(page.getByRole('button', { name: 'Ajouter une photo' })).toBeVisible()
  await expect(page.locator('.photo-hero img')).toHaveCount(0)
})

test('une fiche encore dans une collection se masque du Wiki au lieu d’être supprimée', async ({ page, browser }) => {
  const nom = `Masquee ${unique()}`
  const membre = await nouvellePage(browser)
  await connecter(membre, email())
  await ajouterParCode(membre, ean13(), nom)
  await nav(membre, 'Wiki').click()
  await membre.getByRole('button', { name: 'Filtres' }).click()
  await expect(membre.getByRole('radio', { name: 'Toutes' }).first()).toBeVisible()
  await expect(membre.getByRole('radio', { name: 'Sans catégorie' })).toHaveCount(0) // filtre du propriétaire
  await membre.keyboard.press('Escape')
  // « Proposer une canette » : bouton rond flottant.
  await membre.getByRole('button', { name: 'Proposer une canette' }).click()
  await expect(membre.locator('#p-nom')).toBeVisible()
  await membre.getByRole('button', { name: 'Fermer' }).first().click()

  page.on('dialog', (d) => d.accept())
  await connecter(page, PROPRIETAIRE)
  await nav(page, 'Wiki').click()
  // Filtres dans un panneau : « Sans catégorie » devient une pastille retirable sous la recherche.
  await page.getByRole('button', { name: 'Filtres' }).click()
  await page.getByRole('radio', { name: 'Sans catégorie' }).click()
  await page.getByRole('button', { name: /^Voir/ }).click()
  await page.getByRole('button', { name: 'Retirer le filtre Sans catégorie' }).click()
  await expect(page.getByRole('button', { name: 'Filtres' })).toBeVisible()
  await page.getByLabel('Chercher dans le Wiki').fill(nom)
  await page.getByText(nom).click()
  await page.getByRole('button', { name: 'Supprimer la fiche du Wiki' }).click()
  await expect(page.getByText('Suppression impossible')).toBeVisible()
  await page.getByRole('button', { name: 'Masquer du Wiki' }).click()
  await expect(page.getByText('Fiche refusée ou masquée')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Masquer du Wiki' })).toHaveCount(0)

  await membre.reload()
  await nav(membre, 'Wiki').click()
  await membre.getByLabel('Chercher dans le Wiki').fill(nom)
  await expect(membre.locator('.wiki-grille').getByText(nom)).toHaveCount(0)
  await nav(membre, 'Collection').click()
  await expect(membre.getByText(nom)).toBeVisible() // gardée dans sa collection
})

test('vider sa collection : réservé au propriétaire, garde le compte et le Wiki', async ({ page, browser }) => {
  const membre = await nouvellePage(browser)
  await connecter(membre, email())
  await nav(membre, 'Réglages').click()
  await expect(membre.getByRole('switch', { name: /Partage des doublons/ })).toBeVisible()
  await expect(membre.getByRole('button', { name: /Vider ma collection|Collection déjà vide/ })).toHaveCount(0)

  const nom = `A vider ${unique()}`
  await connecter(page, PROPRIETAIRE)
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Vider ma collection' }).click()
  await expect(page.getByText(/(La canette|Les \d+ canettes) de ta collection (sera|seront) retirée/)).toBeVisible()
  await page.getByRole('button', { name: 'Annuler' }).click()
  await nav(page, 'Collection').click()
  await expect(page.getByText(nom)).toBeVisible() // annulé : rien n'a bougé

  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Vider ma collection' }).click()
  await page.getByRole('button', { name: 'Vider', exact: true }).click()
  await expect(page.getByText('Collection vidée')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collection déjà vide' })).toBeDisabled()
  await nav(page, 'Collection').click()
  await expect(page.getByText(nom)).toHaveCount(0)
  await nav(page, 'Wiki').click()
  await page.getByLabel('Chercher dans le Wiki').fill(nom)
  await expect(page.locator('.wiki-grille').getByText(nom)).toBeVisible() // la fiche du Wiki reste
})

test('le bouton « Supprimer mon compte » est masqué', async ({ page }) => {
  await connecter(page, email())
  await nav(page, 'Réglages').click()
  await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Supprimer mon compte' })).toHaveCount(0)
})

test('déconnexion : cet appareil seulement', async ({ page, browser }) => {
  const adresse = email()
  const autre = await nouvellePage(browser)
  await connecter(page, adresse)
  await connecter(autre, adresse)

  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Entrez' })).toBeVisible()
  await autre.reload()
  await expect(nav(autre, 'Réglages')).toBeVisible() // les autres appareils restent connectés
})

test('réglages : le partage des doublons se coupe et se rallume', async ({ page }) => {
  const nom = `Partage ${unique()}`
  await connecter(page, email())
  await ajouterParCode(page, ean13(), nom)
  await nav(page, 'Réglages').click()
  await expect(page.getByRole('button', { name: 'Déconnecter tous les appareils' })).toHaveCount(0)
  const bascule = page.getByRole('switch', { name: /Partage des doublons/ })
  await expect(bascule).toHaveAttribute('aria-checked', 'true')
  await bascule.click()
  await expect(bascule).toHaveAttribute('aria-checked', 'false')
  // Partage coupé : le bloc Échanges disparaît des fiches du Wiki.
  await nav(page, 'Wiki').click()
  await page.getByLabel('Chercher dans le Wiki').fill(nom)
  await page.locator('.wiki-grille').getByText(nom).click()
  await expect(page.locator('.fiche-wiki')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Échanges' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Fermer' }).first().click()
  await page.reload()
  await nav(page, 'Réglages').click()
  await expect(page.getByRole('switch', { name: /Partage des doublons/ })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('switch', { name: /Partage des doublons/ }).click()
  await expect(page.getByRole('switch', { name: /Partage des doublons/ })).toHaveAttribute('aria-checked', 'true')
})

test('l’invitation à installer l’appli s’affiche une seule fois, après la première connexion', async ({ page, browser }) => {
  const adresse = email()
  const avant = codes(adresse).length
  await page.goto('/')
  await page.getByRole('button', { name: 'Entrez' }).click()
  await page.fill('#f-email', adresse)
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect.poll(() => codes(adresse).length).toBeGreaterThan(avant)
  await page.fill('#f-code', codes(adresse).at(-1)!)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  const invitation = page.getByRole('dialog', { name: /Installe StackMonsters/ })
  await expect(invitation).toBeVisible()
  await expect(invitation.getByText('Installer l’application')).toBeVisible() // Android : menu du navigateur
  await invitation.getByRole('button', { name: 'Compris' }).click()
  await expect(invitation).toHaveCount(0)

  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click()
  await connecter(page, adresse) // même appareil : plus d'invitation
  await expect(invitation).toHaveCount(0)

  // iPhone : les gestes de Safari (Partager → Sur l'écran d'accueil).
  const iphone = await (await browser.newContext({ ...devices['iPhone 13'], baseURL: test.info().project.use.baseURL })).newPage()
  const avantIphone = codes(adresse).length
  await iphone.goto('/')
  await iphone.getByRole('button', { name: 'Entrez' }).click()
  await iphone.fill('#f-email', adresse)
  await iphone.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect.poll(() => codes(adresse).length).toBeGreaterThan(avantIphone)
  await iphone.fill('#f-code', codes(adresse).at(-1)!)
  await iphone.getByRole('button', { name: 'Se connecter' }).click()
  const surIphone = iphone.getByRole('dialog', { name: /Installe StackMonsters/ })
  await expect(surIphone.getByText('Sur l’écran d’accueil')).toBeVisible()
})

test('échanges : les doubles d’un membre sont partagés d’office, un autre cherche la canette', async ({ page, browser }) => {
  const nom = `Echange ${unique()}`
  const code = ean13()
  await connecter(page, email())
  await ajouterParCode(page, code, nom)
  await saisirCode(page, code) // déjà possédée : doublon ajouté d'office, 2 exemplaires
  await expect(page.getByText(`Doublon ajouté · ${nom} × 2`)).toBeVisible()
  await nav(page, 'Collection').click()
  await page.getByRole('button', { name: nom }).click()
  // Aucun bouton par canette : le double est partagé d'office (Réglages, activé par défaut).
  await expect(page.getByText('1 double partagé (sans ton nom)')).toBeVisible()
  await expect(page.getByRole('button', { name: /Proposer mes doubles/ })).toHaveCount(0)

  const autre = await nouvellePage(browser)
  await connecter(autre, email())
  await nav(autre, 'Wiki').click()
  await autre.getByLabel('Chercher dans le Wiki').fill(nom)
  await autre.locator('.wiki-grille').getByText(nom).click()
  // Bloc Échanges de la fiche du Wiki : uniquement « Je la cherche », aucun compteur.
  const blocEchanges = autre.getByRole('region', { name: 'Échanges' })
  await expect(blocEchanges.getByRole('button')).toHaveText(['Je la cherche'])
  await expect(blocEchanges.getByText(/collectionneur|Personne/)).toHaveCount(0)
  await expect(autre.locator('.fiche-wiki').getByText('Possédée', { exact: true })).toHaveCount(0) // l'autre membre ne l'a pas
  await autre.getByRole('button', { name: 'Je la cherche' }).click()
  await expect(blocEchanges.getByRole('button')).toHaveText(['Je ne la cherche plus'])
  await autre.getByRole('button', { name: 'Fermer' }).first().click()
  await autre.getByLabel('Chercher dans le Wiki').fill('')
  // « Je cherche » est dans le panneau Filtres, puis devient une pastille sous la recherche.
  await autre.getByRole('button', { name: 'Filtres' }).click()
  await autre.getByRole('button', { name: /Je cherche · 1/ }).click()
  await autre.getByRole('button', { name: /^Voir/ }).click()
  await expect(autre.getByRole('button', { name: 'Retirer le filtre Je cherche' })).toBeVisible()
  await expect(autre.locator('.wiki-grille').getByText(nom)).toBeVisible()


  // Le premier membre la possède : la fiche du Wiki porte le badge « Possédée ».
  await page.getByRole('button', { name: 'Fermer' }).first().click()
  await nav(page, 'Wiki').click()
  await page.getByLabel('Chercher dans le Wiki').fill(nom)
  await page.locator('.wiki-grille').getByText(nom).click()
  await expect(page.locator('.fiche-wiki').getByText('Possédée', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Échanges' })).toHaveCount(0) // déjà possédée : rien à chercher
  await page.getByRole('button', { name: 'Fermer' }).first().click()

  await page.reload() // le premier membre voit qu'on la cherche, sans savoir qui
  await nav(page, 'Collection').click()
  await page.getByRole('button', { name: nom }).click()
  await expect(page.getByText('1 collectionneur la cherche')).toBeVisible()

  // La page Collection a un onglet « Recherchées » ; décocher depuis la fiche la retire de la liste.
  await nav(autre, 'Collection').click()
  await autre.getByRole('tab', { name: /Recherchées · 1/ }).click()
  await autre.getByRole('button', { name: nom }).click()
  await autre.getByRole('button', { name: 'Je ne la cherche plus' }).click()
  await autre.getByRole('button', { name: 'Fermer' }).first().click()
  await expect(autre.getByRole('tab', { name: /Recherchées · 0/ })).toBeVisible()
  await expect(autre.getByText('Aucune canette recherchée.', { exact: false })).toBeVisible()
})

test('la politique de confidentialité est accessible sans compte', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Confidentialité' }).click()
  // Le nom figure deux fois (responsable du traitement, mentions légales) : on vérifie le premier.
  await expect(page.getByText('NABET Eleazar').first()).toBeVisible()
  await page.getByRole('button', { name: 'Retour' }).click()
  await expect(page.getByRole('button', { name: 'Entrez' })).toBeVisible()
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

  // Nouveau scan : le doublon s'ajoute tout seul, une notification le dit.
  await saisirCode(autre, code)
  await expect(autre.getByText(`Doublon ajouté · ${nom} × 2`)).toBeVisible()
  await expect(autre.getByRole('dialog', { name: 'Résultat du scan' })).toHaveCount(0)
  await nav(autre, 'Collection').click()
  await autre.getByRole('button', { name: nom }).click()
  await expect(autre.locator('.fiche-infos div').filter({ hasText: 'Quantité' })).toContainText('2')
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
  await expect(autre.getByText(/^Doublon ajouté · .* × 2$/)).toBeVisible()
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
  await expect(autre.getByText(/^Doublon ajouté · .* × 2$/)).toBeVisible()
})

test('collection : recherche, panneau Filtres et pastilles, comme le Wiki', async ({ page }) => {
  const u = unique()
  await connecter(page, email())
  await ajouterParCode(page, ean13(), `Alpha ${u}`)
  await ajouterParCode(page, ean13(), `Beta ${u}`)
  await nav(page, 'Collection').click()
  await expect(page.getByRole('tab', { name: 'Possédées · 2' })).toBeVisible()

  await page.getByLabel('Chercher un nom').fill(`beta ${u}`)
  await expect(page.getByText('1 résultat')).toBeVisible()
  await expect(page.getByRole('button', { name: `Alpha ${u}` })).toHaveCount(0)
  await page.getByLabel('Chercher un nom').fill('')

  await page.getByRole('button', { name: 'Filtres' }).click()
  await expect(page.getByRole('dialog').getByText('Échanges')).toHaveCount(0) // propre au Wiki
  await page.getByRole('dialog').getByRole('radio', { name: 'A → Z' }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'Ultra' }).click()
  await page.getByRole('button', { name: /^Voir 0 résultat/ }).click()
  await expect(page.getByText('Aucune canette ne correspond à ces critères.')).toBeVisible()
  await page.getByRole('button', { name: 'Retirer le filtre Ultra' }).click()
  await expect(page.getByRole('button', { name: 'Retirer le filtre A → Z' })).toBeVisible()
  const noms = await page.locator('.collec-nom').allTextContents()
  expect(noms).toEqual([`Alpha ${u}`, `Beta ${u}`])
})

test('échanges : mise en relation, double accord, puis messagerie', async ({ page, browser }) => {
  const nom = `Rencontre ${unique()}`
  const code = ean13()
  await connecter(page, email()) // possesseur
  await ajouterParCode(page, code, nom)
  await saisirCode(page, code) // 2 exemplaires
  await expect(page.getByText(`Doublon ajouté · ${nom} × 2`)).toBeVisible()

  const autre = await nouvellePage(browser) // chercheur
  await connecter(autre, email())
  await nav(autre, 'Wiki').click()
  await autre.getByLabel('Chercher dans le Wiki').fill(nom)
  await autre.locator('.wiki-grille').getByText(nom).click()
  await autre.getByRole('button', { name: 'Je la cherche' }).click()
  await expect(autre.getByRole('button', { name: 'Je ne la cherche plus' })).toBeVisible()
  await autre.getByRole('button', { name: 'Fermer' }).first().click()
  await nav(autre, 'Collection').click()
  await expect(autre.getByRole('tab', { name: /Recherchées · 1/ })).toBeVisible() // elle rejoint « Recherchées »

  // Le chercheur est prévenu qu'un collectionneur l'a en double : popup dans l'appli, une seule fois.
  await autre.reload()
  const popupChercheur = autre.getByRole('dialog', { name: 'Échanges' })
  await expect(popupChercheur).toContainText(`Un collectionneur a ${nom} en double.`)
  await popupChercheur.getByRole('button', { name: 'OK' }).click()
  await autre.reload()
  await expect(nav(autre, 'Accueil')).toBeVisible()
  await expect(autre.getByRole('dialog', { name: 'Échanges' })).toHaveCount(0)
  await autre.getByRole('button', { name: /^Échanges/ }).click()
  await expect(autre.getByText(`Un collectionneur a ${nom} en double.`)).toBeVisible()
  await autre.getByRole('button', { name: 'Échange', exact: true }).click()
  await expect(autre.getByText(`Demande envoyée pour ${nom}. En attente de sa réponse.`)).toBeVisible()

  // Le possesseur reçoit la demande (pastille), et accepte : la messagerie s'ouvre.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Échanges, 1 nouveau' })).toBeVisible()
  // La nouvelle notification s'ouvre en popup dans l'appli ; « Voir » mène à l'onglet Notifications.
  const popup = page.getByRole('dialog', { name: 'Échanges' })
  await expect(popup).toContainText(`Un collectionneur est intéressé par ton double de ${nom}.`)
  await popup.getByRole('button', { name: 'Voir' }).click()
  await expect(page.getByText(`Un collectionneur est intéressé par ton double de ${nom}.`)).toBeVisible()
  await page.getByRole('button', { name: 'Échange', exact: true }).click()
  await expect(page.getByRole('dialog', { name: `Conversation : ${nom}` })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Échanges' })).toHaveCount(0)
  await page.getByLabel('Ton message').fill('Salut ! Je te l’échange contre une Ultra ?')
  await page.getByRole('button', { name: 'Envoyer' }).click()
  await expect(page.locator('.bulle.moi')).toContainText('Salut ! Je te l’échange contre une Ultra ?')

  // Le chercheur retrouve la conversation dans la Messagerie, sans adresse ni nom.
  await autre.reload()
  await autre.getByRole('button', { name: /^Échanges/ }).click()
  await autre.getByRole('tab', { name: /Messagerie · 1/ }).click()
  await autre.getByRole('button', { name: new RegExp(nom) }).click()
  await expect(autre.locator('.bulle:not(.moi)')).toContainText('Je te l’échange contre une Ultra ?')
  await autre.getByLabel('Ton message').fill('Ça marche !')
  await autre.keyboard.press('Enter')
  await expect(page.locator('.bulle:not(.moi)')).toContainText('Ça marche !', { timeout: 10_000 }) // relu en direct

  // Valider l'échange : le possesseur valide, puis le chercheur ; -1 chez l'un, +1 chez l'autre.
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Valider l’échange' }).click()
  await expect(page.getByRole('button', { name: 'Validé, en attente de l’autre' })).toBeDisabled()
  await expect(autre.getByText('L’autre a validé l’échange : valide à ton tour', { exact: false })).toBeVisible({ timeout: 10_000 })
  autre.once('dialog', (d) => d.accept())
  await autre.getByRole('button', { name: 'Valider l’échange' }).click()
  await expect(autre.getByText('Échange validé : collections mises à jour.')).toBeVisible()
  await autre.getByRole('button', { name: 'Retour aux échanges' }).click()
  await nav(autre, 'Collection').click()
  await expect(autre.getByRole('button', { name: nom })).toBeVisible() // +1 : elle est dans sa collection
  await expect(autre.getByRole('tab', { name: /Recherchées · 0/ })).toBeVisible()
  await page.getByRole('button', { name: 'Retour aux échanges' }).click()
  await nav(page, 'Collection').click()
  await page.getByRole('button', { name: nom }).click()
  await expect(page.locator('.fiche-infos div').filter({ hasText: 'Quantité' })).toContainText('1') // -1
})

test('échanges : signaler un membre ferme la conversation, le propriétaire l’examine', async ({ page, browser }) => {
  const nom = `Signal ${unique()}`
  const code = ean13()
  await connecter(page, email())
  await ajouterParCode(page, code, nom)
  await saisirCode(page, code)
  await expect(page.getByText(`Doublon ajouté · ${nom} × 2`)).toBeVisible()

  const autre = await nouvellePage(browser)
  await connecter(autre, email())
  await nav(autre, 'Wiki').click()
  await autre.getByLabel('Chercher dans le Wiki').fill(nom)
  await autre.locator('.wiki-grille').getByText(nom).click()
  await autre.getByRole('button', { name: 'Je la cherche' }).click()
  await expect(autre.getByRole('button', { name: 'Je ne la cherche plus' })).toBeVisible()
  await autre.getByRole('button', { name: 'Fermer' }).first().click()
  await autre.getByRole('button', { name: /^Échanges/ }).click()
  await autre.getByRole('button', { name: 'Échange', exact: true }).click()
  await page.reload()
  await page.getByRole('dialog', { name: 'Échanges' }).getByRole('button', { name: 'Voir' }).click()
  await page.getByRole('button', { name: 'Échange', exact: true }).click()
  await page.getByLabel('Ton message').fill('Je te la vends 20 €')
  await page.getByRole('button', { name: 'Envoyer' }).click()

  await autre.reload()
  await autre.getByRole('button', { name: /^Échanges/ }).click()
  await autre.getByRole('tab', { name: /Messagerie/ }).click()
  await autre.getByRole('button', { name: new RegExp(nom) }).click()
  await autre.getByRole('button', { name: 'Signaler' }).click()
  await autre.getByLabel('Arnaque ou tentative de vente').check()
  await autre.getByLabel('Précisions').fill('veut vendre')
  await autre.getByRole('button', { name: 'Envoyer le signalement' }).click()
  await expect(autre.getByText('Conversation fermée après un signalement.')).toBeVisible()
  await expect(autre.getByLabel('Ton message')).toHaveCount(0)
  await expect(page.getByText('Conversation fermée après un signalement.')).toBeVisible({ timeout: 10_000 })

  // Le propriétaire voit le signalement et la conversation, puis le marque traité.
  const proprio = await nouvellePage(browser)
  await connecter(proprio, PROPRIETAIRE)
  await nav(proprio, 'Réglages').click()
  await proprio.getByRole('button', { name: 'Administration' }).click()
  await proprio.getByRole('tab', { name: 'Membres' }).click()
  const carte = proprio.locator('.signalement-membre').filter({ hasText: nom })
  await expect(carte).toContainText('Arnaque ou tentative de vente')
  await expect(carte).toContainText('« veut vendre »')
  await expect(carte.locator('.bulle')).toContainText('Je te la vends 20 €')
  await carte.getByRole('button', { name: 'Marquer comme traité' }).click()
  await expect(carte).toHaveCount(0)
})

test('administration : bloquer un compte, puis message à tous en popup', async ({ page, browser }) => {
  const membre = email()
  const autre = await nouvellePage(browser)
  await connecter(autre, membre)

  // Un compte ordinaire n'a pas le bouton Administration.
  await nav(autre, 'Réglages').click()
  await expect(autre.getByRole('button', { name: 'Administration' })).toHaveCount(0)

  await connecter(page, PROPRIETAIRE)
  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Administration' }).click()
  await page.getByLabel('Chercher une adresse').fill(membre)
  const carte = page.locator('.admin-compte').filter({ hasText: membre })
  page.once('dialog', (d) => d.accept())
  await carte.getByRole('button', { name: 'Bloquer' }).click()
  await expect(carte.getByText('Bloqué', { exact: true })).toBeVisible()
  await autre.reload()
  await expect(autre.getByRole('button', { name: 'Entrez' })).toBeVisible() // déconnecté
  page.once('dialog', (d) => d.accept())
  await carte.getByRole('button', { name: 'Débloquer' }).click()
  await expect(carte.getByText('Bloqué', { exact: true })).toHaveCount(0)

  // Fiches signalées et proposées : listées dans l'onglet Fiches.
  await page.getByRole('tab', { name: 'Fiches' }).click()
  await expect(page.getByRole('heading', { name: /Fiches signalées/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Fiches proposées, à vérifier/ })).toBeVisible()

  // Message à tous : popup une seule fois à l'ouverture de l'appli (pas pour l'auteur).
  const texte = `Nouvelle saison ${unique()} !`
  await page.getByRole('tab', { name: 'Message' }).click()
  await page.getByLabel('Message à tous les membres').fill(texte)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Envoyer à tous' }).click()
  await expect(page.locator('.admin-annonce-texte').first()).toHaveText(texte)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Message de StackMonsters' })).toHaveCount(0)

  await connecter(autre, membre)
  const popup = autre.getByRole('dialog', { name: 'Message de StackMonsters' })
  await expect(popup).toContainText(texte)
  await popup.getByRole('button', { name: 'OK' }).click()
  await expect(popup).toHaveCount(0)
  await autre.reload()
  await expect(nav(autre, 'Réglages')).toBeVisible()
  await expect(autre.getByRole('dialog', { name: 'Message de StackMonsters' })).toHaveCount(0) // une seule fois
  // Il reste dans l'onglet Notifications de la page Échanges.
  await autre.getByRole('button', { name: /^Échanges/ }).click()
  await expect(autre.locator('.annonce-notif')).toContainText(texte)
})

test('message à tous : la popup s’affiche aussi à la réception, appli déjà ouverte', async ({ page, browser }) => {
  const autre = await nouvellePage(browser)
  await connecter(autre, email()) // appli ouverte, aucun message
  await expect(autre.getByRole('dialog', { name: 'Message de StackMonsters' })).toHaveCount(0)

  const texte = `En direct ${unique()}`
  await connecter(page, PROPRIETAIRE)
  await nav(page, 'Réglages').click()
  await page.getByRole('button', { name: 'Administration' }).click()
  await page.getByRole('tab', { name: 'Message' }).click()
  await page.getByLabel('Titre du message').fill('Info du jour')
  await page.getByLabel('Message à tous les membres').fill(texte)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Envoyer à tous' }).click()
  await expect(page.locator('.admin-annonce-texte').first()).toHaveText(texte)
  await expect(page.locator('.admin-annonce-titre').first()).toHaveText('Info du jour')

  // Sans recharger : l'appli relit les messages (retour au premier plan ici ; chaque minute, ou dès la
  // réception d'une notification système, sur un vrai appareil).
  await autre.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const popup = autre.getByRole('dialog', { name: 'Info du jour' }) // le titre du message
  await expect(popup).toContainText(texte)
  await popup.getByRole('button', { name: 'OK' }).click()
  await expect(popup).toHaveCount(0)
})
