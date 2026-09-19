# CanStack

Scanner de collection de canettes Monster. Front Vite + React servi en statique
par Caddy, service FastAPI + SQLite qui porte les données sur Homebox.

```
canStack/
├── src/            front (React + TypeScript)
├── server/         service FastAPI + SQLite
├── deploy/         unité systemd et extrait de Caddyfile
└── dist/           produit par `pnpm run build`, servi par Caddy
```

**Ce que le front ne fait pas** : il ne stocke rien. Toute la collection vit
dans `/var/lib/canstack/canstack.db`. Sans Tailscale, l'application s'ouvre
mais ne montre rien — c'est assumé pour cette version.

## Installation sur Homebox

### 1. Poser le projet

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin canstack
sudo mkdir -p /srv/canStack
# copier le contenu de cette archive dedans, puis :
sudo chown -R canstack:canstack /srv/canStack
sudo chmod -R a+rX /srv/canStack        # Caddy (utilisateur caddy) lit dist/
cd /srv/canStack
```

Le projet vit hors du dépôt Néron : `/srv` est fait pour les données servies par
la machine, et rien ici ne dépend de Néron sauf l'accès par Caddy.

### 2. Le service

```bash
cd server
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
sudo cp ../deploy/canstack.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now canstack
curl -s localhost:8055/health
```

`StateDirectory=canstack` fait créer `/var/lib/canstack` par systemd, avec les
bons droits. Vérifier avant tout que le port 8055 est libre : `ss -ltnp | grep 8055`.

### 3. Le front

```bash
cd /srv/canStack
pnpm install --frozen-lockfile
pnpm run build          # produit dist/
```

Node 18 ou plus. Le build est fait à la main : pas d'`ExecStartPre` de build
dans l'unité, contrairement au Dashboard et à neronVoice — un front statique
n'a aucune raison de se reconstruire à chaque redémarrage.

### 4. Caddy

Pour ne pas modifier le dépôt Néron à chaque nouveau projet, rendre Caddy
extensible une fois pour toutes :

```bash
sudo mkdir -p /etc/caddy/conf.d
sudo cp deploy/caddy.snippet /etc/caddy/conf.d/canstack.caddy   # AVANT l'import
```

puis ajouter cette seule ligne dans le bloc de site du Caddyfile versionné
(`system/deploy/caddy/Caddyfile`) :

```
import /etc/caddy/conf.d/*.caddy
```

Créer le fichier avant la ligne d'import : Caddy refuse de démarrer si le motif
ne correspond à rien. Ensuite :

```bash
caddy fmt --overwrite /etc/neronOS/system/deploy/caddy/Caddyfile
cd /etc/neronOS && sudo make install
curl -sI https://homebox.tail7f8e60.ts.net/monsters/ | head -1
curl -s  https://homebox.tail7f8e60.ts.net/monsters/api/health
```

### 5. Sur l'iPhone

Tailscale actif, ouvrir `https://homebox.tail7f8e60.ts.net/monsters/` dans
Safari, puis Partager → Sur l'écran d'accueil.

## Développement

```bash
pnpm run dev     # http://localhost:5273/monsters/ , proxie /monsters/api vers 8055
pnpm run build
pnpm run typecheck
```

Le service doit tourner en parallèle (`./server/.venv/bin/python -m uvicorn app:app --port 8055`
depuis `server/`, avec `CANSTACK_DB=./canstack.db` pour ne pas toucher la base de production).

## Sauvegarde

La base est un fichier unique :

```bash
sqlite3 /var/lib/canstack/canstack.db ".backup '/chemin/sauvegarde.db'"
```

L'écran Réglages permet aussi un export JSON et CSV depuis le téléphone.

## Points ouverts assumés

- **Pas d'authentification** sur le service : il écoute sur `127.0.0.1` et n'est
  atteignable que par Caddy, donc par le tailnet. Si un jour le tailnet est
  partagé, ajouter un `basic_auth` dans le bloc Caddy.
- **Pas de mode hors ligne** : ni cache, ni file d'attente. C'est le chantier
  suivant, et c'est lui qui apporte la synchronisation et ses conflits.
- **Photos en base64 dans SQLite** : simple, mais la base grossit d'environ
  40 ko par photo. À revoir vers 500 canettes.
- **Pas encore aligné sur `create_service_app`** : le service est un FastAPI
  autonome, sans `/metrics` ni enregistrement au registry Néron. C'est voulu —
  ce projet n'appartient pas à Néron.
- **Couplage restant** : Caddy, Tailscale et la sauvegarde de la machine sont
  communs. Le découplage porte sur le code et le dépôt, pas sur l'accès.
