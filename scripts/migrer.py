#!/usr/bin/env python3
"""Reprend une collection existante dans la base Postgres (Neon).

    DATABASE_URL=postgresql://... python scripts/migrer.py /var/lib/canstack/canstack.db
    DATABASE_URL=postgresql://... python scripts/migrer.py canstack-2026-11-01.json

- un fichier .db : la base SQLite de Homebox (fidèle, photos et dates comprises) ;
- un fichier .json : la « Sauvegarde JSON » de l'écran Réglages.

Le script peut être relancé sans risque : une canette déjà présente (même EAN)
est mise à jour, jamais dupliquée. Sans effet sur les canettes absentes du fichier.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.index import COLONNES, base, maintenant  # noqa: E402

CHAMPS = COLONNES.split(", ")


def lire_sqlite(chemin: Path) -> list[dict]:
    cx = sqlite3.connect(f"file:{chemin}?mode=ro", uri=True)
    cx.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in cx.execute("SELECT * FROM canettes")]
    finally:
        cx.close()


def lire_json(chemin: Path) -> list[dict]:
    donnees = json.loads(chemin.read_text(encoding="utf-8"))
    if not isinstance(donnees, list):
        sys.exit("Le JSON doit être une liste de canettes (export des Réglages).")
    return donnees


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    chemin = Path(sys.argv[1])
    if not chemin.is_file():
        sys.exit(f"Fichier introuvable : {chemin}")

    lignes = lire_json(chemin) if chemin.suffix.lower() == ".json" else lire_sqlite(chemin)

    ecrites = 0
    with base() as cx:
        for r in lignes:
            if not r.get("ean"):
                continue
            valeurs = (
                r["ean"], r.get("nom") or "", r.get("edition") or "", r.get("volume") or "",
                r.get("etat") or "", max(1, int(r.get("nb") or 1)), r.get("notes") or "",
                r.get("photo"), r.get("ajout") or maintenant(), r.get("maj") or maintenant(),
            )
            cx.execute(
                """INSERT INTO canettes (ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (ean) DO UPDATE SET
                     nom=EXCLUDED.nom, edition=EXCLUDED.edition, volume=EXCLUDED.volume,
                     etat=EXCLUDED.etat, nb=EXCLUDED.nb, notes=EXCLUDED.notes,
                     photo=EXCLUDED.photo, ajout=EXCLUDED.ajout, maj=EXCLUDED.maj""",
                valeurs,
            )
            ecrites += 1
        total = cx.execute("SELECT COUNT(*) AS n FROM canettes").fetchone()["n"]
    print(f"{ecrites} canette(s) reprise(s) depuis {chemin.name} — {total} en base.")


if __name__ == "__main__":
    main()
