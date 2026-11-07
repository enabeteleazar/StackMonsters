# StackMonster

PWA de collection de canettes : scan du code-barres, fiche, compteur, photo.
Front React + TypeScript (Vite), API FastAPI (`api/index.py`), Postgres (Neon), Vercel.

## Suivi du projet
- [Roadmap produit](ROADMAP.md)
- [Tableau de suivi des tickets](PROJECT-BOARD.md)
- [Issues GitHub](https://github.com/enabeteleazar/StockMonsters/issues)

## Comptes
Connexion par **e-mail + code à 6 chiffres** (valable 10 min, 5 essais, 5 demandes par heure et
par adresse). Pas de mot de passe. Une session dure 30 jours et se révoque avec « Se déconnecter ».
La page d'accueil publique présente le service ; la collection privée n'est affichée qu'après
validation de la session par l'API.
Chaque utilisateur ne voit que sa collection (table `collection`, clé `user_id` + `ean`).

## Photos de la page d'accueil
La photo de canette dans `public/images/` provient de Wikimedia Commons et est affichée avec attribution :
- [Monster Energy Mega can](https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg), DYVER.

Photos sous licence [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

## Statistiques
Réglages → **Statistiques** (visible seulement pour `OWNER_EMAIL`) : nombre d'utilisateurs, total des
canettes (exemplaires) et nombre de références, tous comptes confondus. Route `GET /api/stats`,
réponse 403 pour tout autre compte.

## Déployer
1. Vercel → Storage → **Neon** (injecte `DATABASE_URL`).
2. Variables d'environnement (voir `.env.example`) : `SESSION_SECRET`, `RESEND_API_KEY`,
   `MAIL_FROM`, `OWNER_EMAIL`. Supprime `API_TOKEN`, devenu inutile.
3. Compte **Resend** pour l'envoi des codes. Configure `MAIL_FROM` avec une adresse d'un
   domaine vérifié dans Resend. L'expéditeur de test (`onboarding@resend.dev`) ne livre
   qu'à l'adresse e-mail du compte Resend.
4. `vercel --prod`, puis connecte-toi avec `OWNER_EMAIL` : l'ancienne collection (table
   `canettes`) est copiée dans ton compte, une seule fois, à la création de ton utilisateur.

Import d'anciennes données : `scripts/migrer.py` écrit dans `canettes` ; fais-le **avant** la
première connexion du propriétaire.

## Développer
```bash
export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:55432/postgres
pnpm install && ./dev.sh      # http://localhost:5273
```
En local, saisis un e-mail : le code s'affiche dans le terminal (ligne `[dev]`).
Tests : `pnpm test` ; `TEST_DATABASE_URL=… python -m pytest tests` (jamais sur la production).

## Tests bout en bout
Les tests navigateur utilisent une base Postgres locale dédiée, avec un nom contenant `test`.
Ils refusent les hôtes distants et n'utilisent jamais `DATABASE_URL`. En local, démarre une base
isolée puis lance :
```bash
docker run --rm -d --name stackmonster-test-db -p 127.0.0.1:5544:5432 \
  -e POSTGRES_DB=stackmonster_test -e POSTGRES_PASSWORD=stackmonster_test postgres:16
export TEST_DATABASE_URL=postgresql://postgres:stackmonster_test@127.0.0.1:5544/stackmonster_test
pnpm exec playwright install chromium
pnpm test:e2e
docker stop stackmonster-test-db
```
La CI démarre sa propre base éphémère, exécute les tests unitaires, API, navigateur et le build.
Configure le contrôle GitHub `tests` comme vérification obligatoire avant d'autoriser le déploiement.

## Limites assumées
- Aucune protection contre l'inscription en masse (un compte se crée à la première vérification).
- Session stockée dans `localStorage`, envoyée en `Bearer` (pas de cookie).
- Pas de suppression de compte ni de partage de collection.
- Hors ligne : lecture seule de la dernière liste ; « Se déconnecter » vide ce cache.
