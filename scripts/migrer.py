#!/usr/bin/env python3
"""Reprend une collection existante dans la base Postgres (Neon).

    DATABASE_URL=postgresql://... python scripts/migrer.py /var/lib/canstack/canstack.db
    DATABASE_URL=postgresql://... python scripts/migrer.py stackmonster-2026-11-01.json
    DATABASE_URL=postgresql://... python scripts/migrer.py stackmonster-2026-11-01.json --email moi@exemple.fr

- un fichier .db : la base SQLite de l'ancienne version auto-hébergée (fidèle, photos et dates comprises) ;
- un fichier .json : la « Sauvegarde JSON » de l'écran Réglages.

Sans --email, le script écrit dans la table historique « canettes », reprise uniquement à la toute
première connexion de OWNER_EMAIL. Avec --email, il restaure directement dans la collection de ce
compte, qui doit déjà exister ; le Wiki ne reçoit que les champs descriptifs qui lui manquent.

Le script peut être relancé sans risque : une canette déjà présente (même EAN)
est mise à jour, jamais dupliquée. Sans effet sur les canettes absentes du fichier.
Tout le fichier passe, ou rien n'est écrit.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
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


def restaurer_compte(cx, email: str, lignes: list[dict]) -> int:
    """Écrit les canettes dans la collection du compte ; les autres comptes ne sont pas touchés."""
    compte = cx.execute("SELECT id FROM users WHERE email = %s", (email.strip().lower(),)).fetchone()
    if compte is None:
        sys.exit(f"Aucun compte pour {email} : connecte-toi une première fois, puis relance.")
    ecrites = 0
    for r in lignes:
        if not r.get("ean"):
            continue
        cx.execute(
            """INSERT INTO collection (user_id, ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (user_id, ean) DO UPDATE SET
                 nom=EXCLUDED.nom, edition=EXCLUDED.edition, volume=EXCLUDED.volume, etat=EXCLUDED.etat,
                 nb=EXCLUDED.nb, notes=EXCLUDED.notes, ajout=EXCLUDED.ajout, maj=EXCLUDED.maj,
                 photo=COALESCE(EXCLUDED.photo, collection.photo)""",
            (compte["id"], r["ean"], r.get("nom") or "", r.get("edition") or "", r.get("volume") or "",
             r.get("etat") or "", max(1, int(r.get("nb") or 1)), r.get("notes") or "", r.get("photo"),
             r.get("ajout") or maintenant(), maintenant()),
        )
        exclue = cx.execute("SELECT 1 FROM wiki_exclus WHERE ean = %s", (r["ean"],)).fetchone()
        if not str(r["ean"]).startswith("LOCAL-") and not exclue:
            cx.execute(
                """INSERT INTO wiki (ean, nom, edition, volume, categorie, flavor, status, region, nouveaute_depuis, cree, maj)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (ean) DO UPDATE SET
                     nom=COALESCE(NULLIF(wiki.nom, ''), EXCLUDED.nom),
                     edition=COALESCE(NULLIF(wiki.edition, ''), EXCLUDED.edition),
                     volume=COALESCE(NULLIF(wiki.volume, ''), EXCLUDED.volume),
                     categorie=COALESCE(NULLIF(wiki.categorie, ''), NULLIF(wiki.gamme, ''), EXCLUDED.categorie),
                     flavor=COALESCE(NULLIF(wiki.flavor, ''), EXCLUDED.flavor),
                     status=COALESCE(NULLIF(wiki.status, ''), EXCLUDED.status),
                     nouveaute_depuis=CASE WHEN wiki.status = '' THEN EXCLUDED.nouveaute_depuis
                                           ELSE wiki.nouveaute_depuis END,
                     region=COALESCE(NULLIF(wiki.region, ''), EXCLUDED.region)""",
                (r["ean"], r.get("nom") or "", r.get("edition") or "", r.get("volume") or "",
                 r.get("categorie") or "", r.get("flavor") or "", r.get("status") or "", r.get("region") or "",
                 int(time.time()) if r.get("status") == "Nouveauté" else None, maintenant(), maintenant()),
            )
        ecrites += 1
    return ecrites


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("fichier", type=Path, help="Fichier .db ou sauvegarde .json")
    parser.add_argument("--email", help="Compte dont la collection est restaurée")
    args = parser.parse_args()
    chemin = args.fichier
    if not chemin.is_file():
        sys.exit(f"Fichier introuvable : {chemin}")

    lignes = lire_json(chemin) if chemin.suffix.lower() == ".json" else lire_sqlite(chemin)

    if args.email:
        with base() as cx:
            ecrites = restaurer_compte(cx, args.email, lignes)
        print(f"{ecrites} canette(s) restaurée(s) depuis {chemin.name} dans le compte {args.email}.")
        return

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
