"""API StackMonster (Vercel) : connexion par e-mail + code, collection par utilisateur.

Flux : POST /auth/demande {email} envoie un code à 6 chiffres ; POST /auth/verification
{email, code} renvoie un jeton de session (30 jours). Toutes les autres routes exigent
« Authorization: Bearer <session> » et ne voient que la collection de leur propriétaire.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from psycopg.rows import dict_row
from pydantic import BaseModel, Field


def _version() -> str:
    try:
        return (Path(__file__).resolve().parent.parent / "VERSION").read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "0.0.0"


VERSION = _version()
COLONNES = "ean, nom, edition, volume, etat, nb, notes, photo, ajout"
DUREE_CODE, DUREE_SESSION, ESSAIS_MAX, DEMANDES_MAX = 600, 30 * 86400, 5, 5
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

CHAMPS = """ean TEXT NOT NULL, nom TEXT NOT NULL DEFAULT '', edition TEXT NOT NULL DEFAULT '',
    volume TEXT NOT NULL DEFAULT '', etat TEXT NOT NULL DEFAULT '', nb INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '', photo TEXT, ajout TEXT NOT NULL, maj TEXT NOT NULL"""

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS canettes (ean TEXT PRIMARY KEY, nom TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL DEFAULT '', volume TEXT NOT NULL DEFAULT '', etat TEXT NOT NULL DEFAULT '',
    nb INTEGER NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '', photo TEXT,
    ajout TEXT NOT NULL, maj TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, cree BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS codes (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL, hash TEXT NOT NULL,
    expire BIGINT NOT NULL, essais INTEGER NOT NULL DEFAULT 0, cree BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS codes_email ON codes (email);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expire BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS collection (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    {CHAMPS}, PRIMARY KEY (user_id, ean));
"""
# « canettes » est la table historique (collection unique) : scripts/migrer.py y écrit encore,
# et elle est reprise dans la collection de OWNER_EMAIL à sa toute première connexion.


class Canette(BaseModel):
    ean: str = Field(min_length=1, max_length=64)
    nom: str = ""
    edition: str = ""
    volume: str = ""
    etat: str = ""
    nb: int = Field(default=1, ge=1, le=9999)
    notes: str = ""
    photo: str | None = Field(default=None, max_length=300_000)
    ajout: str = ""


class Delta(BaseModel):
    delta: int = Field(ge=-99, le=99)


class Demande(BaseModel):
    email: str = Field(max_length=254)


class Verification(Demande):
    code: str = Field(min_length=6, max_length=6)


# --- base --------------------------------------------------------------------

_schema_pret = False


def _url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise HTTPException(503, "DATABASE_URL non configurée")
    return url


def _creer_schema(cx: psycopg.Connection) -> None:
    global _schema_pret
    if _schema_pret:
        return
    cx.execute("SELECT pg_advisory_xact_lock(7305)")
    cx.execute(SCHEMA)
    cx.commit()
    _schema_pret = True


@contextmanager
def base() -> Iterator[psycopg.Connection]:
    with psycopg.connect(_url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=10) as cx:
        _creer_schema(cx)
        yield cx


def maintenant() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


# --- e-mail et sessions --------------------------------------------------------


def _secret() -> bytes:
    s = os.environ.get("SESSION_SECRET", "")
    if not s:
        raise HTTPException(503, "SESSION_SECRET non configuré")
    return s.encode()


