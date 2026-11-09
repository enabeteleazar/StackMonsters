"""API StackMonster (Vercel) : connexion par e-mail + code, collection par utilisateur.

Flux : POST /auth/demande {email} envoie un code à 6 chiffres ; POST /auth/verification
{email, code} renvoie un jeton de session (30 jours). Toutes les autres routes exigent
« Authorization: Bearer <session> » et ne voient que la collection de leur propriétaire.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Literal

import psycopg
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, Response
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, field_validator


def _version() -> str:
    try:
        return (Path(__file__).resolve().parent.parent / "VERSION").read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "0.0.0"


VERSION = _version()
logger = logging.getLogger(__name__)
COLONNES = "ean, nom, edition, volume, etat, nb, notes, photo, ajout"
COLONNES_COLLECTION = (
    "c.ean, c.nom, c.edition, c.volume, c.etat, c.nb, c.notes, c.ajout, "
    "CASE WHEN c.photo IS NULL THEN NULL ELSE c.maj END AS photo_version, "
    "COALESCE(NULLIF(w.categorie, ''), w.gamme, '') AS categorie, "
    "COALESCE(w.flavor, '') AS flavor, COALESCE(w.status, '') AS status, COALESCE(w.region, '') AS region"
)
# Réponses de l'API : les octets des photos sont servis à part (/cans/{ean}/photo).
COLONNES_REPONSE = (
    "ean, nom, edition, volume, etat, nb, notes, ajout, "
    "CASE WHEN photo IS NULL THEN NULL ELSE maj END AS photo_version"
)
DUREE_CODE, DUREE_SESSION, ESSAIS_MAX, DEMANDES_MAX = 600, 30 * 86400, 5, 5
FENETRE_DEMANDES = 3600
DEMANDES_MAX_IP, VERIFICATIONS_MAX_IP = 20, 60
DUREE_EMPREINTES_IP = 395 * 86400  # 13 mois : durée de conservation annoncée dans la politique de confidentialité
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Les photos sont stockées en data URL ; seuls ces formats sont servis par /wiki/{ean}/photo.
PHOTO_RE = re.compile(r"^data:(image/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$")
CODE_LOCAL_RE = re.compile(r"^LOCAL-[A-Z0-9]{1,40}$")


def _photo_valide(photo: str) -> bool:
    m = PHOTO_RE.match(photo)
    if not m:
        return False
    try:
        base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        return False
    return True


def _normaliser_code(code: str) -> str | None:
    """Forme canonique d'un code-barres : UPC-A complété à 13 chiffres, EAN-8 inchangé ; None si invalide."""
    if CODE_LOCAL_RE.match(code):
        return code
    if not re.fullmatch(r"[0-9]{8}|[0-9]{12,13}", code):
        return None
    total = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(reversed(code[:-1])))
    if (10 - total % 10) % 10 != int(code[-1]):
        return None
    return f"0{code}" if len(code) == 12 else code

CHAMPS = """ean TEXT NOT NULL, nom TEXT NOT NULL DEFAULT '', edition TEXT NOT NULL DEFAULT '',
    volume TEXT NOT NULL DEFAULT '', etat TEXT NOT NULL DEFAULT '', nb INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '', photo TEXT, ajout TEXT NOT NULL, maj TEXT NOT NULL"""

