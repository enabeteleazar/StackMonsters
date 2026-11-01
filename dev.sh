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
export API_TOKEN="${API_TOKEN:-dev}"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements-dev.txt
fi

.venv/bin/python -m uvicorn api.index:app --host 127.0.0.1 --port 8055 --reload &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT

echo "Jeton d'accès local : ${API_TOKEN}"
pnpm run dev
