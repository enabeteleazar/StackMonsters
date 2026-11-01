"""Service StackMonster pour Vercel — la collection vit dans Postgres (Neon).

Sur Vercel, le disque est éphémère : on ne peut plus garder un fichier SQLite.
La base est donc externe (variable DATABASE_URL, injectée par l'intégration
Neon). L'URL du site est publique, donc chaque route exige le jeton API_TOKEN
(en-tête « Authorization: Bearer … »).
"""

from __future__ import annotations

import hmac
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field


def _version() -> str:
    """Lit VERSION à la racine du projet, seule source de vérité pour le numéro."""
    chemin = Path(__file__).resolve().parent.parent / "VERSION"
    try:
        return chemin.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "0.0.0"


VERSION = _version()

COLONNES = "ean, nom, edition, volume, etat, nb, notes, photo, ajout"

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
)
"""


class Canette(BaseModel):
    ean: str = Field(min_length=1, max_length=64)
    nom: str = ""
    edition: str = ""
    volume: str = ""
    etat: str = ""
    nb: int = Field(default=1, ge=1, le=9999)
    notes: str = ""
    # Une photo réduite à 640 px pèse ~40 ko en base64 : 300 000 caractères suffisent.
    photo: str | None = Field(default=None, max_length=300_000)
    ajout: str = ""


class Delta(BaseModel):
    delta: int = Field(ge=-99, le=99)


# --- base de données ---------------------------------------------------------

_schema_pret = False


def _url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise HTTPException(503, "DATABASE_URL non configurée")
    return url


def _creer_schema(cx: psycopg.Connection) -> None:
    """Création de la table au premier appel de chaque instance.

    Le verrou évite que deux démarrages à froid simultanés se marchent dessus.
    """
    global _schema_pret
    if _schema_pret:
        return
    cx.execute("SELECT pg_advisory_xact_lock(7305)")
    cx.execute(SCHEMA)
    cx.commit()
    _schema_pret = True


@contextmanager
def base() -> Iterator[psycopg.Connection]:
    # prepare_threshold=None : la chaîne Neon « pooled » passe par pgbouncer,
    # qui n'accepte pas les requêtes préparées côté serveur.
    with psycopg.connect(
        _url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=10
    ) as cx:
        _creer_schema(cx)
        yield cx  # commit à la sortie du bloc, rollback sur exception


def maintenant() -> str:
    """Même format que le front (toISOString) : les dates se trient comme du texte."""
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


# --- accès -------------------------------------------------------------------


def verifier_jeton(authorization: str | None = Header(default=None)) -> None:
    attendu = os.environ.get("API_TOKEN", "")
    if not attendu:
        # Sans jeton configuré, mieux vaut tout refuser que tout ouvrir.
        raise HTTPException(503, "API_TOKEN non configuré")
    fourni = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(fourni.encode(), attendu.encode()):
        raise HTTPException(401, "jeton invalide")


# --- routes ------------------------------------------------------------------

router = APIRouter(dependencies=[Depends(verifier_jeton)])


@router.get("/health")
def sante() -> dict:
    with base() as cx:
        n = cx.execute("SELECT COUNT(*) AS n FROM canettes").fetchone()["n"]
    return {"status": "ok", "version": VERSION, "canettes": n}


@router.get("/cans")
def liste() -> list[dict]:
    with base() as cx:
        return cx.execute(
            f"SELECT {COLONNES} FROM canettes ORDER BY ajout DESC"
        ).fetchall()


@router.get("/cans/{ean}")
def lire(ean: str) -> dict:
    with base() as cx:
        r = cx.execute(f"SELECT {COLONNES} FROM canettes WHERE ean = %s", (ean,)).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.put("/cans")
def enregistrer(c: Canette) -> dict:
    """Création ou mise à jour. La date d'ajout d'origine n'est jamais écrasée."""
    with base() as cx:
        return cx.execute(
            f"""INSERT INTO canettes (ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ean) DO UPDATE SET
                  nom=EXCLUDED.nom, edition=EXCLUDED.edition, volume=EXCLUDED.volume,
                  etat=EXCLUDED.etat, nb=EXCLUDED.nb, notes=EXCLUDED.notes,
                  photo=EXCLUDED.photo, maj=EXCLUDED.maj
                RETURNING {COLONNES}""",
            (
                c.ean, c.nom, c.edition, c.volume, c.etat, c.nb, c.notes, c.photo,
                c.ajout or maintenant(), maintenant(),
            ),
        ).fetchone()


@router.patch("/cans/{ean}/nb")
def ajuster(ean: str, d: Delta) -> dict:
    # Une seule instruction : pas de « lire puis écrire », donc pas de +1 perdu
    # si deux requêtes arrivent en même temps.
    with base() as cx:
        r = cx.execute(
            f"""UPDATE canettes SET nb = GREATEST(1, nb + %s), maj = %s
                WHERE ean = %s RETURNING {COLONNES}""",
            (d.delta, maintenant(), ean),
        ).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.delete("/cans/{ean}", status_code=204)
def supprimer(ean: str) -> None:
    with base() as cx:
        supprimees = cx.execute("DELETE FROM canettes WHERE ean = %s", (ean,)).rowcount
    if supprimees == 0:
        raise HTTPException(404, "canette inconnue")


app = FastAPI(
    title="StackMonster", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None
)
# Selon la configuration, Vercel transmet le chemin avec ou sans le préfixe /api
# (et le serveur local de développement le garde) : on répond aux deux.
app.include_router(router)
app.include_router(router, prefix="/api")