# Migrations versionnées, appliquées uniquement par scripts/migrer_schema.py : à ajouter à la fin, sans jamais
# modifier une version déjà déployée. Chacune tourne une seule fois, dans la transaction du script.
MIGRATIONS: list[tuple[int, str]] = [
    (1, f"""
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
CREATE TABLE IF NOT EXISTS connexions_uniques (ip_hash TEXT PRIMARY KEY, premiere_connexion BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS limites_ip (cle TEXT PRIMARY KEY, debut BIGINT NOT NULL, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS collection (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    {CHAMPS}, PRIMARY KEY (user_id, ean));
CREATE TABLE IF NOT EXISTS wiki (ean TEXT PRIMARY KEY, nom TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL DEFAULT '', volume TEXT NOT NULL DEFAULT '',
    gamme TEXT NOT NULL DEFAULT '',
    categorie TEXT NOT NULL DEFAULT '', flavor TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
    pays TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    photo TEXT, cree TEXT NOT NULL, maj TEXT NOT NULL);
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS edition TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS gamme TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS categorie TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS flavor TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
"""),
    # Codes-barres retirés du Wiki : une fiche supprimée ou renommée ne doit pas être recréée.
    (2, "CREATE TABLE IF NOT EXISTS wiki_exclus (ean TEXT PRIMARY KEY, exclu TEXT NOT NULL);"),
    (3, """UPDATE wiki SET categorie = gamme, gamme = '' WHERE categorie = '' AND gamme <> '';
INSERT INTO wiki (ean, nom, edition, volume, cree, maj)
    SELECT DISTINCT ON (ean) ean, nom, edition, volume, ajout, maj FROM collection
    WHERE NOT EXISTS (SELECT 1 FROM wiki) AND ean NOT LIKE 'LOCAL-%'
    ORDER BY ean, (nom = ''), maj;
"""),
]
# « wiki » est le catalogue partagé : une fiche par EAN, sans propriétaire ni donnée de collection
# (ni quantité, ni état, ni notes). Il est rempli à l'ajout d'une canette ; à la première création de
# la table, il est amorcé depuis les collections existantes.
# « canettes » est la table historique (collection unique) : scripts/migrer.py y écrit encore,
# et elle est reprise dans la collection de OWNER_EMAIL à sa toute première connexion.


class Canette(BaseModel):
    ean: str = Field(min_length=1, max_length=64)
    nom: str = Field(default="", max_length=200)
    edition: str = Field(default="", max_length=200)
    volume: str = Field(default="", max_length=40)
    categorie: str = Field(default="", max_length=80)
    flavor: str = Field(default="", max_length=200)
    status: Literal["", "Active", "Stop"] = ""
    region: str = Field(default="", max_length=80)
    etat: str = Field(default="", max_length=40)
    nb: int = Field(default=1, ge=1, le=9999)
    notes: str = Field(default="", max_length=4000)
    photo: str | None = Field(default=None, max_length=300_000)
    ajout: str = ""

    @field_validator("photo")
    @classmethod
    def verifier_photo(cls, photo: str | None) -> str | None:
        if photo is not None and not _photo_valide(photo):
            raise ValueError("format de photo refusé")
        return photo


class FicheWiki(BaseModel):
    """Champs d'une fiche du Wiki modifiables par le propriétaire."""

    ean: str | None = Field(default=None, min_length=1, max_length=64)
    nom: str = Field(default="", max_length=200)
    edition: str | None = Field(default=None, max_length=200)
    volume: str = Field(default="", max_length=40)
    categorie: str = Field(default="", max_length=80)
    flavor: str = Field(default="", max_length=200)
    status: Literal["", "Active", "Stop"] = ""
    region: str = Field(default="", max_length=80)
    pays: str = Field(default="", max_length=80)
    description: str = Field(default="", max_length=4000)


class PhotoFiche(BaseModel):
    photo: str = Field(max_length=300_000)


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


def appliquer_migrations(cx: psycopg.Connection) -> list[int]:
    """Applique les migrations manquantes, dans une seule transaction que l'appelant valide."""
    cx.execute("SELECT pg_advisory_xact_lock(7305)")
    cx.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, appliquee TEXT NOT NULL)")
    faites = {r["version"] for r in cx.execute("SELECT version FROM schema_migrations").fetchall()}
    appliquees = []
    for version, sql in MIGRATIONS:
        if version not in faites:
            cx.execute(sql)
            cx.execute("INSERT INTO schema_migrations (version, appliquee) VALUES (%s, %s)", (version, maintenant()))
            appliquees.append(version)
    return appliquees


def _verifier_schema(cx: psycopg.Connection) -> None:
    """Lecture seule, une fois par instance : l'API ne modifie jamais le schéma au démarrage."""
    global _schema_pret
    if _schema_pret:
        return
    existe = cx.execute("SELECT to_regclass('schema_migrations') AS t").fetchone()["t"]
    version = 0
    if existe:
        version = cx.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").fetchone()["v"]
    cx.commit()
    if version < MIGRATIONS[-1][0]:
        logger.error("Schéma en version %d, attendu %d : lancer scripts/migrer_schema.py", version, MIGRATIONS[-1][0])
        raise HTTPException(503, "Base de données à mettre à jour.")
    _schema_pret = True


