#!/usr/bin/env python3
"""Applique les migrations manquantes à la base désignée par DATABASE_URL.

    DATABASE_URL=postgresql://... python scripts/migrer_schema.py

À lancer AVANT de déployer une version qui ajoute une migration : l'API répond 503 tant que la base
est en retard. Sans effet si la base est à jour ; tout passe dans une seule transaction.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.index import appliquer_migrations, connecter  # noqa: E402


def main() -> None:
    with connecter() as cx:
        appliquees = appliquer_migrations(cx)
    print(f"Migrations appliquées : {appliquees}" if appliquees else "Base déjà à jour.")


if __name__ == "__main__":
    main()
