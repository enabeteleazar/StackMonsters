# StackMonsters

PWA de collection de canettes : scan du code-barres, fiche, compteur, photo.
Front React + TypeScript (Vite), API FastAPI (`api/index.py`), Postgres (Neon), Vercel.

## Suivi du projet
- [Roadmap produit](ROADMAP.md)
- [Tableau de suivi des tickets](PROJECT-BOARD.md)
- [Issues GitHub](https://github.com/enabeteleazar/StockMonsters/issues)

## Comptes
Connexion par **e-mail + code à 6 chiffres** (valable 10 min, 5 essais) ; un compte se crée à la
première vérification réussie. Les limites anti-abus sont détaillées plus bas. Pas de mot de passe. Une session dure 30 jours et se révoque avec « Se déconnecter ».
La page d'accueil publique présente le service ; la collection privée n'est affichée qu'après
validation de la session par l'API.
Chaque utilisateur ne voit que sa collection (table `collection`, clé `user_id` + `ean`).

### Limites anti-abus
Toutes appliquées par l'API (fenêtres fixes, table `limites_ip` : empreintes HMAC, jamais l'IP en clair,
purgées après 24 h). Au-delà : réponse `429` avec `Retry-After` (secondes avant de pouvoir réessayer).

| Limite | Seuil | Fenêtre |
| --- | --- | --- |
| Demandes de code par adresse e-mail | 5 | 1 h |
| Essais par code | 5 | durée du code (10 min) |
| Demandes de code par IP | 20 / 60 | 1 h / 24 h |
| Vérifications de code par IP | 60 | 1 h |
| Nouveaux comptes par IP | 5 (`SM_COMPTES_MAX_IP_JOUR`) | 24 h |
| Nouveaux comptes, tous visiteurs | 30 (`SM_COMPTES_MAX_HEURE`) | 1 h |
| Demandes de code, tous visiteurs | 300 (`SM_DEMANDES_MAX_HEURE`) | 1 h |
| Signalements / propositions au Wiki par IP | 20 / 30 | 1 h |

Une IPv6 compte pour son /64. Les réponses ne révèlent pas si une adresse a déjà un compte : la demande
de code répond toujours `{"ok": true}` et ses limites ne dépendent pas de l'existence du compte. Les limites
de création ne s'appliquent qu'après un code valide (seul le titulaire de l'adresse l'apprend, `429`
« inscriptions limitées ») et ne bloquent jamais la connexion d'un membre existant ; un refus ne consomme
pas le code, utilisable depuis une autre IP ou plus tard tant qu'il n'a pas expiré.