def connecter() -> psycopg.Connection:
    try:
        return psycopg.connect(
            _url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=10,
        )
    except psycopg.OperationalError as exc:
        logger.warning("Connexion PostgreSQL impossible (%s)", type(exc).__name__)
        detail = "Connexion PostgreSQL impossible. Vérifie DATABASE_URL et l'accès à Neon."
        if "password authentication failed" in str(exc).lower():
            detail = "Identifiants PostgreSQL refusés. Actualise DATABASE_URL depuis Neon."
        raise HTTPException(503, detail) from None


@contextmanager
def base() -> Iterator[psycopg.Connection]:
    with connecter() as cx:
        _verifier_schema(cx)
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


def _adresse_ip(request: Request) -> str | None:
    candidates = [
        request.headers.get("x-real-ip", ""),
        request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip(),
        request.client.host if request.client else "",
    ]
    for candidate in candidates:
        try:
            adresse = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        if isinstance(adresse, ipaddress.IPv6Address) and adresse.ipv4_mapped:
            adresse = adresse.ipv4_mapped
        return str(adresse)
    return None


def _empreinte_ip(adresse: str) -> str:
    return hmac.new(_secret(), f"unique-ip:{adresse}".encode(), hashlib.sha256).hexdigest()


def _limiter_ip(cx: psycopg.Connection, request: Request, action: str, maximum: int, now: int) -> None:
    """Compte l'appel pour cette IP (fenêtre fixe d'une heure) et répond 429 au-delà du maximum."""
    adresse = _adresse_ip(request)
    if not adresse:
        return
    if ":" in adresse:  # un abonné IPv6 dispose en général d'un /64 entier
        adresse = str(ipaddress.ip_network(f"{adresse}/64", strict=False).network_address)
    cle = hmac.new(_secret(), f"limite-ip:{action}:{adresse}".encode(), hashlib.sha256).hexdigest()
    expiree = now - FENETRE_DEMANDES
    n = cx.execute(
        """INSERT INTO limites_ip (cle, debut, n) VALUES (%s, %s, 1)
           ON CONFLICT (cle) DO UPDATE SET
             n = CASE WHEN limites_ip.debut <= %s THEN 1 ELSE limites_ip.n + 1 END,
             debut = CASE WHEN limites_ip.debut <= %s THEN EXCLUDED.debut ELSE limites_ip.debut END
           RETURNING n, debut""",
        (cle, now, expiree, expiree),
    ).fetchone()
    cx.commit()  # le compteur doit survivre au 429 qui suit
    if n["n"] > maximum:
        raise _trop_de_tentatives(n["debut"] + FENETRE_DEMANDES - now)


