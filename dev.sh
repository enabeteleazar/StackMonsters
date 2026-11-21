#!/usr/bin/env bash
# Lance l'API (port 8055) et le front Vite (port 5273) ensemble.
#
#   ./dev.sh            démarre sans toucher au schéma de la base
#   ./dev.sh --migrer   applique d'abord les migrations manquantes à la base de DATABASE_URL (.env.local),
#                       c'est-à-dire : DATABASE_URL='…' .venv/bin/python scripts/migrer_schema.py
#
#   SM_POLLING=1 ./dev.sh   si Vite s'arrête sur « ENOSPC: System limit for number of file watchers reached » :
#                           les fichiers sont relus régulièrement au lieu d'être surveillés par le système
#                           (solution durable : relever fs.inotify.max_user_watches, voir le README)
#
# DATABASE_URL vient de .env.local (jamais commité) : ne jamais l'écrire dans ce fichier.
set -euo pipefail
cd "$(dirname "$0")"

MIGRER=0
for arg in "$@"; do
  case "$arg" in
    --migrer) MIGRER=1 ;;
    *) echo "Option inconnue : $arg (seule option : --migrer)" >&2; exit 1 ;;
  esac
done

# Variables locales : DATABASE_URL (et API_TOKEN) depuis .env.local si présent.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL manquante." >&2
  echo "  - avec Vercel/Neon :  vercel env pull .env.local  (de préférence sur une branche Neon de test)" >&2
  echo "  - ou Postgres local : docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16" >&2
  echo "                        export DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres" >&2
  exit 1
fi

python3 - <<'PY'
import socket
import sys

ports = ((8055, "API"), (5273, "Vite"))
busy = []
for port, service in ports:
    with socket.socket() as sock:
        try:
            sock.bind(("0.0.0.0", port))
        except OSError:
            busy.append(f"{service} (port {port})")

if busy:
    print("Port(s) déjà utilisé(s) : " + ", ".join(busy), file=sys.stderr)
    print("Arrête le serveur concerné avant de relancer ./dev.sh.", file=sys.stderr)
    sys.exit(1)
PY

export SESSION_SECRET="${SESSION_SECRET:-dev-secret}"
export AUTH_DEV=1   # sans RESEND_API_KEY, le code de connexion s'affiche dans ce terminal

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements-dev.txt
fi

if ! .venv/bin/python - <<'PY'
import os
import sys

import psycopg

try:
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10) as cx:
        cx.execute("SELECT 1")
except psycopg.OperationalError as exc:
    if "password authentication failed" in str(exc).lower():
        print("Identifiants PostgreSQL refusés.", file=sys.stderr)
        print("Actualise DATABASE_URL avec la chaîne de connexion actuelle de Neon.", file=sys.stderr)
    else:
        print(f"Connexion PostgreSQL impossible ({type(exc).__name__}).", file=sys.stderr)
        print("Vérifie DATABASE_URL, l'accès réseau et l'état de la branche Neon.", file=sys.stderr)
    sys.exit(1)
PY
then
  exit 1
fi

# Migrations seulement sur demande (--migrer, ou SM_MIGRATION_AUTO=1) : .env.local peut désigner la base de
# production, qui ne doit pas changer de version sans qu'on le décide. Sans migration, l'API répond « Service en
# maintenance » (503) tant que la base est en retard sur le code de la branche ouverte.
if [ "$MIGRER" = "1" ] || [ "${SM_MIGRATION_AUTO:-}" = "1" ]; then
  echo "Migrations sur la base : $(.venv/bin/python -c 'import os,urllib.parse as u;print(u.urlparse(os.environ["DATABASE_URL"]).hostname)')"
  .venv/bin/python scripts/migrer_schema.py
else
  echo "Migrations non appliquées. Si l'appli affiche « Service en maintenance », la base est en retard : ./dev.sh --migrer"
fi

.venv/bin/python -m uvicorn api.index:app --host 127.0.0.1 --port 8055 --reload --reload-dir api &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT

echo "Connexion locale : saisis un e-mail, puis lis le code dans ce terminal (ligne [dev])."
pnpm run dev --host 0.0.0.0 --port 5273 --strictPort
