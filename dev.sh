#!/usr/bin/env bash
# Lance l'API (port 8055) et le front Vite (port 5273) ensemble.
set -euo pipefail
cd "$(dirname "$0")"

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

.venv/bin/python -m uvicorn api.index:app --host 127.0.0.1 --port 8055 --reload &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT

echo "Connexion locale : saisis un e-mail, puis lis le code dans ce terminal (ligne [dev])."
pnpm run dev --host 0.0.0.0 --port 5273 --strictPort