def _hash_code(email: str, code: str) -> str:
    return hmac.new(_secret(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def _hash_session(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def envoyer_code(email: str, code: str) -> None:
    cle = os.environ.get("RESEND_API_KEY")
    if not cle:
        if os.environ.get("AUTH_DEV") == "1":
            print(f"[dev] code de connexion pour {email} : {code}", flush=True)
            return
        raise HTTPException(503, "envoi d'e-mail non configuré")
    corps = {
        "from": os.environ.get("MAIL_FROM", "StackMonster <onboarding@resend.dev>"),
        "to": [email],
        "subject": f"Ton code StackMonster : {code}",
        "text": f"Ton code de connexion : {code}\nIl est valable 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore ce message.",
    }
    req = urllib.request.Request(
        "https://api.resend.com/emails", data=json.dumps(corps).encode(), method="POST",
        headers={"Authorization": f"Bearer {cle}", "Content-Type": "application/json", "User-Agent": "stackmonster/1"},
    )
    try:
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:
        raise HTTPException(502, "envoi d'e-mail impossible") from None


def _est_proprietaire(email: str) -> bool:
    proprio = os.environ.get("OWNER_EMAIL", "").strip().lower()
    return bool(proprio) and email == proprio


def utilisateur(authorization: str | None = Header(default=None)) -> dict:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token:
        h = _hash_session(token)
        with base() as cx:
            u = cx.execute(
                "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.hash = %s AND s.expire > %s", (h, int(time.time())),
            ).fetchone()
        if u:
            return {**u, "hash": h}
    raise HTTPException(401, "connexion requise")


# --- routes publiques : connexion ----------------------------------------------

auth = APIRouter(prefix="/auth")


@auth.post("/demande")
def demande(d: Demande) -> dict:
    email = d.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "adresse invalide")
    now = int(time.time())
    code = f"{secrets.randbelow(10**6):06d}"
    with base() as cx:
        cx.execute("DELETE FROM codes WHERE expire < %s", (now,))
        cx.execute("DELETE FROM sessions WHERE expire < %s", (now,))
        n = cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s AND cree > %s", (email, now - 3600)).fetchone()["n"]
        if n >= DEMANDES_MAX:
            raise HTTPException(429, "trop de demandes")
        cx.execute("INSERT INTO codes (email, hash, expire, cree) VALUES (%s, %s, %s, %s)",
                   (email, _hash_code(email, code), now + DUREE_CODE, now))
    envoyer_code(email, code)
    return {"ok": True}  # même réponse que l'adresse existe ou non


@auth.post("/verification")
def verification(v: Verification) -> dict:
    email, now = v.email.strip().lower(), int(time.time())
    with base() as cx:
        c = cx.execute("SELECT id, hash, essais FROM codes WHERE email = %s AND expire > %s ORDER BY id DESC LIMIT 1",
                       (email, now)).fetchone()
        if not c or c["essais"] >= ESSAIS_MAX:
            raise HTTPException(401, "code invalide ou expiré")
        cx.execute("UPDATE codes SET essais = essais + 1 WHERE id = %s", (c["id"],))
        cx.commit()  # le compteur d'essais doit survivre à l'erreur qui suit
        if not hmac.compare_digest(c["hash"], _hash_code(email, v.code)):
            raise HTTPException(401, "code invalide ou expiré")
        cx.execute("DELETE FROM codes WHERE email = %s", (email,))
        u = cx.execute("INSERT INTO users (email, cree) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING RETURNING id",
                       (email, now)).fetchone()
        if u:  # premier passage : le propriétaire récupère la collection historique
            if _est_proprietaire(email):
                cx.execute(
                    f"INSERT INTO collection (user_id, {COLONNES}, maj) SELECT %s, {COLONNES}, maj FROM canettes ON CONFLICT DO NOTHING",
                    (u["id"],))
        else:
            u = cx.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        token = secrets.token_urlsafe(32)
        cx.execute("INSERT INTO sessions (hash, user_id, expire) VALUES (%s, %s, %s)",
                   (_hash_session(token), u["id"], now + DUREE_SESSION))
    return {"token": token, "email": email}


# --- routes protégées : la collection de l'utilisateur connecté -----------------

router = APIRouter(dependencies=[Depends(utilisateur)])


@router.get("/auth/moi")
def moi(u: dict = Depends(utilisateur)) -> dict:
    return {"email": u["email"]}


@router.post("/auth/deconnexion", status_code=204)
def deconnexion(u: dict = Depends(utilisateur)) -> None:
    with base() as cx:
        cx.execute("DELETE FROM sessions WHERE hash = %s", (u["hash"],))


@router.get("/health")
def sante(u: dict = Depends(utilisateur)) -> dict:
    with base() as cx:
        n = cx.execute("SELECT COUNT(*) AS n FROM collection WHERE user_id = %s", (u["id"],)).fetchone()["n"]
    return {"status": "ok", "version": VERSION, "canettes": n}


@router.get("/stats")
def statistiques(u: dict = Depends(utilisateur)) -> dict:
    """Chiffres globaux de l'application, réservés à OWNER_EMAIL (403 pour les autres)."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with base() as cx:
        n_users = cx.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        t = cx.execute("SELECT COUNT(*) AS refs, COALESCE(SUM(nb), 0) AS total FROM collection").fetchone()
    return {"utilisateurs": n_users, "references": t["refs"], "canettes": int(t["total"])}


@router.get("/cans")
def liste(u: dict = Depends(utilisateur)) -> list[dict]:
    with base() as cx:
        return cx.execute(f"SELECT {COLONNES} FROM collection WHERE user_id = %s ORDER BY ajout DESC", (u["id"],)).fetchall()


@router.get("/cans/{ean}")
def lire(ean: str, u: dict = Depends(utilisateur)) -> dict:
    with base() as cx:
        r = cx.execute(f"SELECT {COLONNES} FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.put("/cans")
def enregistrer(c: Canette, u: dict = Depends(utilisateur)) -> dict:
    with base() as cx:
        return cx.execute(
            f"""INSERT INTO collection (user_id, ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, ean) DO UPDATE SET
                  nom=EXCLUDED.nom, edition=EXCLUDED.edition, volume=EXCLUDED.volume, etat=EXCLUDED.etat,
                  nb=EXCLUDED.nb, notes=EXCLUDED.notes, photo=EXCLUDED.photo, maj=EXCLUDED.maj
                RETURNING {COLONNES}""",
            (u["id"], c.ean, c.nom, c.edition, c.volume, c.etat, c.nb, c.notes, c.photo,
             c.ajout or maintenant(), maintenant()),
        ).fetchone()


@router.patch("/cans/{ean}/nb")
def ajuster(ean: str, d: Delta, u: dict = Depends(utilisateur)) -> dict:
    with base() as cx:
        r = cx.execute(
            f"UPDATE collection SET nb = GREATEST(1, nb + %s), maj = %s WHERE user_id = %s AND ean = %s RETURNING {COLONNES}",
            (d.delta, maintenant(), u["id"], ean)).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.delete("/cans/{ean}", status_code=204)
def supprimer(ean: str, u: dict = Depends(utilisateur)) -> None:
    with base() as cx:
        n = cx.execute("DELETE FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).rowcount
    if n == 0:
        raise HTTPException(404, "canette inconnue")


app = FastAPI(title="StackMonster", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
for r in (auth, router):  # avec et sans le préfixe /api (selon ce que Vercel transmet)
    app.include_router(r)
    app.include_router(r, prefix="/api")
