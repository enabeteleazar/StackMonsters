# StackMonster

PWA de collection de canettes : scan du code-barres, fiche, compteur, photo.
Front React + TypeScript (Vite), API FastAPI (`api/index.py`), Postgres (Neon), Vercel.

## Suivi du projet
- [Roadmap produit](ROADMAP.md)
- [Tableau de suivi des tickets](PROJECT-BOARD.md)
- [Issues GitHub](https://github.com/enabeteleazar/StockMonsters/issues)

## Comptes
Connexion par **e-mail + code à 6 chiffres** (valable 10 min, 5 essais, 5 demandes par heure et
par adresse). Par adresse IP et par heure : 20 demandes de code et 60 vérifications au maximum (table
`limites_ip`, empreintes HMAC uniquement). Pas de mot de passe. Une session dure 30 jours et se révoque avec « Se déconnecter ».
La page d'accueil publique présente le service ; la collection privée n'est affichée qu'après
validation de la session par l'API.
Chaque utilisateur ne voit que sa collection (table `collection`, clé `user_id` + `ean`).

## Collection
- Codes acceptés à la création : EAN-13, EAN-8, UPC-A et UPC-E, clé de contrôle vérifiée (client et serveur).
  Un UPC-A est enregistré sur 13 chiffres (`0` en tête) pour éviter les doublons, un UPC-E est développé par
  le scanner. Une fiche déjà en base reste modifiable même si son code est ancien.
- `GET /api/cans` ne transporte pas les photos, seulement `photo_version` ; l'image se charge à la demande
  (`GET /api/cans/{ean}/photo`). Un `PUT /api/cans` sans champ `photo` conserve la photo existante.
- « Sauvegarde JSON » contient toutes les données de collection et les photos ; elle s'annule si une photo
  ne peut pas être lue.

## Wiki (catalogue partagé)
Menu **Wiki** : toutes les canettes répertoriées dans l'application, tous comptes confondus. Une vignette
(photo + nom) ouvre la fiche : nom, version, volume, catégorie, saveur, statut et région.
- Catégories et régions proposées dans le formulaire propriétaire : elles proviennent des valeurs distinctes
  du catalogue source. Le statut est `Active` ou `Stop`.
- Table `wiki` (une ligne par `ean`), séparée des collections : elle ne contient ni propriétaire, ni
  quantité, ni état, ni notes. Elle est alimentée à l'ajout d'une canette (champs descriptifs) et ne
  prend que ce qui manque : un compte ne peut pas écraser une fiche existante. Les photos des comptes et
  les canettes sans code-barres (`LOCAL-…`) n'y sont jamais envoyées. Retirer une canette de sa
  collection ne la retire pas du Wiki. À la première création de la table, elle est amorcée depuis les
  collections existantes (une seule fois). Une fiche supprimée ou dont le code-barres a changé est notée
  dans `wiki_exclus` et n'est plus recréée ; un changement de code-barres est reporté dans les collections.
- Le pays et la description ne viennent pas des utilisateurs : ils sont saisis par `OWNER_EMAIL` depuis la
  fiche (« Modifier la fiche », `PUT /api/wiki/{ean}`, 403 pour tout autre compte).
- Les photos du Wiki sont ajoutées, remplacées ou retirées par `OWNER_EMAIL` depuis la fiche
  (`PUT` et `DELETE /api/wiki/{ean}/photo`, 403 pour tout autre compte).
- Routes : `GET /api/wiki` (liste sans photos), `GET /api/wiki/{ean}/photo` (image, chargée à la demande
  quand la vignette approche de l'écran), toutes derrière la session. Le Wiki exige la connexion réseau.

## Catalogue Open Food Facts
Pour actualiser localement `monster_database.json` avec les produits de la marque Monster Energy :
`python3 scripts/import_openfoodfacts.py`. Le script récupère toutes les pages de l'API Open Food Facts,
fusionne les produits par code-barres et conserve les entrées et champs descriptifs déjà présents.
L'import est écrit atomiquement : une erreur réseau ou une réponse vide ne remplace pas le fichier.
Les produits importés gardent leurs données source et l'attribution [Open Food Facts](https://world.openfoodfacts.org/)
sous licence [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

## Photos de la page d'accueil
La photo de canette dans `public/images/` provient de Wikimedia Commons et est affichée avec attribution :
- [Monster Energy Mega can](https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg), DYVER.

Photos sous licence [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

## Statistiques
Réglages → **Statistiques** (visible seulement pour `OWNER_EMAIL`) : nombre d'utilisateurs, nombre de
Références et nombre d'adresses IP uniques ayant validé une connexion depuis l'activation du suivi. Les
adresses sont conservées sous forme d'empreintes HMAC avec `SESSION_SECRET`, jamais en clair. Le compteur
est cumulatif : plusieurs personnes partageant une IP comptent une fois et les IP dynamiques peuvent
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
modifier une migration déjà déployée, en ajouter une nouvelle. `./dev.sh` l'exécute automatiquement.

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
Restauration d'une « Sauvegarde JSON » dans un compte existant :
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
- Aucune protection contre l'inscription en masse (un compte se crée à la première vérification).
- Session stockée dans `localStorage`, envoyée en `Bearer` (pas de cookie).
- Pas de suppression de compte ni de partage de collection.
- Hors ligne : lecture seule de la dernière liste ; « Se déconnecter » vide ce cache.