**Débloquer** (membre légitime bloqué, pic d'inscriptions attendu) :
- attendre la fin de la fenêtre (`Retry-After`, message affiché à l'écran) ;
- ou effacer les compteurs avec `scripts/debloquer.py`, lancé avec la `DATABASE_URL` **et** le
  `SESSION_SECRET` de l'environnement visé (les clés sont des HMAC). Sans `--appliquer`, simple aperçu :
  ```bash
  python scripts/debloquer.py --ip 203.0.113.7           # toutes les limites de cette IP
  python scripts/debloquer.py --email membre@exemple.fr  # ses demandes et essais de code
  python scripts/debloquer.py --inscriptions --demandes --appliquer   # limites globales
  ```
  Le script n'efface que des compteurs et des codes, jamais un compte ;
- ou relever un seuil dans Vercel (`SM_COMPTES_MAX_IP_JOUR`, `SM_COMPTES_MAX_HEURE`, `SM_DEMANDES_MAX_HEURE`),
  puis redéployer.
  Les autres seuils sont des constantes de `api/index.py`.

## Collection
- Après un scan (ou un code saisi à la main) : canette déjà possédée → fiche miniature et « +1 » ;
  présente dans le Wiki → ajout immédiat, choix rapide de l'état, ajout annulable ; inconnue → invitation à
  créer la fiche (nom et photo). Le nom rejoint le Wiki sans écraser une valeur existante ; la photo reste
  dans la collection. Si le nom saisi correspond à une fiche du Wiki qui n'a qu'un code interne (préfixe `20`,
  voir `convert.py`), l'utilisateur peut lui associer le code scanné (`POST /api/wiki/{ean}/code-barres`) : la
  fiche et les collections prennent le vrai code, l'ancien n'est plus recréé. Si la fiche a déjà un vrai code, le
  code scanné devient un **code supplémentaire** (table `wiki_codes`, autre pays ou autre format) : le scanner
  retrouve la fiche, sans doublon. Le propriétaire retire un code associé par erreur depuis la fiche.
  Les codes-barres ne sont affichés dans les fiches du Wiki que pour `OWNER_EMAIL` (l'application les reçoit
  quand même : ils servent à reconnaître une canette scannée).
  La correspondance des noms se fait mot par mot, sans tenir compte de « Monster », « Energy » ni du volume.
- Codes acceptés à la création : EAN-13, EAN-8, UPC-A et UPC-E, clé de contrôle vérifiée (client et serveur).
  Un UPC-A est enregistré sur 13 chiffres (`0` en tête) pour éviter les doublons, un UPC-E est développé par
  le scanner. Une fiche déjà en base reste modifiable même si son code est ancien.
- `GET /api/cans` ne transporte pas les photos, seulement `photo_version` ; l'image se charge à la demande
  (`GET /api/cans/{ean}/photo`). Un `PUT /api/cans` sans champ `photo` conserve la photo existante.

## Wiki (catalogue partagé)
Menu **Wiki** : toutes les canettes répertoriées dans l'application, tous comptes confondus. Une vignette
(photo + nom) ouvre la fiche : nom, version, volume, catégorie, saveur, statut et région.
- Catégories et régions proposées dans le formulaire propriétaire : elles proviennent des valeurs distinctes
  du catalogue source. Le statut est `Active`, `Stop` ou `Nouveauté` ; une Nouveauté s'affiche `Active` 30 jours
  après avoir été choisie (calcul à la lecture, colonne `nouveaute_depuis`).
- Table `wiki` (une ligne par `ean`), séparée des collections : elle ne contient ni propriétaire, ni
  quantité, ni état, ni notes. Elle est alimentée à l'ajout d'une canette (champs descriptifs) et ne
  prend que ce qui manque : un compte ne peut pas écraser une fiche existante. Les photos des comptes et
  les canettes sans code-barres (`LOCAL-…`) n'y sont jamais envoyées. Retirer une canette de sa
  collection ne la retire pas du Wiki. À la première création de la table, elle est amorcée depuis les
  collections existantes (une seule fois). Une fiche supprimée ou dont le code-barres a changé est notée
  dans `wiki_exclus` et n'est plus recréée ; un changement de code-barres est reporté dans les collections.
- La description ne vient pas des utilisateurs : elle est saisie par `OWNER_EMAIL` depuis la
  fiche (« Modifier la fiche », `PUT /api/wiki/{ean}`, 403 pour tout autre compte).
- Les photos du Wiki sont ajoutées, remplacées ou retirées par `OWNER_EMAIL` depuis la fiche
  (`PUT` et `DELETE /api/wiki/{ean}/photo`, 403 pour tout autre compte).
- Routes : `GET /api/wiki` (liste sans photos), `GET /api/wiki/{ean}/photo` (image, chargée à la demande
  quand la vignette approche de l'écran), toutes derrière la session. Le Wiki exige la connexion réseau.

## Catalogue Open Food Facts
Le catalogue de référence est `monster_database.json` (liste JSON). Pour l'actualiser avec les produits de la marque Monster Energy :
`python3 scripts/import_openfoodfacts.py`. Le script récupère toutes les pages de l'API Open Food Facts,
fusionne les produits par code-barres et conserve les entrées et champs descriptifs déjà présents.
L'import est écrit atomiquement : une erreur réseau ou une réponse vide ne remplace pas le fichier.
Les produits importés gardent leurs données source et l'attribution [Open Food Facts](https://world.openfoodfacts.org/)
sous licence [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

## Référencement
`public/robots.txt` autorise l'indexation du site, sauf l'API et la page de maintenance, et annonce
`public/sitemap.xml`, qui ne liste que la page d'accueil publique (le reste exige une connexion). Les deux
visent le domaine `stackmonsters.fr` : il doit être relié au projet Vercel (Settings → Domains) pour que les
moteurs de recherche les suivent. Mettre à jour `<lastmod>` quand la page d'accueil change.

## Photos de la page d'accueil
La photo de canette dans `public/images/` provient de Wikimedia Commons et est affichée avec attribution :
- [Monster Energy Mega can](https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg), DYVER.

Photos sous licence [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

## Statistiques
Réglages → **Statistiques** (visible seulement pour `OWNER_EMAIL`) : nombre d'utilisateurs, nombre de
Références et nombre d'adresses IP uniques ayant validé une connexion sur les 13 derniers mois. Les
adresses sont conservées sous forme d'empreintes HMAC avec `SESSION_SECRET`, jamais en clair. Le compteur
est glissant (empreintes effacées après 13 mois) : plusieurs personnes partageant une IP comptent une fois et les IP dynamiques peuvent
compter plusieurs fois.
Route `GET /api/stats`, réponse 403 pour tout autre compte.

## Suivi du trafic facultatif
Rien n'est envoyé (ntfy.sh et Vercel Analytics) sans un « Accepter » dans le bandeau de consentement ; le choix se
change dans Réglages. La politique de confidentialité est à `/#confidentialite` (responsable et contact :
`src/config.ts`). Les polices sont servies par le site, sans appel à Google.
`VITE_TRACK_TOPIC` active l'envoi d'événements `visit`, `connection` et `can_added` vers ntfy.sh.
Les événements contiennent un identifiant aléatoire persistant dans le navigateur, le type d'appareil
et la provenance approximative (référent/source UTM). Le suivi est désactivé si la variable est vide ;
`localStorage.setItem('sm_ignore', '1')` permet aussi de l'exclure dans un navigateur.
Cette variable `VITE_` et le nom du topic sont intégrés au JavaScript public : le topic n'est pas un secret,
et les messages peuvent être lus ou alimentés par toute personne qui le connaît. Ne pas y envoyer de
donnée personnelle ou confidentielle, et ne pas utiliser ce mécanisme comme canal privé.

## Migrations de la base
L'API ne modifie jamais le schéma : les migrations sont listées dans `MIGRATIONS` (`api/index.py`), dans
l'ordre, et appliquées une seule fois par `DATABASE_URL=… python scripts/migrer_schema.py`. **À lancer sur
chaque base avant de déployer une version qui ajoute une migration** : sinon l'API répond 503. Ne jamais
modifier une migration déjà déployée, en ajouter une nouvelle, et ne jamais réattribuer un numéro, même
retiré avant livraison (une base de développement a pu l'enregistrer). `./dev.sh` l'exécute automatiquement.

## Déployer
1. Vercel → Storage → **Neon** (injecte `DATABASE_URL`).
2. Dans Vercel → Settings → Environment Variables, configure `STATUS_APP` avec `MAINTENANCE`
   pour afficher la page de maintenance ou `PRODUCTION` pour afficher l'application (valeur par
   défaut si la variable est absente). Après chaque changement de valeur sur Vercel, redéploie
   l'application pour appliquer le nouveau mode. En local, le même réglage se fait dans `.env.local`.
3. Variables d'environnement (voir `.env.example`) : `SESSION_SECRET`, `RESEND_API_KEY`,
   `MAIL_FROM`, `OWNER_EMAIL`. Supprime `API_TOKEN`, devenu inutile.
   La page de maintenance utilise aussi `VITE_MAINTENANCE_START_DATE` et
   `VITE_MAINTENANCE_TARGET_DATE` (dates ISO 8601 avec fuseau horaire) pour calculer sa progression.
4. Compte **Resend** pour l'envoi des codes. Configure `MAIL_FROM` avec une adresse d'un
   domaine vérifié dans Resend. L'expéditeur de test (`onboarding@resend.dev`) ne livre
   qu'à l'adresse e-mail du compte Resend.
5. `vercel --prod`, puis connecte-toi avec `OWNER_EMAIL` : l'ancienne collection (table
   `canettes`) est copiée dans ton compte, une seule fois, à la création de ton utilisateur.

Import d'anciennes données : `scripts/migrer.py` écrit dans `canettes` ; fais-le **avant** la
première connexion du propriétaire.
Restauration d'une ancienne « Sauvegarde JSON » (export retiré de l'appli) dans un compte existant :
`python scripts/migrer.py sauvegarde.json --email moi@exemple.fr`.

## Développer
```bash
export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:55432/postgres
pnpm install && ./dev.sh      # http://localhost:5273
```
Si tu utilises Neon, configure `DATABASE_URL` avec la chaîne de connexion actuelle de la branche choisie
(Neon → **Connect**). `./dev.sh` vérifie la connexion avant de démarrer et signale les identifiants refusés.
En local, saisis un e-mail : le code s'affiche dans le terminal (ligne `[dev]`).
Tests : `pnpm test` ; `TEST_DATABASE_URL=… python -m pytest tests` (jamais sur la production).
Bout en bout : `pnpm exec playwright install chromium`, migrer une base **jetable**, puis
`E2E_DATABASE_URL=… E2E_PYTHON=.venv/bin/python pnpm exec playwright test`.

## Limites assumées
- Les limites par IP ralentissent l'inscription en masse sans l'empêcher (réseaux de nombreuses IP) ; pas de
  CAPTCHA. Plusieurs personnes derrière la même IP (CGNAT mobile, école) partagent les compteurs.
- Session stockée dans `localStorage`, envoyée en `Bearer` (pas de cookie).
- Pas de suppression de compte ni de partage de collection.
- Hors ligne : lecture seule de la dernière liste ; « Se déconnecter » vide ce cache.