def _trop_de_tentatives(attente: int) -> HTTPException:
    """429 commun à toutes les limites, avec le délai réel avant de pouvoir réessayer."""
    return HTTPException(429, "trop de tentatives", headers={"Retry-After": str(max(1, attente))})


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
    except urllib.error.HTTPError as exc:
        logger.warning("Resend a refusé l'envoi du code (HTTP %d)", exc.code)
        if exc.code in (401, 403):
            raise HTTPException(
                503,
                "Configuration Resend invalide : vérifie RESEND_API_KEY et MAIL_FROM. "
                "L'expéditeur onboarding@resend.dev ne livre qu'à l'adresse du compte Resend.",
            ) from None
        if exc.code == 422:
            raise HTTPException(422, "Adresse e-mail refusée par le fournisseur.") from None
        raise HTTPException(502, "Le fournisseur d'e-mail a refusé l'envoi.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("Service Resend injoignable (%s)", type(exc).__name__)
        raise HTTPException(502, "envoi d'e-mail impossible") from None


def _est_proprietaire(email: str) -> bool:
    proprio = os.environ.get("OWNER_EMAIL", "").strip().lower()
    return bool(proprio) and email == proprio


def _jeton(authorization: str | None) -> str:
    return (authorization or "").removeprefix("Bearer ").strip()


def connexion(authorization: str | None = Header(default=None)) -> Iterator[psycopg.Connection]:
    """Unique connexion d'une requête protégée ; sans jeton, la base n'est même pas contactée."""
    if not _jeton(authorization):
        raise HTTPException(401, "connexion requise")
    with base() as cx:
        yield cx


def utilisateur(
    authorization: str | None = Header(default=None), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    h = _hash_session(_jeton(authorization))
    u = cx.execute(
        "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.hash = %s AND s.expire > %s", (h, int(time.time())),
    ).fetchone()
    cx.commit()  # les routes ouvrent ensuite leur propre transaction
    if u:
        return {**u, "hash": h}
    raise HTTPException(401, "connexion requise")


# --- routes publiques : connexion ----------------------------------------------

auth = APIRouter(prefix="/auth")


@auth.post("/demande")
def demande(d: Demande, request: Request) -> dict:
    email = d.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "adresse invalide")
    now = int(time.time())
    code = f"{secrets.randbelow(10**6):06d}"
    with base() as cx:
        _limiter_ip(cx, request, "demande", DEMANDES_MAX_IP, now)
        cx.execute("DELETE FROM limites_ip WHERE debut <= %s", (now - FENETRE_DEMANDES,))
        # Un code expiré compte encore dans la limite : il n'est purgé qu'une fois la fenêtre passée.
        cx.execute("DELETE FROM codes WHERE cree <= %s", (now - FENETRE_DEMANDES,))
        cx.execute("DELETE FROM sessions WHERE expire < %s", (now,))
        cx.execute("DELETE FROM connexions_uniques WHERE premiere_connexion < %s", (now - DUREE_EMPREINTES_IP,))
        recentes = cx.execute(
            "SELECT COUNT(*) AS n, MIN(cree) AS premiere FROM codes WHERE email = %s AND cree > %s",
            (email, now - FENETRE_DEMANDES),
        ).fetchone()
        if recentes["n"] >= DEMANDES_MAX:
            raise _trop_de_tentatives(recentes["premiere"] + FENETRE_DEMANDES - now)
        code_row = cx.execute(
            "INSERT INTO codes (email, hash, expire, cree) VALUES (%s, %s, %s, %s) RETURNING id",
            (email, _hash_code(email, code), now + DUREE_CODE, now),
        ).fetchone()
    try:
        envoyer_code(email, code)
    except HTTPException:
        with base() as cx:
            cx.execute("DELETE FROM codes WHERE id = %s", (code_row["id"],))
        raise
    return {"ok": True}  # même réponse que l'adresse existe ou non


@auth.post("/verification")
def verification(v: Verification, request: Request) -> dict:
    email, now = v.email.strip().lower(), int(time.time())
    with base() as cx:
        # Avant de consommer un essai : une IP bloquée ne peut pas épuiser les essais d'un autre compte.
        _limiter_ip(cx, request, "verification", VERIFICATIONS_MAX_IP, now)
        # Vérification et incrément en une seule requête : des appels simultanés ne dépassent pas la limite.
        c = cx.execute(
            "UPDATE codes SET essais = essais + 1 WHERE essais < %s AND id = ("
            "SELECT id FROM codes WHERE email = %s AND expire > %s ORDER BY id DESC LIMIT 1"
            ") RETURNING id, hash",
            (ESSAIS_MAX, email, now),
        ).fetchone()
        cx.commit()  # le compteur d'essais doit survivre à l'erreur qui suit
        if not c:
            raise HTTPException(401, "code invalide ou expiré")
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
        adresse = _adresse_ip(request)
        if adresse:
            cx.execute(
                "INSERT INTO connexions_uniques (ip_hash, premiere_connexion) VALUES (%s, %s) "
                "ON CONFLICT (ip_hash) DO NOTHING",
                (_empreinte_ip(adresse), now),
            )
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
def deconnexion(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> None:
    with cx.transaction():
        cx.execute("DELETE FROM sessions WHERE hash = %s", (u["hash"],))


@router.post("/auth/deconnexion-partout", status_code=204)
def deconnexion_partout(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> None:
    """Révoque toutes les sessions du compte, celle-ci comprise."""
    with cx.transaction():
        cx.execute("DELETE FROM sessions WHERE user_id = %s", (u["id"],))


@router.delete("/auth/compte", status_code=204)
def supprimer_compte(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> None:
    """Efface le compte, sa collection et ses sessions ; le Wiki, anonyme, est conservé."""
    if _est_proprietaire(u["email"]):  # il récupérerait la collection historique à sa prochaine connexion
        raise HTTPException(403, "le compte propriétaire ne peut pas être supprimé")
    with cx.transaction():
        cx.execute("DELETE FROM codes WHERE email = %s", (u["email"],))
        cx.execute("DELETE FROM users WHERE id = %s", (u["id"],))


@router.get("/health")
def sante(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        n = cx.execute("SELECT COUNT(*) AS n FROM collection WHERE user_id = %s", (u["id"],)).fetchone()["n"]
    return {"status": "ok", "version": VERSION, "references": n}


@router.get("/stats")
def statistiques(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Chiffres globaux de l'application, réservés à OWNER_EMAIL (403 pour les autres)."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        n_users = cx.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        t = cx.execute("SELECT COUNT(*) AS refs FROM collection").fetchone()
        n_connexions = cx.execute("SELECT COUNT(*) AS n FROM connexions_uniques").fetchone()["n"]
    return {"utilisateurs": n_users, "references": t["refs"], "connexions_uniques": n_connexions}


def _avec_infos_wiki(cx: psycopg.Connection, canette: dict) -> dict:
    """Ajoute les champs descriptifs du Wiki ; une canette peut ne pas y figurer (LOCAL-, fiche retirée)."""
    w = cx.execute(
        "SELECT categorie, gamme, flavor, status, region FROM wiki WHERE ean = %s", (canette["ean"],),
    ).fetchone() or {}
    return {
        **canette,
        "categorie": w.get("categorie") or w.get("gamme") or "",
        "flavor": w.get("flavor", ""),
        "status": w.get("status", ""),
        "region": w.get("region", ""),
    }


@router.get("/cans")
def liste(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> list[dict]:
    with cx.transaction():
        return cx.execute(
            f"SELECT {COLONNES_COLLECTION} "
            "FROM collection c LEFT JOIN wiki w ON w.ean = c.ean "
            "WHERE c.user_id = %s ORDER BY c.ajout DESC",
            (u["id"],),
        ).fetchall()


@router.get("/cans/{ean}")
def lire(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        r = cx.execute(
            f"SELECT {COLONNES_COLLECTION} "
            "FROM collection c LEFT JOIN wiki w ON w.ean = c.ean "
            "WHERE c.user_id = %s AND c.ean = %s",
            (u["id"], ean),
        ).fetchone()
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.get("/cans/{ean}/photo")
def photo_canette(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> Response:
    """Photo d'une canette de sa propre collection, chargée à la demande."""
    with cx.transaction():
        r = cx.execute("SELECT photo FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).fetchone()
    m = PHOTO_RE.match(r["photo"]) if r and r["photo"] else None
    if not m:
        raise HTTPException(404, "photo inconnue")
    try:
        octets = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(404, "photo illisible") from None
    return Response(
        octets, media_type=m.group(1),
        headers={
            "Cache-Control": "private, max-age=86400", "Vary": "Authorization", "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/cans")
def enregistrer(c: Canette, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        # Une fiche déjà en base reste modifiable telle quelle, même si son code est ancien ou non conforme.
        deja_la = cx.execute("SELECT 1 FROM collection WHERE user_id = %s AND ean = %s", (u["id"], c.ean)).fetchone()
        ean = c.ean if deja_la else _normaliser_code(c.ean)
        if ean is None:
            raise HTTPException(422, "code-barres invalide")
        exclue = cx.execute("SELECT 1 FROM wiki_exclus WHERE ean = %s", (ean,)).fetchone()
        # Le Wiki reçoit les champs descriptifs fournis, sans écraser une fiche existante.
        # Il ne reçoit ni les canettes sans code-barres (LOCAL-), ni les photos : elles restent privées.
        # Une fiche retirée par le propriétaire (wiki_exclus) n'est pas recréée.
        if not ean.startswith("LOCAL-") and not exclue:
            cx.execute(
                """INSERT INTO wiki (ean, nom, edition, volume, categorie, flavor, status, region, cree, maj)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (ean) DO UPDATE SET
                      nom = CASE WHEN wiki.nom = '' THEN EXCLUDED.nom ELSE wiki.nom END,
                      edition = CASE WHEN wiki.edition = '' THEN EXCLUDED.edition ELSE wiki.edition END,
                      volume = CASE WHEN wiki.volume = '' THEN EXCLUDED.volume ELSE wiki.volume END,
                      categorie = CASE WHEN COALESCE(NULLIF(wiki.categorie, ''), wiki.gamme, '') = ''
                                       THEN EXCLUDED.categorie ELSE wiki.categorie END,
                      flavor = CASE WHEN wiki.flavor = '' THEN EXCLUDED.flavor ELSE wiki.flavor END,
                      status = CASE WHEN wiki.status = '' THEN EXCLUDED.status ELSE wiki.status END,
                      region = CASE WHEN wiki.region = '' THEN EXCLUDED.region ELSE wiki.region END,
                      maj = CASE WHEN (wiki.nom = '' AND EXCLUDED.nom <> '')
                                  OR (wiki.edition = '' AND EXCLUDED.edition <> '')
                                  OR (wiki.volume = '' AND EXCLUDED.volume <> '')
                                  OR (COALESCE(NULLIF(wiki.categorie, ''), wiki.gamme, '') = '' AND EXCLUDED.categorie <> '')
                                  OR (wiki.flavor = '' AND EXCLUDED.flavor <> '')
                                  OR (wiki.status = '' AND EXCLUDED.status <> '')
                                  OR (wiki.region = '' AND EXCLUDED.region <> '')
                                 THEN EXCLUDED.maj ELSE wiki.maj END""",
                (ean, c.nom.strip(), c.edition.strip(), c.volume.strip(), c.categorie.strip(), c.flavor.strip(),
                 c.status, c.region.strip(), maintenant(), maintenant()),
            )
        enregistrement = cx.execute(
            f"""INSERT INTO collection (user_id, ean, nom, edition, volume, etat, nb, notes, photo, ajout, maj)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, ean) DO UPDATE SET
                  nom=EXCLUDED.nom, edition=EXCLUDED.edition, volume=EXCLUDED.volume, etat=EXCLUDED.etat,
                  nb=EXCLUDED.nb, notes=EXCLUDED.notes, maj=EXCLUDED.maj,
                  photo = CASE WHEN %s THEN EXCLUDED.photo ELSE collection.photo END
                RETURNING {COLONNES_REPONSE}""",
            (u["id"], ean, c.nom, c.edition, c.volume, c.etat, c.nb, c.notes, c.photo,
             c.ajout or maintenant(), maintenant(), "photo" in c.model_fields_set),  # champ absent : photo conservée
        ).fetchone()
        return _avec_infos_wiki(cx, enregistrement)


@router.patch("/cans/{ean}/nb")
def ajuster(ean: str, d: Delta, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        r = cx.execute(
            f"UPDATE collection SET nb = GREATEST(1, nb + %s), maj = %s WHERE user_id = %s AND ean = %s RETURNING {COLONNES_REPONSE}",
            (d.delta, maintenant(), u["id"], ean)).fetchone()
        if r is not None:
            r = _avec_infos_wiki(cx, r)
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.delete("/cans/{ean}", status_code=204)
def supprimer(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> None:
    with cx.transaction():
        n = cx.execute("DELETE FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).rowcount
    if n == 0:
        raise HTTPException(404, "canette inconnue")


# --- Wiki : catalogue partagé, en lecture pour tous les comptes connectés ---------


COLONNES_FICHE = (
    "ean, nom, edition, volume, categorie, gamme, flavor, status, region, pays, description, "
    "(photo IS NOT NULL) AS a_photo, maj"
)


def _fiche(r: dict) -> dict:
    """Forme publique d'une fiche ; « photo » n'est qu'un marqueur de version."""
    return {
        "ean": r["ean"], "nom": r["nom"], "edition": r["edition"], "volume": r["volume"],
        "categorie": r["categorie"] or r["gamme"], "flavor": r["flavor"], "status": r["status"],
        "region": r["region"], "pays": r["pays"],
        "description": r["description"], "photo": r["maj"] if r["a_photo"] else None,
    }


@router.get("/wiki")
def wiki_liste(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Toutes les fiches, sans les photos (servies à part, pour garder la réponse légère)."""
    with cx.transaction():
        lignes = cx.execute(
            f"SELECT {COLONNES_FICHE} FROM wiki ORDER BY (nom = ''), lower(nom), ean"
        ).fetchall()
    return {"peut_editer": _est_proprietaire(u["email"]), "fiches": [_fiche(r) for r in lignes]}


@router.get("/wiki/{ean}/photo")
def wiki_photo(ean: str, cx: psycopg.Connection = Depends(connexion)) -> Response:
    with cx.transaction():
        r = cx.execute("SELECT photo FROM wiki WHERE ean = %s", (ean,)).fetchone()
    m = PHOTO_RE.match(r["photo"]) if r and r["photo"] else None
    if not m:
        raise HTTPException(404, "photo inconnue")
    try:
        octets = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(404, "photo illisible") from None
    return Response(
        octets, media_type=m.group(1),
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )


@router.put("/wiki/{ean}/photo")
def wiki_photo_remplacer(ean: str, p: PhotoFiche, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Ajoute ou remplace la photo d'une fiche : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    if not _photo_valide(p.photo):
        raise HTTPException(422, "format de photo refusé")
    with cx.transaction():
        r = cx.execute(
            f"UPDATE wiki SET photo = %s, maj = %s WHERE ean = %s RETURNING {COLONNES_FICHE}",
            (p.photo, maintenant(), ean),
        ).fetchone()
    if r is None:
        raise HTTPException(404, "fiche inconnue")
    return _fiche(r)


@router.delete("/wiki/{ean}/photo")
def wiki_photo_retirer(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Retire la photo d'une fiche sans toucher au reste : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        r = cx.execute(
            f"UPDATE wiki SET photo = NULL, maj = %s WHERE ean = %s RETURNING {COLONNES_FICHE}",
            (maintenant(), ean),
        ).fetchone()
    if r is None:
        raise HTTPException(404, "fiche inconnue")
    return _fiche(r)


@router.put("/wiki/{ean}")
def wiki_modifier(ean: str, f: FicheWiki, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Complète ou corrige une fiche (pays, description…) : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    nouvel_ean = f.ean.strip() if f.ean is not None else ean
    if not nouvel_ean:
        raise HTTPException(422, "code-barres obligatoire")
    if nouvel_ean != ean:
        nouvel_ean = _normaliser_code(nouvel_ean)
        if nouvel_ean is None:
            raise HTTPException(422, "code-barres invalide")
    with cx.transaction():
        if nouvel_ean != ean:
            cible = cx.execute("SELECT 1 FROM wiki WHERE ean = %s", (nouvel_ean,)).fetchone()
            if cible is not None:
                raise HTTPException(409, "ce code-barres existe déjà dans le Wiki")
        r = cx.execute(
            "UPDATE wiki SET ean = %s, nom = %s, edition = COALESCE(%s, edition), "
            "volume = %s, categorie = %s, flavor = %s, status = %s, region = %s, "
            "pays = %s, description = %s, maj = %s "
            f"WHERE ean = %s RETURNING {COLONNES_FICHE}",
            (nouvel_ean, f.nom.strip(), f.edition.strip() if f.edition is not None else None,
             f.volume.strip(), f.categorie.strip(), f.flavor.strip(), f.status, f.region.strip(), f.pays.strip(),
             f.description.strip(), maintenant(), ean),
        ).fetchone()
        if r is None:
            raise HTTPException(404, "fiche inconnue")
        if nouvel_ean != ean:
            # Les collections suivent la fiche ; un compte qui possède déjà le nouveau code garde ses deux lignes.
            cx.execute(
                "UPDATE collection c SET ean = %s, maj = %s WHERE c.ean = %s AND NOT EXISTS "
                "(SELECT 1 FROM collection d WHERE d.user_id = c.user_id AND d.ean = %s)",
                (nouvel_ean, maintenant(), ean, nouvel_ean),
            )
            cx.execute("DELETE FROM wiki_exclus WHERE ean = %s", (nouvel_ean,))
            cx.execute(
                "INSERT INTO wiki_exclus (ean, exclu) VALUES (%s, %s) ON CONFLICT (ean) DO NOTHING",
                (ean, maintenant()),
            )
    return _fiche(r)


@router.delete("/wiki/{ean}", status_code=204)
def wiki_supprimer(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> Response:
    """Supprime une fiche du catalogue partagé : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        n = cx.execute("DELETE FROM wiki WHERE ean = %s", (ean,)).rowcount
        if n:
            cx.execute(
                "INSERT INTO wiki_exclus (ean, exclu) VALUES (%s, %s) ON CONFLICT (ean) DO NOTHING",
                (ean, maintenant()),
            )
    if n == 0:
        raise HTTPException(404, "fiche inconnue")
    return Response(status_code=204)


app = FastAPI(title="StackMonster", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
for r in (auth, router):  # avec et sans le préfixe /api (selon ce que Vercel transmet)
    app.include_router(r)
    app.include_router(r, prefix="/api")
