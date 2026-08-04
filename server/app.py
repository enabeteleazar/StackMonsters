"""Service CanStack — la collection de canettes vit ici, pas dans le navigateur.

Écoute sur la boucle locale uniquement : l'exposition passe par Caddy, qui
termine le TLS et n'est joignable que depuis le tailnet. Pas de clé d'API
dans le bundle du front, donc rien à faire fuiter côté navigateur.
"""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

VERSION = "0.1.0"
DB = Path(os.environ.get("CANSTACK_DB", "/var/lib/canstack/canstack.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS canettes (
    ean      TEXT PRIMARY KEY,
    nom      TEXT NOT NULL DEFAULT '',
    edition  TEXT NOT NULL DEFAULT '',
    volume   TEXT NOT NULL DEFAULT '',
    etat     TEXT NOT NULL DEFAULT '',
    nb       INTEGER NOT NULL DEFAULT 1,
    notes    TEXT NOT NULL DEFAULT '',
    photo    TEXT,
    ajout    TEXT NOT NULL,
    maj      TEXT NOT NULL
);
"""


class Canette(BaseModel):
    ean: str = Field(min_length=1, max_length=64)
    nom: str = ""
    edition: str = ""
    volume: str = ""
    etat: str = ""
    nb: int = Field(default=1, ge=1, le=9999)
    notes: str = ""
    photo: str | None = None
    ajout: str = ""


class Delta(BaseModel):
    delta: int = Field(ge=-99, le=99)


@contextmanager
def base() -> Iterator[sqlite3.Connection]:
    cx = sqlite3.connect(DB, timeout=5)
    cx.row_factory = sqlite3.Row
    try:
        yield cx
        cx.commit()
    finally:
        cx.close()


def maintenant() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def initialiser() -> None:
    DB.parent.mkdir(parents=True, exist_ok=True)
    with base() as cx:
        cx.executescript(SCHEMA)
        cx.execute("PRAGMA journal_mode=WAL")


app = FastAPI(title="CanStack", version=VERSION, docs_url=None, redoc_url=None)
initialiser()


def en_canette(r: sqlite3.Row) -> dict:
    d = dict(r)
    d.pop("maj", None)
    return d


@app.get("/health")
def sante() -> dict:
    with base() as cx:
        n = cx.execute("SELECT COUNT(*) AS n FROM canettes").fetchone()["n"]
    return {"status": "ok", "version": VERSION, "canettes": n}


@app.get("/cans")
def liste() -> list[dict]:
    with base() as cx:
        lignes = cx.execute("SELECT * FROM canettes ORDER BY ajout DESC").fetchall()
    return [en_canette(r) for r in lignes]


@app.get("/cans/{ean}")
def lire(ean: str) -> dict:
    with base() as cx:
        r = cx.execute("SELECT * FROM canettes WHERE ean = ?", (ean,)).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return en_canette(r)


@app.put("/cans")
def enregistrer(c: Canette) -> dict:
    """Création ou mise à jour. La date d'ajout d'origine n'est jamais écrasée."""
    with base() as cx:
        ancienne = cx.execute(
            "SELECT ajout FROM canettes WHERE ean = ?", (c.ean,)
        ).fetchone()
        ajout = ancienne["ajout"] if ancienne else (c.ajout or maintenant())
        cx.execute(
            """INSERT INTO canettes (ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ean) DO UPDATE SET
                 nom=excluded.nom, edition=excluded.edition, volume=excluded.volume,
                 etat=excluded.etat, nb=excluded.nb, notes=excluded.notes,
                 photo=excluded.photo, maj=excluded.maj""",
            (c.ean, c.nom, c.edition, c.volume, c.etat, c.nb, c.notes, c.photo, ajout, maintenant()),
        )
    return lire(c.ean)


@app.patch("/cans/{ean}/nb")
def ajuster(ean: str, d: Delta) -> dict:
    with base() as cx:
        r = cx.execute("SELECT nb FROM canettes WHERE ean = ?", (ean,)).fetchone()
        if r is None:
            raise HTTPException(404, "canette inconnue")
        nb = max(1, r["nb"] + d.delta)
        cx.execute("UPDATE canettes SET nb = ?, maj = ? WHERE ean = ?", (nb, maintenant(), ean))
    return lire(ean)


@app.delete("/cans/{ean}", status_code=204)
def supprimer(ean: str) -> None:
    with base() as cx:
        supprimees = cx.execute("DELETE FROM canettes WHERE ean = ?", (ean,)).rowcount
    if supprimees == 0:
        raise HTTPException(404, "canette inconnue")
