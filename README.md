# StackMonster

PWA de collection de canettes : scan du code-barres, fiche, compteur, photo.
Front React + TypeScript (Vite), API FastAPI (`api/index.py`), Postgres (Neon), Vercel.

**PWA** : manifeste + icônes (installable), service worker (`public/sw.js`) qui garde
l'appli et la dernière liste de canettes pour une ouverture sans réseau. Les
modifications exigent le réseau (pas de file d'attente). Le lecteur de codes ne
fonctionne hors ligne qu'après un premier scan fait en ligne.

**Accès** : site public, donc jeton `API_TOKEN` exigé sur chaque route de l'API.

## Déployer
1. Vercel → Storage → **Neon** (injecte `DATABASE_URL`).
2. Variable `API_TOKEN` : `openssl rand -hex 24`.
3. `vercel --prod`.
4. iPhone : ouvrir l'URL dans Safari, entrer le jeton, Partager → Sur l'écran d'accueil.
5. Reprise d'anciennes données : `scripts/migrer.py` (base SQLite ou export JSON).

## Développer
```bash
export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:55432/postgres
pnpm install && ./dev.sh      # http://localhost:5273, jeton « dev »
```
Tests : `pnpm test` (front) ; `TEST_DATABASE_URL=… python -m pytest tests` (API, base de test).

## À savoir
Le service worker ne s'active qu'en production (`pnpm build`), pas avec `pnpm dev`.
Pour publier une nouvelle version du cache, incrémente `V` dans `public/sw.js`.
