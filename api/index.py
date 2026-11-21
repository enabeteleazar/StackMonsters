"""API StackMonsters (Vercel) : connexion par e-mail + code, collection par utilisateur.

Flux : POST /auth/demande {email} envoie un code à 6 chiffres ; POST /auth/verification
{email, code} renvoie un jeton de session (30 jours). Toutes les autres routes exigent
« Authorization: Bearer <session> » et ne voient que la collection de leur propriétaire.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import importlib.util
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
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from pydantic import BaseModel, Field, field_validator

# convert.py (à la racine du dépôt) fabrique les codes internes « 20… » à partir d'un nom.
_spec = importlib.util.spec_from_file_location("convert", Path(__file__).resolve().parent.parent / "convert.py")
convert = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(convert)


def _version() -> str:
    """Numéro de version, lu dans package.json : une seule source pour le front et l'API."""
    try:
        paquet = json.loads((Path(__file__).resolve().parent.parent / "package.json").read_text(encoding="utf-8"))
        return str(paquet.get("version") or "0.0.0")
    except (FileNotFoundError, ValueError):
        return "0.0.0"


VERSION = _version()
logger = logging.getLogger(__name__)
COLONNES = "ean, nom, volume, etat, nb, notes, photo, ajout"
DUREE_NOUVEAUTE = 30 * 86400


def _statut(prefixe: str) -> str:
    """Statut affiché : une « Nouveauté » de plus de 30 jours redevient « Active », sans tâche planifiée."""
    return (
        f"CASE WHEN {prefixe}status = 'Nouveauté' AND COALESCE({prefixe}nouveaute_depuis, 0) "
        f"< extract(epoch FROM now()) - {DUREE_NOUVEAUTE} THEN 'Active' ELSE {prefixe}status END"
    )


# Une canette de la collection affiche les informations de sa fiche du Wiki (nom, édition, volume,
# description, photo...). Ses propres valeurs ne servent que lorsque le Wiki n'en a pas
# (canette LOCAL-, fiche retirée, champ vide). État, quantité et notes restent personnels.
COLONNES_COLLECTION = (
    "c.ean, COALESCE(NULLIF(w.nom, ''), c.nom) AS nom, "
    "COALESCE(NULLIF(w.volume, ''), c.volume) AS volume, c.etat, c.nb, c.notes, c.ajout, "
    "CASE WHEN w.photo IS NOT NULL THEN 'wiki-' || w.maj WHEN c.photo IS NOT NULL THEN c.maj END AS photo_version, "
    "COALESCE(w.photo IS NOT NULL, false) AS photo_wiki, (w.ean IS NOT NULL) AS dans_wiki, "
    "COALESCE(w.description, '') AS description, "
    "COALESCE(NULLIF(w.categorie, ''), w.gamme, '') AS categorie, "
    "COALESCE(w.flavor, '') AS flavor, COALESCE(" + _statut("w.") + ", '') AS status, COALESCE(w.region, '') AS region, "
    "COALESCE(w.variante, '') AS variante, "
    "(SELECT u.partage_doubles FROM users u WHERE u.id = c.user_id) AS partage_doubles, "
    "(SELECT COUNT(*) FROM recherches r WHERE r.fiche = w.ean) AS recherches"
)
# Fiche du Wiki d'une ligne de collection : par son code, par la fiche dont c'est un code secondaire,
# ou par celle qui a remplacé ce code (wiki_exclus.vers).
JOINTURE_WIKI = (
    "LEFT JOIN wiki w ON w.ean = COALESCE((SELECT k.fiche FROM wiki_codes k WHERE k.ean = c.ean), "
    "(SELECT x.vers FROM wiki_exclus x WHERE x.ean = c.ean), c.ean)"
)
DUREE_CODE, ESSAIS_MAX, DEMANDES_MAX = 600, 5, 5
# Sessions (issue #4, voir « Sessions » dans le README) : expiration glissante après 30 jours sans utilisation,
# 90 jours au plus après la connexion, jeton renouvelé une fois par jour d'usage. L'ancien jeton reste
# valable quelques minutes après son remplacement (requêtes déjà parties, autre onglet).
INACTIVITE_SESSION, DUREE_MAX_SESSION = 30 * 86400, 90 * 86400
ROTATION_SESSION, GRACE_ROTATION = 86400, 600
PROLONGATION_MIN = 3600  # une session n'est réécrite en base qu'une fois par heure d'usage au plus
FENETRE_DEMANDES = 3600
DEMANDES_MAX_IP, VERIFICATIONS_MAX_IP = 20, 60
# Limites complémentaires (issue #2). Voir « Limites anti-abus » dans le README pour les seuils et le déblocage.
FENETRE_JOUR = 86400
DEMANDES_MAX_IP_JOUR = 60  # demandes de code par IP sur 24 h ; SM_DEMANDES_MAX_IP(_JOUR) pour l'heure et le jour
COMPTES_MAX_IP_JOUR = 5  # nouveaux comptes par IP sur 24 h ; SM_COMPTES_MAX_IP_JOUR
DEMANDES_MAX_HEURE, COMPTES_MAX_HEURE = 300, 30  # tous visiteurs confondus ; SM_DEMANDES_MAX_HEURE, SM_COMPTES_MAX_HEURE
INSCRIPTIONS_LIMITEES = "inscriptions limitées"
DUREE_EMPREINTES_IP = 395 * 86400  # 13 mois : durée de conservation annoncée dans la politique de confidentialité
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Les photos sont stockées en data URL ; seuls ces formats sont servis par /wiki/{ean}/photo.
PHOTO_RE = re.compile(r"^data:(image/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$")
CODE_LOCAL_RE = re.compile(r"^LOCAL-[A-Z0-9]{1,40}$")
# Préfixe GS1 « 20 » (usage interne) : codes inventés pour les fiches du Wiki dont on ignore le vrai
# code-barres (voir convert.py). Aucun produit du commerce ne le porte.
CODE_INTERNE_RE = re.compile(r"^20[0-9]{11}$")


def _photo_valide(photo: str) -> bool:
    m = PHOTO_RE.match(photo)
    if not m:
        return False
    try:
        base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        return False
    return True


# Début de mot : début du nom, ou lettre précédée d'un espace, tiret, barre, point ou parenthèse.
DEBUT_MOT_RE = re.compile(r"(^|[\s\-/.(\[])(\w)")


# Fiches normalisées (issue #5, voir « Champs d'une fiche » dans le README). Mêmes listes que src/categories.ts
# (un test vérifie qu'elles restent identiques).
CATEGORIES = ("Original", "Ultra", "Juiced", "Reserve", "Special", "Java", "Killer Brew", "Rehab", "Nitro", "Water",
              "Asia")
REGIONS = ("Global", "US", "Canada", "Europe", "Europe/Aus", "US/Global", "Japan")
VARIANTES = ("Standard", "Zero Sugar", "Shot", "Édition limitée", "Collaboration")
SAVEUR_MAX = 60
VOLUME_RE = re.compile(r"^\s*(\d{2,4})(?:[.,]\d+)?\s*(ml|oz|fl\.?\s*oz)?\s*$", re.IGNORECASE)
VOLUME_NORMAL_RE = re.compile(r"^\d{2,4} ml$")


def normaliser_volume(texte: str) -> str | None:
    """« 500 », « 500ml », « 16 oz » → « 500 ml » / « 473 ml » ; chaîne vide gardée ; None si illisible."""
    if not texte.strip():
        return ""
    m = VOLUME_RE.match(texte)
    if not m:
        return None
    n = int(m.group(1))
    if m.group(2) and m.group(2).lower() != "ml":
        n = round(n * 29.5735)  # once liquide américaine
    return f"{n} ml" if 50 <= n <= 3000 else None


def _valeur_controlee(valeur: str, permises: tuple[str, ...], champ: str) -> str:
    valeur = valeur.strip()
    if valeur and valeur not in permises:
        raise ValueError(f"{champ} inconnu(e) : {valeur}")
    return valeur


def _a_reprendre(r: dict) -> list[str]:
    """Champs d'une fiche ancienne hors des valeurs contrôlées (à corriger par le propriétaire)."""
    champs = []
    if r["volume"] and not VOLUME_NORMAL_RE.match(r["volume"]):
        champs.append("volume")
    if len(r["flavor"]) > SAVEUR_MAX:
        champs.append("saveur")
    if (r["categorie"] or r["gamme"]) and (r["categorie"] or r["gamme"]) not in CATEGORIES:
        champs.append("catégorie")
    if r["region"] and r["region"] not in REGIONS:
        champs.append("pays")
    return champs


class ChampsControles(BaseModel):
    """Volume en ml, saveur courte, gamme, pays et variante pris dans leurs listes (fiche, proposition)."""

    @field_validator("volume", check_fields=False)
    @classmethod
    def volume_normalise(cls, volume: str) -> str:
        v = normaliser_volume(volume)
        if v is None:
            raise ValueError("volume attendu en ml, entre 50 et 3000 (ex. : 500)")
        return v

    @field_validator("flavor", check_fields=False)
    @classmethod
    def saveur_courte(cls, flavor: str) -> str:
        flavor = " ".join(flavor.split())
        if len(flavor) > SAVEUR_MAX:
            raise ValueError(f"saveur trop longue ({SAVEUR_MAX} caractères au plus) : la description sert aux détails")
        return flavor

    @field_validator("categorie", check_fields=False)
    @classmethod
    def categorie_connue(cls, categorie: str) -> str:
        return _valeur_controlee(categorie, CATEGORIES, "catégorie")

    @field_validator("region", check_fields=False)
    @classmethod
    def region_connue(cls, region: str) -> str:
        return _valeur_controlee(region, REGIONS, "pays")

    @field_validator("variante", check_fields=False)
    @classmethod
    def variante_connue(cls, variante: str) -> str:
        return _valeur_controlee(variante, VARIANTES, "variante")


def formater_nom(nom: str) -> str:
    """Nom d'un produit : espaces superflus retirés et majuscule à chaque mot.

    Seule la première lettre de chaque mot change : « vr46 » devient « Vr46 », mais « USA » reste « USA ».
    """
    nom = " ".join(nom.split())
    return DEBUT_MOT_RE.sub(lambda m: m.group(1) + m.group(2).upper(), nom)


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

# Le Wiki est le seul endroit où une canette existe : chaque ligne de collection pointe vers une fiche.
# Crée la fiche des lignes qui n'en ont pas (code inchangé, nom/édition/volume de la ligne la plus
# ancienne qui a un nom) ; une fiche possédée n'est plus « retirée ». Les photos ne sont pas copiées :
# elles avaient été envoyées comme privées. Aucune ligne de collection n'est modifiée.
FICHES_MANQUANTES = """
DELETE FROM wiki_exclus x WHERE EXISTS (SELECT 1 FROM collection c WHERE c.ean = x.ean);
INSERT INTO wiki (ean, nom, volume, source, cree, maj)
    SELECT DISTINCT ON (c.ean) c.ean, c.nom, c.volume, 'migration', c.ajout, c.maj FROM collection c
    WHERE NOT EXISTS (SELECT 1 FROM wiki w WHERE w.ean = c.ean)
      AND NOT EXISTS (SELECT 1 FROM wiki_codes k WHERE k.ean = c.ean)
    ORDER BY c.ean, (c.nom = ''), c.ajout
ON CONFLICT (ean) DO NOTHING;
"""

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
    # Numéro déjà utilisé par une migration retirée avant livraison (couleur) : certaines bases de développement
    # l'ont enregistré. Il reste réservé et ne fait rien ; un numéro ne doit jamais être réattribué.
    (4, "SELECT 1;"),
    # Date de passage au statut « Nouveauté » (affiché « Active » après 30 jours).
    (5, "ALTER TABLE wiki ADD COLUMN IF NOT EXISTS nouveaute_depuis BIGINT;"),
    # Codes-barres supplémentaires d'une fiche (autre pays, autre format) : scanner l'un d'eux retrouve la fiche.
    (6, """CREATE TABLE IF NOT EXISTS wiki_codes (ean TEXT PRIMARY KEY,
        fiche TEXT NOT NULL REFERENCES wiki(ean) ON UPDATE CASCADE ON DELETE CASCADE, ajout TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS wiki_codes_fiche ON wiki_codes (fiche);"""),
    # Plus aucune canette hors du Wiki (LOCAL-, fiches retirées) : voir FICHES_MANQUANTES. Le texte est
    # recopié ici pour que la migration ne change jamais, même si la constante évolue.
    (7, """
DELETE FROM wiki_exclus x WHERE EXISTS (SELECT 1 FROM collection c WHERE c.ean = x.ean);
INSERT INTO wiki (ean, nom, edition, volume, cree, maj)
    SELECT DISTINCT ON (c.ean) c.ean, c.nom, c.edition, c.volume, c.ajout, c.maj FROM collection c
    WHERE NOT EXISTS (SELECT 1 FROM wiki w WHERE w.ean = c.ean)
      AND NOT EXISTS (SELECT 1 FROM wiki_codes k WHERE k.ean = c.ean)
    ORDER BY c.ean, (c.nom = ''), c.ajout
ON CONFLICT (ean) DO NOTHING;
"""),
    # Code remplacé (code interne → vrai code, correction) : « vers » mène à la fiche qui le porte désormais.
    # Vide pour une fiche supprimée par le propriétaire.
    (8, "ALTER TABLE wiki_exclus ADD COLUMN IF NOT EXISTS vers TEXT;"),
    # Provenance anonyme d'une fiche (comment elle a été créée, dernière correction du propriétaire) et
    # signalements d'erreurs envoyés par les comptes, sans lien avec eux.
    (9, """
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS corrigee TEXT;
CREATE TABLE IF NOT EXISTS wiki_signalements (id BIGSERIAL PRIMARY KEY,
    fiche TEXT NOT NULL REFERENCES wiki(ean) ON UPDATE CASCADE ON DELETE CASCADE,
    motif TEXT NOT NULL, cree TEXT NOT NULL, traite TEXT);
CREATE INDEX IF NOT EXISTS wiki_signalements_fiche ON wiki_signalements (fiche);
"""),
    # Recherche dans le catalogue : texte sans accents ni majuscules (sm_texte, IMMUTABLE pour pouvoir
    # l'indexer) et index trigramme sur nom, saveur, pays, gamme et code-barres. Voir DOC_RECHERCHE.
    (10, """
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;
-- Noms complets (public.…) : PostgreSQL 17+ restreint le search_path pendant la création d'un index.
CREATE OR REPLACE FUNCTION public.sm_texte(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT pg_catalog.lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t, ''))) $$;
CREATE INDEX IF NOT EXISTS wiki_recherche ON wiki USING gin (
    sm_texte(nom || ' ' || flavor || ' ' || region || ' ' || COALESCE(NULLIF(categorie, ''), gamme) || ' ' || ean)
    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wiki_recherche_nom ON wiki USING gin (sm_texte(nom) gin_trgm_ops);
"""),
    # Modération des fiches créées par les membres (« à vérifier » jusqu'à la décision du propriétaire) et
    # historique des décisions. Les fiches existantes sont considérées comme acceptées. Pas d'auteur gardé.
    (11, """
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS moderation TEXT NOT NULL DEFAULT 'acceptee'
    CHECK (moderation IN ('en_attente', 'acceptee', 'refusee'));
CREATE TABLE IF NOT EXISTS wiki_moderations (id BIGSERIAL PRIMARY KEY,
    fiche TEXT NOT NULL REFERENCES wiki(ean) ON UPDATE CASCADE ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('acceptee', 'refusee')), motif TEXT NOT NULL DEFAULT '',
    cree TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS wiki_moderations_fiche ON wiki_moderations (fiche);
CREATE INDEX IF NOT EXISTS wiki_moderation_en_attente ON wiki (moderation) WHERE moderation <> 'acceptee';
"""),
    # Sessions : date de connexion (plafond de 90 jours), date d'émission du jeton (rotation) et date de
    # remplacement (délai de grâce). Les sessions existantes gardent leur échéance : elles sont datées de
    # leur connexion supposée (échéance - 30 jours), personne n'est déconnecté.
    (12, """
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cree BIGINT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS emis BIGINT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS remplacee BIGINT;
UPDATE sessions SET cree = expire - 2592000 WHERE cree IS NULL;
UPDATE sessions SET emis = cree WHERE emis IS NULL;
ALTER TABLE sessions ALTER COLUMN cree SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN emis SET NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
"""),
    # Compatibilité avec la version précédente de l'API, qui crée ses sessions sans « cree » ni « emis » :
    # sans valeur par défaut, sa connexion échouait (NOT NULL) dès que la base passait en version 12.
    (13, """
ALTER TABLE sessions ALTER COLUMN cree SET DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT);
ALTER TABLE sessions ALTER COLUMN emis SET DEFAULT (EXTRACT(EPOCH FROM now())::BIGINT);
"""),
    # Fiches normalisées (issue #5). Rien n'est perdu : les valeurs d'avant sont copiées dans
    # sauvegarde_migration_14 ; une saveur trop longue ne part dans la description que si celle-ci est vide ;
    # un volume illisible reste tel quel (signalé « à reprendre » au propriétaire).
    (14, r"""
CREATE TABLE IF NOT EXISTS sauvegarde_migration_14 AS
    SELECT 'wiki' AS source, NULL::bigint AS user_id, ean, volume, flavor, description, status FROM wiki
    UNION ALL SELECT 'collection', user_id, ean, volume, '', '', '' FROM collection;
ALTER TABLE wiki ADD COLUMN IF NOT EXISTS variante TEXT NOT NULL DEFAULT '';
UPDATE wiki SET volume = substring(volume FROM '^\s*(\d{2,4})') || ' ml'
    WHERE volume ~* '^\s*\d{2,4}\s*(ml)?\s*$' AND volume !~ '^\d{2,4} ml$'
      AND substring(volume FROM '^\s*(\d{2,4})')::int BETWEEN 50 AND 3000;
UPDATE collection SET volume = substring(volume FROM '^\s*(\d{2,4})') || ' ml'
    WHERE volume ~* '^\s*\d{2,4}\s*(ml)?\s*$' AND volume !~ '^\d{2,4} ml$'
      AND substring(volume FROM '^\s*(\d{2,4})')::int BETWEEN 50 AND 3000;
UPDATE wiki SET status = 'Stop' WHERE status = 'Discontinued';
UPDATE wiki SET description = flavor, flavor = '' WHERE length(flavor) > 60 AND description = '';
UPDATE wiki SET variante = CASE
        WHEN nom ~* '\mshots?\M' THEN 'Shot'
        WHEN nom ~* '\mzero\M' THEN 'Zero Sugar'
        WHEN nom ~* '\m(vr46|rossi|lando|norris|mclaren)\M' OR nom ~* '\s[x×]\s' THEN 'Collaboration'
        ELSE '' END
    WHERE variante = '';
DROP INDEX IF EXISTS wiki_recherche;
CREATE INDEX wiki_recherche ON wiki USING gin (
    sm_texte(nom || ' ' || flavor || ' ' || region || ' ' || COALESCE(NULLIF(categorie, ''), gamme) || ' ' || variante
             || ' ' || ean) gin_trgm_ops);
"""),
    # Variante : « Limited » / « Édition limitée » → Édition limitée, sinon Standard, pour les fiches nommées dont
    # la variante est encore vide (mêmes règles que varianteDuNom dans src/categories.ts). Une variante déjà
    # remplie ne change pas ; seules des valeurs vides sont complétées.
    (15, r"""
UPDATE wiki SET variante = CASE WHEN sm_texte(nom) ~ '\m(limited|limitee)\M' THEN 'Édition limitée' ELSE 'Standard' END
    WHERE variante = '' AND btrim(nom) <> '';
"""),
    # Échanges, étape 1 (doubles et recherchées) : un membre propose ses doubles d'une canette (collection.echange,
    # compté seulement s'il en a au moins 2) et note les canettes qu'il cherche (recherches). Les fiches n'en
    # montrent que des compteurs, jamais qui. Tout part avec le compte (ON DELETE CASCADE) ; une recherche suit la
    # fiche si son code-barres change (ON UPDATE CASCADE) et disparaît avec elle.
    # Depuis, collection.echange n'est plus lue : le partage se règle pour tout le compte (users.partage_doubles,
    # migration 17). La colonne reste (migration déjà appliquée, schéma conservé).
    (16, """
ALTER TABLE collection ADD COLUMN IF NOT EXISTS echange BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS collection_echange ON collection (ean) WHERE echange;
CREATE TABLE IF NOT EXISTS recherches (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fiche TEXT NOT NULL REFERENCES wiki(ean) ON UPDATE CASCADE ON DELETE CASCADE,
    ajout TEXT NOT NULL,
    PRIMARY KEY (user_id, fiche));
CREATE INDEX IF NOT EXISTS recherches_fiche ON recherches (fiche);
"""),
    # Réglage du compte : partager ou non ses doublons (seul réglage, activé par défaut). Activé, toute canette en
    # 2 exemplaires ou plus compte comme double ; désactivé, aucun double du compte n'est compté.
    (17, """
ALTER TABLE users ADD COLUMN IF NOT EXISTS partage_doubles BOOLEAN NOT NULL DEFAULT true;
"""),
    # Échanges, étape 2 : mise en relation. Une ligne par trio (fiche, chercheur, possesseur), créée quand l'appli
    # repère que l'un cherche une canette que l'autre a en double (statut « signalee » : notifié au chercheur).
    # Le chercheur demande l'échange (« demandee » : notifié au possesseur), qui l'accepte (« acceptee » : la
    # messagerie s'ouvre) ; l'un ou l'autre peut annuler (« annulee », rien n'est dit à l'autre). Les membres ne
    # voient jamais l'adresse de l'autre. vu_* : dernier message lu par chacun. Tout part avec le compte.
    (18, """
CREATE TABLE IF NOT EXISTS echanges (
    id BIGSERIAL PRIMARY KEY,
    fiche TEXT NOT NULL REFERENCES wiki(ean) ON UPDATE CASCADE ON DELETE CASCADE,
    chercheur BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    possesseur BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    statut TEXT NOT NULL DEFAULT 'signalee' CHECK (statut IN ('signalee', 'demandee', 'acceptee', 'annulee')),
    cree TEXT NOT NULL,
    maj TEXT NOT NULL,
    vu_chercheur BIGINT NOT NULL DEFAULT 0,
    vu_possesseur BIGINT NOT NULL DEFAULT 0,
    UNIQUE (fiche, chercheur, possesseur),
    CHECK (chercheur <> possesseur));
CREATE INDEX IF NOT EXISTS echanges_chercheur ON echanges (chercheur);
CREATE INDEX IF NOT EXISTS echanges_possesseur ON echanges (possesseur);
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    echange BIGINT NOT NULL REFERENCES echanges(id) ON DELETE CASCADE,
    auteur BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    texte TEXT NOT NULL,
    cree TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_echange ON messages (echange, id);
"""),
    # Échanges, étape 3 : fin d'une conversation. « Valider l'échange » : quand les deux ont validé (valide_*),
    # -1 chez le possesseur, +1 chez le chercheur, statut « terminee ». « Signaler » : la conversation se ferme
    # (« fermee ») et ces deux membres ne sont plus mis en relation ; le propriétaire du service examine le
    # signalement (motif, conversation) puis le marque traité.
    (19, """
ALTER TABLE echanges ADD COLUMN IF NOT EXISTS valide_chercheur BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE echanges ADD COLUMN IF NOT EXISTS valide_possesseur BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE echanges DROP CONSTRAINT IF EXISTS echanges_statut_check;
ALTER TABLE echanges ADD CONSTRAINT echanges_statut_check
    CHECK (statut IN ('signalee', 'demandee', 'acceptee', 'annulee', 'terminee', 'fermee'));
CREATE TABLE IF NOT EXISTS signalements_membres (
    id BIGSERIAL PRIMARY KEY,
    echange BIGINT NOT NULL REFERENCES echanges(id) ON DELETE CASCADE,
    auteur BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signale BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motif TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    cree TEXT NOT NULL,
    traite TEXT,
    UNIQUE (echange, auteur));
CREATE INDEX IF NOT EXISTS signalements_membres_paire ON signalements_membres (auteur, signale);
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
    volume: str = Field(default="", max_length=40)
    categorie: str = Field(default="", max_length=80)
    flavor: str = Field(default="", max_length=200)
    status: Literal["", "Active", "Stop", "Nouveauté"] = ""
    region: str = Field(default="", max_length=80)
    variante: str = Field(default="", max_length=40)
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

    @field_validator("nom")
    @classmethod
    def formater(cls, nom: str) -> str:
        return formater_nom(nom)

    @field_validator("volume")
    @classmethod
    def volume_normalise(cls, volume: str) -> str:
        """Ajout depuis la collection : volume mis au format « 500 ml » s'il est lisible, gardé sinon."""
        v = normaliser_volume(volume)
        return volume.strip() if v is None else v

    @field_validator("variante")
    @classmethod
    def variante_connue(cls, variante: str) -> str:
        return variante.strip() if variante.strip() in VARIANTES else ""


class FicheWiki(ChampsControles):
    """Champs d'une fiche du Wiki modifiables par le propriétaire."""

    ean: str | None = Field(default=None, min_length=1, max_length=64)
    nom: str = Field(default="", max_length=200)
    volume: str = Field(default="", max_length=40)
    categorie: str = Field(default="", max_length=80)
    flavor: str = Field(default="", max_length=200)
    status: Literal["", "Active", "Stop", "Nouveauté"] = ""
    region: str = Field(default="", max_length=80)
    variante: str = Field(default="", max_length=40)
    description: str = Field(default="", max_length=4000)

    @field_validator("nom")
    @classmethod
    def formater(cls, nom: str) -> str:
        return formater_nom(nom)


class CodeBarres(BaseModel):
    ean: str = Field(min_length=1, max_length=64)


class PhotoFiche(BaseModel):
    photo: str = Field(max_length=300_000)


class Signalement(BaseModel):
    """Erreur signalée sur une fiche du Wiki ; le motif est transmis sans lien avec le compte."""

    motif: str = Field(min_length=3, max_length=500)

    @field_validator("motif")
    @classmethod
    def nettoyer(cls, motif: str) -> str:
        motif = " ".join(motif.split())
        if len(motif) < 3:
            raise ValueError("motif trop court")
        return motif


class Proposition(ChampsControles):
    """Canette proposée au catalogue par un membre, sans l'ajouter à sa collection."""

    ean: str = Field(default="", max_length=64)
    nom: str = Field(min_length=1, max_length=200)
    volume: str = Field(default="", max_length=40)
    categorie: str = Field(default="", max_length=80)
    flavor: str = Field(default="", max_length=200)
    region: str = Field(default="", max_length=80)
    variante: str = Field(default="", max_length=40)
    photo: str | None = Field(default=None, max_length=300_000)
    # Envoyée après avoir vu les fiches proches : le membre confirme qu'il ne s'agit pas d'un doublon.
    confirmer_doublon: bool = False

    @field_validator("nom")
    @classmethod
    def formater(cls, nom: str) -> str:
        nom = formater_nom(nom)
        if not nom:
            raise ValueError("nom obligatoire")
        return nom

    @field_validator("photo")
    @classmethod
    def verifier_photo(cls, photo: str | None) -> str | None:
        if photo is not None and not _photo_valide(photo):
            raise ValueError("format de photo refusé")
        return photo


class Decision(BaseModel):
    """Décision du propriétaire sur une fiche à vérifier."""

    decision: Literal["acceptee", "refusee"]
    motif: str = Field(default="", max_length=500)


class Delta(BaseModel):
    delta: int = Field(ge=-99, le=99)


class Demande(BaseModel):
    email: str = Field(max_length=254)


class Verification(Demande):
    code: str = Field(min_length=6, max_length=6)


class Echange(BaseModel):
    echange: bool


class Message(BaseModel):
    texte: str = Field(min_length=1, max_length=1000)


MOTIFS_SIGNALEMENT_MEMBRE = ("Spam ou publicité", "Propos déplacés", "Arnaque ou tentative de vente", "Autre")


class SignalementMembre(BaseModel):
    motif: str
    detail: str = Field(default="", max_length=500)

    @field_validator("motif")
    @classmethod
    def _motif_connu(cls, v: str) -> str:
        if v not in MOTIFS_SIGNALEMENT_MEMBRE:
            raise ValueError("motif inconnu")
        return v


class Vidage(BaseModel):
    """Confirmation explicite du vidage de la collection."""
    confirmation: Literal["vider"]


class Suppression(BaseModel):
    """Confirmation explicite : l'adresse du compte, saisie par l'utilisateur."""
    confirmation: str = Field(max_length=254)


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
        # Déploiement Preview de Vercel : l'API ne se met elle-même à jour que si SM_MIGRATION_AUTO=1 (Preview
        # sur une base de test). Sinon, et toujours en production, le schéma ne change que par le script : une
        # Preview qui partage la base de production ne doit pas la migrer avant le déploiement du code qui va avec.
        if os.environ.get("VERCEL_ENV") == "preview" and os.environ.get("SM_MIGRATION_AUTO") == "1":
            with cx.transaction():
                appliquees = appliquer_migrations(cx)
            logger.warning("Preview (SM_MIGRATION_AUTO=1) : migrations appliquées automatiquement %s", appliquees)
        else:
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


def _adresse_limitee(adresse: str) -> str:
    """Adresse retenue pour les limites : un abonné IPv6 dispose en général d'un /64 entier."""
    if ":" in adresse:
        return str(ipaddress.ip_network(f"{adresse}/64", strict=False).network_address)
    return adresse


def _cle_limite(action: str, adresse: str | None = None) -> str:
    """Clé HMAC d'un compteur : par IP, ou globale (sans adresse). L'IP n'est jamais stockée en clair."""
    sujet = f"limite-ip:{action}:{_adresse_limitee(adresse)}" if adresse else f"limite-globale:{action}"
    return hmac.new(_secret(), sujet.encode(), hashlib.sha256).hexdigest()


def _compter(
    cx: psycopg.Connection, cle: str, maximum: int, fenetre: int, now: int,
    detail: str = "trop de tentatives", consommer: bool = True,
) -> None:
    """Compteur à fenêtre fixe : 429 au-delà du maximum.

    Sans « consommer », vérifie seulement qu'il reste de la place (l'appel sera compté s'il aboutit).
    """
    expiree = now - fenetre
    if consommer:
        n = cx.execute(
            """INSERT INTO limites_ip (cle, debut, n) VALUES (%s, %s, 1)
               ON CONFLICT (cle) DO UPDATE SET
                 n = CASE WHEN limites_ip.debut <= %s THEN 1 ELSE limites_ip.n + 1 END,
                 debut = CASE WHEN limites_ip.debut <= %s THEN EXCLUDED.debut ELSE limites_ip.debut END
               RETURNING n, debut""",
            (cle, now, expiree, expiree),
        ).fetchone()
        cx.commit()  # le compteur doit survivre au 429 qui suit
        depasse = n["n"] > maximum
    else:
        n = cx.execute("SELECT n, debut FROM limites_ip WHERE cle = %s AND debut > %s", (cle, expiree)).fetchone()
        depasse = bool(n) and n["n"] >= maximum
    if depasse:
        raise _trop_de_tentatives(n["debut"] + fenetre - now, detail)


def _limiter_ip(
    cx: psycopg.Connection, request: Request, action: str, maximum: int, now: int,
    fenetre: int = FENETRE_DEMANDES, detail: str = "trop de tentatives", consommer: bool = True,
) -> None:
    """Compte l'appel pour cette IP (fenêtre fixe, une heure par défaut) et répond 429 au-delà du maximum."""
    adresse = _adresse_ip(request)
    if adresse:
        _compter(cx, _cle_limite(action, adresse), maximum, fenetre, now, detail, consommer)


def _seuil(nom: str, defaut: int) -> int:
    """Seuil global réglable sans changer le code (variable d'environnement), sinon valeur par défaut."""
    try:
        return max(1, int(os.environ.get(nom, "")))
    except ValueError:
        return defaut


def _trop_de_tentatives(attente: int, detail: str = "trop de tentatives") -> HTTPException:
    """429 commun à toutes les limites, avec le délai réel avant de pouvoir réessayer."""
    return HTTPException(429, detail, headers={"Retry-After": str(max(1, attente))})


def _url_site() -> str:
    """Adresse publique du site, pour les liens et images du mail (une image de mail doit être en ligne)."""
    return (os.environ.get("SITE_URL") or "https://canstackmonsters.vercel.app").rstrip("/")


def mail_code_html(code: str) -> str:
    """Mail du code de connexion, dans le style du site : fond noir, vert lumineux, code en grand.

    HTML d'e-mail : mise en page en tableaux et styles sur chaque balise (Gmail et Outlook ignorent
    les feuilles de style), polices de repli, image PNG en ligne (le SVG n'est pas affiché par Gmail).
    """
    site = _url_site()
    chiffres = "".join(
        f'<td style="padding:0 2px"><div style="width:34px;height:50px;line-height:50px;border:2px solid #9EE818;'
        f'border-radius:11px;background:#050603;color:#C6FF4D;font:700 28px/50px Arial,Helvetica,sans-serif;'
        f'text-align:center">{c}</div></td>'
        for c in code
    )
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>Ton code StackMonsters</title></head>
<body style="margin:0;padding:0;background:#000000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Ton code {code} est valable 10 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000">
<tr><td align="center" style="padding:24px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="max-width:480px;background:#0B0D08;border:1px solid #2E3A12;border-radius:22px">
    <tr><td align="center" style="padding:28px 12px 8px">
      <img src="{site}/images/logo-mail.png" width="64" height="64" alt="" style="display:block;border:0">
      <div style="margin-top:12px;font:700 20px Arial,Helvetica,sans-serif;letter-spacing:3px;color:#F2F4EC">
        STACK<span style="color:#9EE818">MONSTERS</span></div>
    </td></tr>
    <tr><td align="center" style="padding:20px 12px 4px">
      <div style="font:italic 700 24px Arial,Helvetica,sans-serif;color:#F2F4EC">Ton code de
        <span style="color:#9EE818">connexion.</span></div>
      <div style="width:160px;height:3px;margin:14px auto 0;background:#9EE818;border-radius:3px"></div>
    </td></tr>
    <tr><td align="center" style="padding:24px 4px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>{chiffres}</tr></table>
    </td></tr>
    <tr><td align="center" style="padding:12px 28px 28px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#9AA394">
      Saisis-le dans l'application. Il est valable <b style="color:#F2F4EC">10&nbsp;minutes</b>.
    </td></tr>
    <tr><td style="padding:0 28px"><div style="height:1px;background:#2E3A12"></div></td></tr>
    <tr><td align="center" style="padding:18px 28px 28px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#9AA394">
      Si tu n'es pas à l'origine de cette demande, ignore ce message&nbsp;: personne ne peut se connecter sans ce code.<br>
      <a href="{site}" style="color:#9EE818;text-decoration:none">{site.removeprefix("https://")}</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""


def envoyer_code(email: str, code: str) -> None:
    cle = os.environ.get("RESEND_API_KEY")
    if not cle:
        if os.environ.get("AUTH_DEV") == "1":
            print(f"[dev] code de connexion pour {email} : {code}", flush=True)
            return
        raise HTTPException(503, "envoi d'e-mail non configuré")
    corps = {
        "from": os.environ.get("MAIL_FROM", "StackMonsters <onboarding@resend.dev>"),
        "to": [email],
        "subject": f"Ton code StackMonsters : {code}",
        "text": f"Ton code de connexion : {code}\nIl est valable 10 minutes. Si tu n'es pas à l'origine de cette demande, ignore ce message.",
        "html": mail_code_html(code),
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
    h, now = _hash_session(_jeton(authorization)), int(time.time())
    u = cx.execute(
        "SELECT u.id, u.email, s.expire, s.cree, s.emis, s.remplacee FROM sessions s "
        "JOIN users u ON u.id = s.user_id WHERE s.hash = %s AND s.expire > %s", (h, now),
    ).fetchone()
    if u and u["remplacee"] is None:
        # Expiration glissante : chaque usage repousse l'échéance, sans dépasser le plafond depuis la connexion.
        echeance = _echeance_session(u["cree"], now)
        if echeance - u["expire"] >= PROLONGATION_MIN:
            cx.execute("UPDATE sessions SET expire = %s WHERE hash = %s", (echeance, h))
    cx.commit()  # les routes ouvrent ensuite leur propre transaction
    if u:
        return {"id": u["id"], "email": u["email"], "hash": h, "cree": u["cree"], "emis": u["emis"],
                "remplacee": u["remplacee"]}
    raise HTTPException(401, "connexion requise")


def _echeance_session(cree: int, now: int) -> int:
    return min(now + INACTIVITE_SESSION, cree + DUREE_MAX_SESSION)


def _ouvrir_session(cx: psycopg.Connection, user_id: int, cree: int, now: int) -> str:
    """Crée un jeton ; seule son empreinte est stockée."""
    token = secrets.token_urlsafe(32)
    cx.execute("INSERT INTO sessions (hash, user_id, expire, cree, emis) VALUES (%s, %s, %s, %s, %s)",
               (_hash_session(token), user_id, _echeance_session(cree, now), cree, now))
    return token


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
        # Mêmes limites que l'adresse ait un compte ou non : la réponse ne révèle rien.
        _limiter_ip(cx, request, "demande", _seuil("SM_DEMANDES_MAX_IP", DEMANDES_MAX_IP), now)
        _limiter_ip(cx, request, "demande-jour", _seuil("SM_DEMANDES_MAX_IP_JOUR", DEMANDES_MAX_IP_JOUR), now, FENETRE_JOUR)
        _compter(cx, _cle_limite("demande"), _seuil("SM_DEMANDES_MAX_HEURE", DEMANDES_MAX_HEURE), FENETRE_DEMANDES, now)
        cx.execute("DELETE FROM limites_ip WHERE debut <= %s", (now - FENETRE_JOUR,))
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
        if not cx.execute("SELECT 1 FROM users WHERE email = %s", (email,)).fetchone():
            # Création de compte : limitée seulement ici, une fois le code validé. Seul le titulaire de
            # l'adresse apprend qu'elle n'avait pas de compte ; le code reste utilisable jusqu'à expiration.
            comptes_heure = _seuil("SM_COMPTES_MAX_HEURE", COMPTES_MAX_HEURE)
            comptes_ip = _seuil("SM_COMPTES_MAX_IP_JOUR", COMPTES_MAX_IP_JOUR)
            _limiter_ip(cx, request, "compte", comptes_ip, now, FENETRE_JOUR, INSCRIPTIONS_LIMITEES, False)
            _compter(cx, _cle_limite("compte"), comptes_heure, FENETRE_DEMANDES, now, INSCRIPTIONS_LIMITEES, False)
            _limiter_ip(cx, request, "compte", comptes_ip, now, FENETRE_JOUR, INSCRIPTIONS_LIMITEES)
            _compter(cx, _cle_limite("compte"), comptes_heure, FENETRE_DEMANDES, now, INSCRIPTIONS_LIMITEES)
        cx.execute("DELETE FROM codes WHERE email = %s", (email,))
        u = cx.execute("INSERT INTO users (email, cree) VALUES (%s, %s) ON CONFLICT (email) DO NOTHING RETURNING id",
                       (email, now)).fetchone()
        if u:  # premier passage : le propriétaire récupère la collection historique
            if _est_proprietaire(email):
                cx.execute(
                    f"INSERT INTO collection (user_id, {COLONNES}, maj) SELECT %s, {COLONNES}, maj FROM canettes ON CONFLICT DO NOTHING",
                    (u["id"],))
                cx.execute(FICHES_MANQUANTES)
        else:
            u = cx.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        adresse = _adresse_ip(request)
        if adresse:
            cx.execute(
                "INSERT INTO connexions_uniques (ip_hash, premiere_connexion) VALUES (%s, %s) "
                "ON CONFLICT (ip_hash) DO NOTHING",
                (_empreinte_ip(adresse), now),
            )
        token = _ouvrir_session(cx, u["id"], now, now)
    return {"token": token, "email": email}


# --- routes protégées : la collection de l'utilisateur connecté -----------------

router = APIRouter(dependencies=[Depends(utilisateur)])


@router.get("/auth/moi")
def moi(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        r = cx.execute("SELECT partage_doubles FROM users WHERE id = %s", (u["id"],)).fetchone()
    return {"email": u["email"], "partage_doubles": r["partage_doubles"]}


@router.patch("/auth/partage-doubles")
def regler_partage_doubles(e: Echange, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Seul réglage du partage : activé, toutes les canettes du compte en 2 exemplaires ou plus comptent comme doubles."""
    with cx.transaction():
        cx.execute("UPDATE users SET partage_doubles = %s WHERE id = %s", (e.echange, u["id"]))
    return {"partage_doubles": e.echange}


@router.post("/auth/renouveler")
def renouveler(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Rotation : au plus une fois par jour, remplace le jeton par un nouveau (même date de connexion).

    Renvoie {"token": null} si le jeton est encore récent, ou s'il a déjà été remplacé.
    """
    now = int(time.time())
    if u["remplacee"] is not None or now - u["emis"] < ROTATION_SESSION:
        return {"token": None}
    with cx.transaction():
        # Condition sur « remplacee » : deux appels simultanés ne créent pas deux jetons.
        if not cx.execute(
            "UPDATE sessions SET remplacee = %s, expire = LEAST(expire, %s) WHERE hash = %s AND remplacee IS NULL "
            "RETURNING hash", (now, now + GRACE_ROTATION, u["hash"]),
        ).fetchone():
            return {"token": None}
        token = _ouvrir_session(cx, u["id"], u["cree"], now)
    return {"token": token}


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
def supprimer_compte(
    s: Suppression, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> None:
    """Efface le compte, sa collection (photos et notes comprises), ses sessions et ses codes.

    Le Wiki, anonyme, est conservé : ses fiches n'ont aucun lien avec le compte. Les sessions et la collection
    partent par ON DELETE CASCADE.
    """
    if _est_proprietaire(u["email"]):  # il récupérerait la collection historique à sa prochaine connexion
        raise HTTPException(403, "le compte propriétaire ne peut pas être supprimé")
    if s.confirmation.strip().lower() != u["email"]:
        raise HTTPException(422, "confirmation différente de l'adresse du compte")
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


def _canette(cx: psycopg.Connection, user_id: int, ean: str) -> dict | None:
    """Canette de la collection d'un compte, complétée par sa fiche du Wiki."""
    return cx.execute(
        f"SELECT {COLONNES_COLLECTION} "
        f"FROM collection c {JOINTURE_WIKI} "
        "WHERE c.user_id = %s AND c.ean = %s",
        (user_id, ean),
    ).fetchone()


@router.get("/cans")
def liste(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> list[dict]:
    with cx.transaction():
        return cx.execute(
            f"SELECT {COLONNES_COLLECTION} "
            f"FROM collection c {JOINTURE_WIKI} "
            "WHERE c.user_id = %s ORDER BY c.ajout DESC",
            (u["id"],),
        ).fetchall()


@router.get("/cans/{ean}")
def lire(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        r = _canette(cx, u["id"], ean)
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.get("/cans/{ean}/photo")
def photo_canette(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> Response:
    """Photo d'une canette de sa propre collection, chargée à la demande : celle du Wiki en priorité."""
    with cx.transaction():
        r = cx.execute(
            f"SELECT COALESCE(w.photo, c.photo) AS photo FROM collection c {JOINTURE_WIKI} "
            "WHERE c.user_id = %s AND c.ean = %s",
            (u["id"], ean),
        ).fetchone()
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
        # Nouvelle canette sans code-barres : code interne tiré du nom (convert.py). Le même nom donne
        # toujours le même code, donc la canette rejoint la fiche du Wiki déjà créée sous ce nom.
        if not deja_la and ean.startswith("LOCAL-"):
            if not c.nom:
                raise HTTPException(422, "un nom est obligatoire pour une canette sans code-barres")
            ean = convert.nom_en_13_chiffres(c.nom)
            if cx.execute("SELECT 1 FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).fetchone():
                raise HTTPException(409, "une canette du même nom est déjà dans ta collection")
        if not deja_la:
            retiree = cx.execute("SELECT vers FROM wiki_exclus WHERE ean = %s", (ean,)).fetchone()
            if retiree and retiree["vers"]:  # ancien code : la canette est la fiche qui l'a remplacé
                ean = retiree["vers"]
                if cx.execute("SELECT 1 FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).fetchone():
                    raise HTTPException(409, "cette canette est déjà dans ta collection, sous un autre code-barres")
            elif retiree:
                raise HTTPException(409, "cette canette a été retirée du Wiki")
        principal = None if deja_la else _fiche_du_code(cx, ean)
        if principal:  # un code supplémentaire désigne la fiche existante : pas de doublon
            if cx.execute(
                "SELECT 1 FROM collection WHERE user_id = %s AND ean = %s", (u["id"], principal),
            ).fetchone():
                raise HTTPException(409, "cette canette est déjà dans ta collection, sous un autre code-barres")
            ean = principal
        # Seul le propriétaire valide une « Nouveauté » ; venue d'un autre compte, elle est ignorée.
        statut = c.status if c.status != "Nouveauté" or _est_proprietaire(u["email"]) else ""
        # Le Wiki est le seul endroit où une canette existe : ajouter une canette crée sa fiche si besoin,
        # sans écraser les champs déjà remplis.
        # Ancienne ligne enregistrée sous un code devenu secondaire ou remplacé : sa fiche existe déjà.
        fiche = (_fiche_de_la_ligne(cx, ean) if deja_la else None) or ean
        cx.execute("DELETE FROM wiki_exclus WHERE ean = %s", (fiche,))
        cx.execute(
            """INSERT INTO wiki (ean, nom, volume, categorie, flavor, status, region, variante, nouveaute_depuis, source,
                                 moderation, cree, maj)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (ean) DO UPDATE SET
                  nom = CASE WHEN wiki.nom = '' THEN EXCLUDED.nom ELSE wiki.nom END,
                  volume = CASE WHEN wiki.volume = '' THEN EXCLUDED.volume ELSE wiki.volume END,
                  categorie = CASE WHEN COALESCE(NULLIF(wiki.categorie, ''), wiki.gamme, '') = ''
                                   THEN EXCLUDED.categorie ELSE wiki.categorie END,
                  flavor = CASE WHEN wiki.flavor = '' THEN EXCLUDED.flavor ELSE wiki.flavor END,
                  status = CASE WHEN wiki.status = '' THEN EXCLUDED.status ELSE wiki.status END,
                  nouveaute_depuis = CASE WHEN wiki.status = '' THEN EXCLUDED.nouveaute_depuis
                                          ELSE wiki.nouveaute_depuis END,
                  region = CASE WHEN wiki.region = '' THEN EXCLUDED.region ELSE wiki.region END,
                  variante = CASE WHEN wiki.variante = '' THEN EXCLUDED.variante ELSE wiki.variante END,
                  maj = CASE WHEN (wiki.nom = '' AND EXCLUDED.nom <> '')
                              OR (wiki.volume = '' AND EXCLUDED.volume <> '')
                              OR (COALESCE(NULLIF(wiki.categorie, ''), wiki.gamme, '') = '' AND EXCLUDED.categorie <> '')
                              OR (wiki.flavor = '' AND EXCLUDED.flavor <> '')
                              OR (wiki.status = '' AND EXCLUDED.status <> '')
                              OR (wiki.region = '' AND EXCLUDED.region <> '')
                              OR (wiki.variante = '' AND EXCLUDED.variante <> '')
                             THEN EXCLUDED.maj ELSE wiki.maj END""",
            (fiche, c.nom.strip(), c.volume.strip(), c.categorie.strip(), c.flavor.strip(),
             statut, c.region.strip(), c.variante,
             int(time.time()) if statut == "Nouveauté" else None,
             # Provenance anonyme, fixée à la création de la fiche (jamais modifiée ensuite).
             "sans-code" if c.ean.startswith("LOCAL-") else "code-barres",
             # Une fiche créée par un membre est « à vérifier » ; une fiche existante garde son statut.
             "acceptee" if _est_proprietaire(u["email"]) else "en_attente", maintenant(), maintenant()),
        )
        # Une photo envoyée devient celle de la fiche du Wiki si elle n'en a pas encore (visible par tous).
        if c.photo:
            cx.execute(
                "UPDATE wiki SET photo = %s, maj = %s WHERE ean = %s AND photo IS NULL",
                (c.photo, maintenant(), fiche),
            )
        cx.execute(
            """INSERT INTO collection (user_id, ean, nom, volume, etat, nb, notes, photo, ajout, maj)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, ean) DO UPDATE SET
                  nom=EXCLUDED.nom, volume=EXCLUDED.volume, etat=EXCLUDED.etat,
                  nb=EXCLUDED.nb, notes=EXCLUDED.notes, maj=EXCLUDED.maj,
                  photo = CASE WHEN %s THEN EXCLUDED.photo ELSE collection.photo END""",
            (u["id"], ean, c.nom, c.volume, c.etat, c.nb, c.notes, c.photo,
             c.ajout or maintenant(), maintenant(), "photo" in c.model_fields_set),  # champ absent : photo conservée
        )
        cx.execute("DELETE FROM recherches WHERE user_id = %s AND fiche = %s", (u["id"], fiche))  # trouvée !
        return _canette(cx, u["id"], ean)


@router.patch("/cans/{ean}/nb")
def ajuster(ean: str, d: Delta, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    with cx.transaction():
        n = cx.execute(
            "UPDATE collection SET nb = GREATEST(1, nb + %s), maj = %s WHERE user_id = %s AND ean = %s",
            (d.delta, maintenant(), u["id"], ean)).rowcount
        r = _canette(cx, u["id"], ean) if n else None
    if r is None:
        raise HTTPException(404, "canette inconnue")
    return r


@router.delete("/cans")
def vider_collection(v: Vidage, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Retire toutes les canettes de la collection (quantités, états, notes, photos). Le compte et le Wiki restent."""
    with cx.transaction():
        n = cx.execute("DELETE FROM collection WHERE user_id = %s", (u["id"],)).rowcount
    return {"retirees": n}


@router.delete("/cans/{ean}", status_code=204)
def supprimer(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> None:
    with cx.transaction():
        n = cx.execute("DELETE FROM collection WHERE user_id = %s AND ean = %s", (u["id"], ean)).rowcount
    if n == 0:
        raise HTTPException(404, "canette inconnue")


# --- Wiki : catalogue partagé, en lecture pour tous les comptes connectés ---------


COLONNES_FICHE = (
    "ean, nom, volume, categorie, gamme, flavor, " + _statut("") + " AS status, region, variante, description, "
    "(photo IS NOT NULL) AS a_photo, maj, source, cree, corrigee, "
    "COALESCE((SELECT array_agg(k.ean ORDER BY k.ean) FROM wiki_codes k WHERE k.fiche = wiki.ean), '{}') AS codes, "
    "COALESCE((SELECT json_agg(json_build_object('id', s.id, 'motif', s.motif, 'cree', s.cree) ORDER BY s.id) "
    "FROM wiki_signalements s WHERE s.fiche = wiki.ean AND s.traite IS NULL), '[]') AS signalements, moderation, "
    "COALESCE((SELECT json_agg(json_build_object('decision', m.decision, 'motif', m.motif, 'cree', m.cree) "
    "ORDER BY m.id) FROM wiki_moderations m WHERE m.fiche = wiki.ean), '[]') AS moderations, "
    # Échanges : nombre de collectionneurs qui en ont des doubles (2 exemplaires ou plus, code principal ou
    # secondaire) avec le partage activé dans leurs Réglages, et nombre de ceux qui la cherchent.
    "(SELECT COUNT(DISTINCT c.user_id) FROM collection c WHERE c.nb >= 2 "
    "AND (SELECT u.partage_doubles FROM users u WHERE u.id = c.user_id) AND (c.ean = wiki.ean OR "
    "c.ean IN (SELECT k.ean FROM wiki_codes k WHERE k.fiche = wiki.ean))) AS doubles, "
    "(SELECT COUNT(*) FROM recherches r WHERE r.fiche = wiki.ean) AS recherches"
)


def _fiche(r: dict, proprietaire: bool = False) -> dict:
    """Forme publique d'une fiche ; « photo » n'est qu'un marqueur de version.

    Le propriétaire reçoit en plus le statut de modération, la provenance (anonyme) et les signalements
    encore ouverts : les membres ne voient pas qu'une fiche est à vérifier.
    """
    fiche = {
        "ean": r["ean"], "nom": r["nom"], "volume": r["volume"],
        "categorie": r["categorie"] or r["gamme"], "flavor": r["flavor"], "status": r["status"],
        "region": r["region"], "variante": r["variante"],
        "description": r["description"], "photo": r["maj"] if r["a_photo"] else None,
        "codes": list(r["codes"]),
        "doubles": r["doubles"], "recherches": r["recherches"],
    }
    if proprietaire:
        fiche["moderation"] = r["moderation"]
        fiche["a_reprendre"] = _a_reprendre(r)
        fiche["provenance"] = {"source": r["source"], "cree": r["cree"], "corrigee": r["corrigee"]}
        fiche["signalements"] = r["signalements"]
        fiche["moderations"] = r["moderations"]
    return fiche


def _marquer_recherches(cx: psycopg.Connection, fiches: list[dict], user_id: int) -> list[dict]:
    """Ajoute, pour ce compte : « je_cherche » (notée comme recherchée) et « je_possede » (dans sa collection,
    sous son code principal ou un code secondaire), et « partage_doubles », le réglage du compte (désactivé, la
    fiche masque son bloc Échanges)."""
    partage = cx.execute("SELECT partage_doubles FROM users WHERE id = %s", (user_id,)).fetchone()
    miennes = {r["fiche"] for r in cx.execute("SELECT fiche FROM recherches WHERE user_id = %s", (user_id,))}
    possedees = {r["fiche"] for r in cx.execute(
        "SELECT COALESCE((SELECT k.fiche FROM wiki_codes k WHERE k.ean = c.ean), c.ean) AS fiche "
        "FROM collection c WHERE c.user_id = %s", (user_id,))}
    for f in fiches:
        f["je_cherche"] = f["ean"] in miennes
        f["je_possede"] = f["ean"] in possedees
        f["partage_doubles"] = bool(partage and partage["partage_doubles"])
    return fiches


def _fiche_du_code(cx: psycopg.Connection, code: str) -> str | None:
    """Code principal de la fiche dont « code » est un code-barres supplémentaire."""
    r = cx.execute("SELECT fiche FROM wiki_codes WHERE ean = %s", (code,)).fetchone()
    return r["fiche"] if r else None


def _fiche_de_la_ligne(cx: psycopg.Connection, code: str) -> str | None:
    """Fiche d'une ligne de collection dont le code est secondaire ou a été remplacé (même règle que JOINTURE_WIKI)."""
    r = cx.execute(
        "SELECT COALESCE((SELECT fiche FROM wiki_codes WHERE ean = %s), (SELECT vers FROM wiki_exclus WHERE ean = %s)) AS f",
        (code, code),
    ).fetchone()
    return r["f"]


def _code_pris(cx: psycopg.Connection, code: str) -> bool:
    """Vrai si le code est déjà celui d'une fiche, principal ou supplémentaire."""
    return cx.execute(
        "SELECT 1 FROM wiki WHERE ean = %s UNION ALL SELECT 1 FROM wiki_codes WHERE ean = %s LIMIT 1", (code, code),
    ).fetchone() is not None


# Texte indexé d'une fiche (migration 10) : la requête doit reprendre exactement cette expression pour
# que PostgreSQL utilise l'index trigramme.
DOC_RECHERCHE = (
    "sm_texte(nom || ' ' || flavor || ' ' || region || ' ' || COALESCE(NULLIF(categorie, ''), gamme) || ' ' || variante "
    "|| ' ' || ean)"
)
PAR_PAGE_MAX = 60


def _motif_like(mot: str) -> str:
    """Mot de recherche utilisable dans LIKE : % et _ y sont des caractères ordinaires."""
    return "%" + mot.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/wiki/recherche")
def wiki_recherche(
    q: str = Query(default="", max_length=120),
    categorie: str = Query(default="", max_length=80),
    region: str = Query(default="", max_length=80),
    variante: str = Query(default="", max_length=40),
    tri: Literal["pertinence", "nom", "recent"] = "pertinence",
    page: int = Query(default=1, ge=1, le=10_000),
    par_page: int = Query(default=24, ge=1, le=PAR_PAGE_MAX),
    signalees: bool = False,
    a_verifier: bool = False,
    sans_categorie: bool = False,
    nouveautes: bool = False,
    je_cherche: bool = False,
    doubles: bool = False,
    u: dict = Depends(utilisateur),
    cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Recherche paginée dans le catalogue partagé (jamais dans les collections).

    Chaque mot saisi doit apparaître dans le nom, la saveur, le pays, la gamme ou le code-barres, sans tenir
    compte des accents ni des majuscules ; un code-barres exact trouve aussi la fiche par ses codes secondaires.
    Sans résultat, des noms proches sont proposés (« Tu cherchais… ? »).
    """
    proprio = _est_proprietaire(u["email"])
    q = " ".join(q.split())
    mots = q.split(" ") if q else []
    conditions, params = [], []
    for mot in mots:
        conditions.append(f"({DOC_RECHERCHE} LIKE sm_texte(%s) "
                          "OR EXISTS (SELECT 1 FROM wiki_codes k WHERE k.fiche = wiki.ean AND k.ean = %s))")
        params += [_motif_like(mot), mot]
    if categorie:
        conditions.append("COALESCE(NULLIF(categorie, ''), gamme) = %s")
        params.append(categorie)
    if nouveautes:  # statut « Nouveauté » encore affiché (30 jours), quelle que soit la catégorie
        conditions.append(f"{_statut('')} = 'Nouveauté'")
    if sans_categorie and proprio:  # fiches à compléter (ni catégorie, ni ancienne « gamme ») ; ignoré pour un membre
        conditions.append("COALESCE(NULLIF(categorie, ''), gamme, '') = ''")
    if region:
        conditions.append("region = %s")
        params.append(region)
    if variante:
        conditions.append("variante = %s")
        params.append(variante)
    if je_cherche:  # les canettes que ce compte cherche
        conditions.append("EXISTS (SELECT 1 FROM recherches r WHERE r.fiche = wiki.ean AND r.user_id = %s)")
        params.append(u["id"])
    if doubles:  # au moins un collectionneur en a des doubles, partage activé
        conditions.append("EXISTS (SELECT 1 FROM collection c WHERE c.nb >= 2 "
                          "AND (SELECT u.partage_doubles FROM users u WHERE u.id = c.user_id) AND (c.ean = wiki.ean OR "
                          "c.ean IN (SELECT k.ean FROM wiki_codes k WHERE k.fiche = wiki.ean)))")
    if signalees and proprio:
        conditions.append("EXISTS (SELECT 1 FROM wiki_signalements s WHERE s.fiche = wiki.ean AND s.traite IS NULL)")
    if a_verifier and proprio:
        conditions.append("moderation = 'en_attente'")
    if not proprio:  # une fiche refusée n'apparaît plus dans le catalogue des membres
        conditions.append("moderation <> 'refusee'")
    visibles = "" if proprio else " WHERE moderation <> 'refusee'"
    ou = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    if tri == "recent":
        ordre, params_ordre = "cree DESC, ean", []
    elif tri == "pertinence" and q:
        # Code-barres exact, puis nom identique, puis nom qui commence par la saisie, puis les plus proches.
        ordre = ("CASE WHEN ean = %s OR EXISTS (SELECT 1 FROM wiki_codes k WHERE k.fiche = wiki.ean AND k.ean = %s) "
                 "THEN 0 WHEN sm_texte(nom) = sm_texte(%s) THEN 1 WHEN sm_texte(nom) LIKE sm_texte(%s) THEN 2 ELSE 3 END, "
                 "similarity(sm_texte(nom), sm_texte(%s)) DESC, (nom = ''), lower(nom), ean")
        params_ordre = [q, q, q, q.replace("%", "").replace("_", "") + "%", q]
    else:
        ordre, params_ordre = "(nom = ''), lower(nom), ean", []

    with cx.transaction():
        lignes = cx.execute(
            f"SELECT {COLONNES_FICHE}, COUNT(*) OVER () AS total_filtre FROM wiki{ou} ORDER BY {ordre} "
            "LIMIT %s OFFSET %s",
            (*params, *params_ordre, par_page, (page - 1) * par_page),
        ).fetchall()
        total = lignes[0]["total_filtre"] if lignes else (
            cx.execute(f"SELECT COUNT(*) AS n FROM wiki{ou}", params).fetchone()["n"] if page > 1 else 0
        )
        total_catalogue = cx.execute(f"SELECT COUNT(*) AS n FROM wiki{visibles}").fetchone()["n"]
        suggestions = []
        if total == 0 and q:
            suggestions = [r["nom"] for r in cx.execute(
                "SELECT nom, GREATEST(similarity(sm_texte(nom), sm_texte(%s)), "
                "word_similarity(sm_texte(%s), sm_texte(nom)), word_similarity(sm_texte(nom), sm_texte(%s))) AS score FROM wiki "
                "WHERE nom <> ''" + ("" if proprio else " AND moderation <> 'refusee'")
                + " ORDER BY score DESC, lower(nom) LIMIT 3",
                (q, q, q),
            ).fetchall() if r["score"] >= 0.3]
        nb_signalees = cx.execute(
            "SELECT COUNT(DISTINCT fiche) AS n FROM wiki_signalements WHERE traite IS NULL"
        ).fetchone()["n"] if proprio else 0
        nb_a_verifier = cx.execute(
            "SELECT COUNT(*) AS n FROM wiki WHERE moderation = 'en_attente'"
        ).fetchone()["n"] if proprio else 0
        fiches = _marquer_recherches(cx, [_fiche(r, proprio) for r in lignes], u["id"])
        nb_je_cherche = cx.execute("SELECT COUNT(*) AS n FROM recherches WHERE user_id = %s", (u["id"],)).fetchone()["n"]
    return {
        "peut_editer": proprio,
        "fiches": fiches,
        "je_cherche": nb_je_cherche,
        "total": total,
        "total_catalogue": total_catalogue,
        "page": page,
        "pages": max(1, -(-total // par_page)),
        "suggestions": suggestions,
        "signalees": nb_signalees,
        "a_verifier": nb_a_verifier,
    }


@router.get("/wiki")
def wiki_liste(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Toutes les fiches, sans les photos (servies à part, pour garder la réponse légère)."""
    with cx.transaction():
        proprio = _est_proprietaire(u["email"])
        visibles = "" if proprio else " WHERE moderation <> 'refusee'"
        lignes = cx.execute(
            f"SELECT {COLONNES_FICHE} FROM wiki{visibles} ORDER BY (nom = ''), lower(nom), ean"
        ).fetchall()
        fiches = _marquer_recherches(cx, [_fiche(r, proprio) for r in lignes], u["id"])
    return {"peut_editer": proprio, "fiches": fiches}


@router.post("/wiki/{ean}/recherche")
def wiki_chercher(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Note la canette comme recherchée par ce compte (pour les échanges). Sans effet si elle l'est déjà."""
    proprio = _est_proprietaire(u["email"])
    with cx.transaction():
        f = cx.execute("SELECT moderation FROM wiki WHERE ean = %s", (ean,)).fetchone()
        if f is None or (f["moderation"] == "refusee" and not proprio):
            raise HTTPException(404, "fiche inconnue")
        if cx.execute(
            "SELECT 1 FROM collection c WHERE c.user_id = %s AND (c.ean = %s OR "
            "c.ean IN (SELECT k.ean FROM wiki_codes k WHERE k.fiche = %s))", (u["id"], ean, ean),
        ).fetchone():
            raise HTTPException(409, "cette canette est déjà dans ta collection")
        cx.execute("INSERT INTO recherches (user_id, fiche, ajout) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                   (u["id"], ean, maintenant()))
        r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (ean,)).fetchone()
        return _marquer_recherches(cx, [_fiche(r, proprio)], u["id"])[0]


@router.delete("/wiki/{ean}/recherche")
def wiki_ne_plus_chercher(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Retire la canette des recherchées de ce compte. Sans effet si elle n'y était pas."""
    proprio = _est_proprietaire(u["email"])
    with cx.transaction():
        cx.execute("DELETE FROM recherches WHERE user_id = %s AND fiche = %s", (u["id"], ean))
        r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (ean,)).fetchone()
        if r is None or (r["moderation"] == "refusee" and not proprio):
            raise HTTPException(404, "fiche inconnue")
        return _marquer_recherches(cx, [_fiche(r, proprio)], u["id"])[0]


# --- Échanges, étape 2 : mise en relation et messagerie --------------------------------------------------

MESSAGES_MAX_HEURE = 60  # messages envoyés par compte et par heure

# Une mise en relation en attente (« signalee », « demandee ») ne vaut que tant que le chercheur cherche toujours la
# canette, que le possesseur en a encore au moins 2, et que tous deux partagent leurs doublons. Sinon elle est
# simplement masquée (et redevient visible si les conditions reviennent).
_EN_RELATION_VALIDE = (
    "EXISTS (SELECT 1 FROM recherches r WHERE r.user_id = e.chercheur AND r.fiche = e.fiche) "
    "AND EXISTS (SELECT 1 FROM collection c WHERE c.user_id = e.possesseur AND c.nb >= 2 AND (c.ean = e.fiche OR "
    "c.ean IN (SELECT k.ean FROM wiki_codes k WHERE k.fiche = e.fiche))) "
    "AND (SELECT u.partage_doubles FROM users u WHERE u.id = e.chercheur) "
    "AND (SELECT u.partage_doubles FROM users u WHERE u.id = e.possesseur) "
    "AND NOT EXISTS (SELECT 1 FROM signalements_membres s WHERE "
    "(s.auteur = e.chercheur AND s.signale = e.possesseur) OR (s.auteur = e.possesseur AND s.signale = e.chercheur))"
)

CONVERSATIONS = ("acceptee", "terminee", "fermee")


def _reperer_paires(cx: psycopg.Connection, user_id: int) -> None:
    """Crée les mises en relation de ce compte comme chercheur : chaque collectionneur qui a en double une canette
    qu'il cherche (partage activé des deux côtés). Une paire déjà connue, même annulée, n'est jamais recréée."""
    now = maintenant()
    cx.execute(
        "INSERT INTO echanges (fiche, chercheur, possesseur, statut, cree, maj) "
        "SELECT DISTINCT r.fiche, r.user_id, c.user_id, 'signalee', %s, %s FROM recherches r "
        "JOIN users ur ON ur.id = r.user_id AND ur.partage_doubles "
        "JOIN collection c ON c.nb >= 2 AND c.user_id <> r.user_id AND (c.ean = r.fiche OR "
        "c.ean IN (SELECT k.ean FROM wiki_codes k WHERE k.fiche = r.fiche)) "
        "JOIN users uc ON uc.id = c.user_id AND uc.partage_doubles "
        "WHERE r.user_id = %s AND NOT EXISTS (SELECT 1 FROM signalements_membres s WHERE "
        "(s.auteur = r.user_id AND s.signale = c.user_id) OR (s.auteur = c.user_id AND s.signale = r.user_id)) "
        "ON CONFLICT DO NOTHING",
        (now, now, user_id),
    )


def _echange_du_compte(cx: psycopg.Connection, echange_id: int, user_id: int) -> dict:
    """La mise en relation, si ce compte y prend part ; 404 sinon (sans dire si elle existe)."""
    e = cx.execute(
        "SELECT e.*, w.nom, CASE WHEN w.photo IS NOT NULL THEN w.maj END AS photo_wiki FROM echanges e JOIN wiki w ON w.ean = e.fiche "
        "WHERE e.id = %s AND %s IN (e.chercheur, e.possesseur)", (echange_id, user_id),
    ).fetchone()
    if e is None:
        raise HTTPException(404, "échange inconnu")
    e["role"] = "chercheur" if e["chercheur"] == user_id else "possesseur"
    return e


def _en_relation_valide(cx: psycopg.Connection, echange_id: int) -> bool:
    return cx.execute(f"SELECT 1 FROM echanges e WHERE e.id = %s AND {_EN_RELATION_VALIDE}", (echange_id,)).fetchone() is not None


def _vue_echange(e: dict) -> dict:
    """Ce qu'un membre voit d'une mise en relation : jamais l'identité ni l'adresse de l'autre."""
    moi, autre = ("valide_chercheur", "valide_possesseur") if e["role"] == "chercheur" else ("valide_possesseur", "valide_chercheur")
    return {
        "id": e["id"], "role": e["role"], "statut": e["statut"], "maj": e["maj"],
        "fiche": {"ean": e["fiche"], "nom": e["nom"], "photo": e["photo_wiki"]},
        "valide_moi": bool(e.get(moi)), "valide_autre": bool(e.get(autre)),
    }


@router.get("/echanges")
def echanges(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Notifications (mises en relation qui attendent une réponse de ce compte, ou ses demandes en attente) et
    conversations ouvertes, avec le nombre d'éléments non lus (pastille de l'appli)."""
    uid = u["id"]
    with cx.transaction():
        _reperer_paires(cx, uid)
        lignes = cx.execute(
            "SELECT e.*, w.nom, CASE WHEN w.photo IS NOT NULL THEN w.maj END AS photo_wiki, "
            "(SELECT COUNT(*) FROM messages m WHERE m.echange = e.id AND m.auteur <> %s AND m.id > "
            " CASE WHEN e.chercheur = %s THEN e.vu_chercheur ELSE e.vu_possesseur END) AS non_lus, "
            "(SELECT m.texte FROM messages m WHERE m.echange = e.id ORDER BY m.id DESC LIMIT 1) AS dernier, "
            f"({_EN_RELATION_VALIDE}) AS valide "
            "FROM echanges e JOIN wiki w ON w.ean = e.fiche "
            "WHERE %s IN (e.chercheur, e.possesseur) AND e.statut <> 'annulee' ORDER BY e.maj DESC, e.id DESC",
            (uid, uid, uid),
        ).fetchall()
    notifications, conversations, fiches_vues = [], [], set()
    # Côté chercheur, une seule notification par canette à la fois : la plus ancienne paire, et aucune tant
    # qu'une demande pour cette canette attend une réponse ou qu'une conversation est ouverte.
    occupees = {e["fiche"] for e in lignes if e["chercheur"] == uid and e["statut"] in ("demandee", "acceptee", "terminee")}
    for e in sorted(lignes, key=lambda x: x["id"]):
        e["role"] = "chercheur" if e["chercheur"] == uid else "possesseur"
        if e["statut"] in CONVERSATIONS:
            continue
        if not e["valide"]:
            continue
        if e["statut"] == "signalee":
            if e["role"] != "chercheur" or e["fiche"] in occupees or e["fiche"] in fiches_vues:
                continue
            fiches_vues.add(e["fiche"])
        notifications.append({**_vue_echange(e), "action": e["role"] == "chercheur" and e["statut"] == "signalee"
                              or e["role"] == "possesseur" and e["statut"] == "demandee"})
    for e in lignes:
        if e["statut"] in CONVERSATIONS:
            vue = _vue_echange(e)
            # L'autre a validé l'échange : c'est à ce compte de valider (compté dans la pastille).
            vue["a_valider"] = e["statut"] == "acceptee" and vue["valide_autre"] and not vue["valide_moi"]
            conversations.append({**vue, "non_lus": e["non_lus"], "dernier": e["dernier"]})
    notifications.sort(key=lambda n: n["maj"], reverse=True)
    a_traiter = sum(1 for n in notifications if n["action"]) + sum(1 for c in conversations if c["a_valider"])
    return {"notifications": notifications, "conversations": conversations,
            "non_lus": a_traiter + sum(c["non_lus"] for c in conversations)}


@router.post("/echanges/{echange_id}/accepter")
def accepter_echange(echange_id: int, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """« Échange » : le chercheur demande l'échange (le possesseur est notifié), puis le possesseur l'accepte
    (la messagerie s'ouvre pour les deux)."""
    with cx.transaction():
        e = _echange_du_compte(cx, echange_id, u["id"])
        suivant = {("chercheur", "signalee"): "demandee", ("possesseur", "demandee"): "acceptee"}.get((e["role"], e["statut"]))
        if suivant is None or not _en_relation_valide(cx, echange_id):
            raise HTTPException(409, "cet échange n'attend pas ta réponse")
        cx.execute("UPDATE echanges SET statut = %s, maj = %s WHERE id = %s", (suivant, maintenant(), echange_id))
        e["statut"] = suivant
    return _vue_echange(e)


@router.post("/echanges/{echange_id}/annuler")
def annuler_echange(echange_id: int, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """« Annuler » : la mise en relation s'arrête là, rien n'est envoyé à l'autre. Elle n'est jamais reproposée."""
    with cx.transaction():
        e = _echange_du_compte(cx, echange_id, u["id"])
        if e["statut"] not in ("signalee", "demandee") or (e["role"] == "possesseur" and e["statut"] != "demandee"):
            raise HTTPException(409, "cet échange ne peut plus être annulé")
        cx.execute("UPDATE echanges SET statut = 'annulee', maj = %s WHERE id = %s", (maintenant(), echange_id))
        e["statut"] = "annulee"
    return _vue_echange(e)


def _conversation(cx: psycopg.Connection, echange_id: int, user_id: int, ecriture: bool = False) -> dict:
    """Conversation de ce compte (404 sinon). Une conversation fermée par un signalement reste lisible, mais plus
    personne n'y écrit (409)."""
    e = _echange_du_compte(cx, echange_id, user_id)
    if e["statut"] not in CONVERSATIONS:
        raise HTTPException(404, "conversation inconnue")
    if ecriture and e["statut"] == "fermee":
        raise HTTPException(409, "conversation fermée")
    return e


@router.get("/echanges/{echange_id}/messages")
def lire_messages(
    echange_id: int, apres: int = Query(default=0, ge=0),
    u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Messages de la conversation (après « apres » pour les relectures), marqués lus pour ce compte."""
    with cx.transaction():
        e = _conversation(cx, echange_id, u["id"])
        lignes = cx.execute(
            "SELECT id, auteur, texte, cree FROM messages WHERE echange = %s AND id > %s ORDER BY id LIMIT 500",
            (echange_id, apres),
        ).fetchall()
        if lignes:
            colonne = "vu_chercheur" if e["role"] == "chercheur" else "vu_possesseur"
            cx.execute(f"UPDATE echanges SET {colonne} = GREATEST({colonne}, %s) WHERE id = %s",
                       (lignes[-1]["id"], echange_id))
    return {**_vue_echange(e), "messages": [
        {"id": m["id"], "de_moi": m["auteur"] == u["id"], "texte": m["texte"], "cree": m["cree"]} for m in lignes
    ]}


@router.post("/echanges/{echange_id}/messages")
def envoyer_message(
    echange_id: int, m: Message, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Envoie un message à l'autre membre de l'échange (texte seul, 1 000 caractères au plus)."""
    texte = m.texte.strip()
    if not texte:
        raise HTTPException(422, "message vide")
    now = int(time.time())
    with cx.transaction():
        e = _conversation(cx, echange_id, u["id"], ecriture=True)
    _compter(cx, _cle_limite(f"message:{u['id']}"), _seuil("SM_MESSAGES_MAX_HEURE", MESSAGES_MAX_HEURE),
             FENETRE_DEMANDES, now, "trop de messages, réessaie plus tard")
    with cx.transaction():
        r = cx.execute("INSERT INTO messages (echange, auteur, texte, cree) VALUES (%s, %s, %s, %s) RETURNING id, cree",
                       (echange_id, u["id"], texte, maintenant())).fetchone()
        colonne = "vu_chercheur" if e["role"] == "chercheur" else "vu_possesseur"
        cx.execute(f"UPDATE echanges SET {colonne} = %s, maj = %s WHERE id = %s", (r["id"], maintenant(), echange_id))
    return {"id": r["id"], "de_moi": True, "texte": texte, "cree": r["cree"]}


SIGNALEMENTS_MEMBRES_MAX_JOUR = 10


def _ligne_de_collection(cx: psycopg.Connection, user_id: int, fiche: str) -> dict | None:
    """La canette de ce compte pour cette fiche (code principal ou secondaire)."""
    return cx.execute(
        "SELECT ean, nb FROM collection WHERE user_id = %s AND (ean = %s OR ean IN "
        "(SELECT k.ean FROM wiki_codes k WHERE k.fiche = %s)) ORDER BY (ean = %s) DESC LIMIT 1",
        (user_id, fiche, fiche, fiche),
    ).fetchone()


@router.post("/echanges/{echange_id}/valider")
def valider_echange(echange_id: int, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """« Valider l'échange » : l'échange a eu lieu. Quand les deux ont validé, -1 dans la collection du possesseur
    et +1 dans celle du chercheur (la canette y est ajoutée si besoin et n'est plus recherchée)."""
    with cx.transaction():
        e = _echange_du_compte(cx, echange_id, u["id"])
        if e["statut"] != "acceptee":
            raise HTTPException(409, "cet échange ne peut plus être validé")
        colonne = "valide_chercheur" if e["role"] == "chercheur" else "valide_possesseur"
        e[colonne] = True
        if e["valide_chercheur"] and e["valide_possesseur"]:
            donnee = _ligne_de_collection(cx, e["possesseur"], e["fiche"])
            if donnee is None or donnee["nb"] < 2:
                raise HTTPException(409, "la canette n'est plus en double chez l'autre collectionneur")
            now = maintenant()
            cx.execute("UPDATE collection SET nb = nb - 1, maj = %s WHERE user_id = %s AND ean = %s",
                       (now, e["possesseur"], donnee["ean"]))
            recue = _ligne_de_collection(cx, e["chercheur"], e["fiche"])
            if recue:
                cx.execute("UPDATE collection SET nb = nb + 1, maj = %s WHERE user_id = %s AND ean = %s",
                           (now, e["chercheur"], recue["ean"]))
            else:
                cx.execute(
                    "INSERT INTO collection (user_id, ean, nom, volume, etat, nb, notes, ajout, maj) "
                    "SELECT %s, ean, nom, volume, '', 1, '', %s, %s FROM wiki WHERE ean = %s",
                    (e["chercheur"], now, now, e["fiche"]),
                )
            cx.execute("DELETE FROM recherches WHERE user_id = %s AND fiche = %s", (e["chercheur"], e["fiche"]))
            e["statut"] = "terminee"
        cx.execute(f"UPDATE echanges SET {colonne} = true, statut = %s, maj = %s WHERE id = %s",
                   (e["statut"], maintenant(), echange_id))
    return _vue_echange(e)


@router.post("/echanges/{echange_id}/signaler")
def signaler_membre(
    echange_id: int, sg: SignalementMembre, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Signale l'autre membre de la conversation : elle se ferme pour les deux, et ils ne sont plus mis en relation.
    Le propriétaire du service examine le signalement."""
    now = int(time.time())
    with cx.transaction():
        e = _conversation(cx, echange_id, u["id"], ecriture=True)
    _compter(cx, _cle_limite(f"signalement-membre:{u['id']}"), SIGNALEMENTS_MEMBRES_MAX_JOUR, FENETRE_JOUR, now,
             "trop de signalements, réessaie demain")
    autre = e["possesseur"] if e["role"] == "chercheur" else e["chercheur"]
    with cx.transaction():
        cx.execute(
            "INSERT INTO signalements_membres (echange, auteur, signale, motif, detail, cree) VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (echange, auteur) DO NOTHING",
            (echange_id, u["id"], autre, sg.motif, sg.detail.strip(), maintenant()),
        )
        cx.execute("UPDATE echanges SET statut = 'fermee', maj = %s WHERE id = %s", (maintenant(), echange_id))
        e["statut"] = "fermee"
    return _vue_echange(e)


def _reserve_au_proprietaire(u: dict) -> None:
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")


@router.get("/admin/signalements-membres")
def signalements_membres(u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> list[dict]:
    """Signalements non traités, avec la conversation, pour le propriétaire. Les membres y sont désignés par
    leur rôle (auteur du signalement, membre signalé) et un numéro, jamais par leur adresse."""
    _reserve_au_proprietaire(u)
    with cx.transaction():
        lignes = cx.execute(
            "SELECT s.id, s.echange, s.auteur, s.signale, s.motif, s.detail, s.cree, w.nom, "
            "(SELECT COUNT(*) FROM signalements_membres t WHERE t.signale = s.signale) AS signalements_du_membre "
            "FROM signalements_membres s JOIN echanges e ON e.id = s.echange JOIN wiki w ON w.ean = e.fiche "
            "WHERE s.traite IS NULL ORDER BY s.id",
        ).fetchall()
        resultat = []
        for s in lignes:
            messages = cx.execute(
                "SELECT auteur, texte, cree FROM messages WHERE echange = %s ORDER BY id", (s["echange"],),
            ).fetchall()
            resultat.append({
                "id": s["id"], "motif": s["motif"], "detail": s["detail"], "cree": s["cree"], "canette": s["nom"],
                "membre_signale": s["signale"], "signalements_du_membre": s["signalements_du_membre"],
                "messages": [{"de": "auteur" if m["auteur"] == s["auteur"] else "signale", "texte": m["texte"],
                              "cree": m["cree"]} for m in messages],
            })
    return resultat


@router.post("/admin/signalements-membres/{signalement_id}/traite")
def signalement_membre_traite(
    signalement_id: int, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    _reserve_au_proprietaire(u)
    with cx.transaction():
        n = cx.execute("UPDATE signalements_membres SET traite = %s WHERE id = %s AND traite IS NULL",
                       (maintenant(), signalement_id)).rowcount
    if not n:
        raise HTTPException(404, "signalement inconnu")
    return {"id": signalement_id}


@router.get("/wiki/saveurs")
def wiki_saveurs(cx: psycopg.Connection = Depends(connexion)) -> list[str]:
    """Saveurs déjà connues (les plus fréquentes d'abord), proposées dans les formulaires."""
    with cx.transaction():
        lignes = cx.execute(
            "SELECT flavor FROM wiki WHERE flavor <> '' AND length(flavor) <= %s AND moderation <> 'refusee' "
            "GROUP BY flavor ORDER BY COUNT(*) DESC, lower(flavor) LIMIT 300",
            (SAVEUR_MAX,),
        ).fetchall()
    return [r["flavor"] for r in lignes]


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
    return _fiche(r, proprietaire=True)


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
    return _fiche(r, proprietaire=True)


@router.put("/wiki/{ean}")
def wiki_modifier(ean: str, f: FicheWiki, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Complète ou corrige une fiche (description, champs descriptifs…) : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    nouvel_ean = f.ean.strip() if f.ean is not None else ean
    if not nouvel_ean:
        raise HTTPException(422, "code-barres obligatoire")
    if nouvel_ean != ean:
        nouvel_ean = _normaliser_code(nouvel_ean)
        if nouvel_ean is None:
            raise HTTPException(422, "code-barres invalide")
    now = int(time.time())
    with cx.transaction():
        if nouvel_ean != ean:
            if _code_pris(cx, nouvel_ean):
                raise HTTPException(409, "ce code-barres existe déjà dans le Wiki")
        r = cx.execute(
            "UPDATE wiki SET ean = %s, nom = %s, "
            "volume = %s, categorie = %s, flavor = %s, status = %s, region = %s, variante = %s, "
            # Une Nouveauté encore en cours garde sa date ; sinon le délai de 30 jours (re)part maintenant.
            "nouveaute_depuis = CASE WHEN %s <> 'Nouveauté' THEN NULL "
            "WHEN status = 'Nouveauté' AND nouveaute_depuis >= %s THEN nouveaute_depuis ELSE %s END, "
            "description = %s, maj = %s, corrigee = %s "
            f"WHERE ean = %s RETURNING {COLONNES_FICHE}",
            (nouvel_ean, f.nom.strip(),
             f.volume, f.categorie, f.flavor, f.status, f.region, f.variante, f.status, now - DUREE_NOUVEAUTE, now,
             f.description.strip(), maintenant(), maintenant(), ean),
        ).fetchone()
        if r is None:
            raise HTTPException(404, "fiche inconnue")
        if nouvel_ean != ean:
            _suivre_changement_de_code(cx, ean, nouvel_ean)
            # Relecture : les codes supplémentaires ne suivent le nouveau code qu'en fin d'instruction.
            r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (nouvel_ean,)).fetchone()
    return _fiche(r, proprietaire=True)


def _suivre_changement_de_code(cx: psycopg.Connection, ancien: str, nouveau: str) -> None:
    """Après un changement de code d'une fiche : les collections suivent, l'ancien code n'est plus recréé."""
    # Un compte qui possède déjà le nouveau code garde ses deux lignes.
    cx.execute(
        "UPDATE collection c SET ean = %s, maj = %s WHERE c.ean = %s AND NOT EXISTS "
        "(SELECT 1 FROM collection d WHERE d.user_id = c.user_id AND d.ean = %s)",
        (nouveau, maintenant(), ancien, nouveau),
    )
    cx.execute("DELETE FROM wiki_exclus WHERE ean = %s", (nouveau,))
    cx.execute(
        "INSERT INTO wiki_exclus (ean, exclu, vers) VALUES (%s, %s, %s) "
        "ON CONFLICT (ean) DO UPDATE SET vers = EXCLUDED.vers",
        (ancien, maintenant(), nouveau),
    )
    cx.execute("UPDATE wiki_exclus SET vers = %s WHERE vers = %s", (nouveau, ancien))  # redirections en chaîne


@router.post("/wiki/{ean}/code-barres")
def wiki_associer_code(
    ean: str, corps: CodeBarres, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Rattache un code-barres scanné à une fiche existante.

    Fiche à code interne (préfixe 20) : le code scanné devient son code principal.
    Fiche qui a déjà un vrai code : il devient un code supplémentaire (autre pays, autre format).
    """
    nouveau = _normaliser_code(corps.ean.strip())
    if nouveau is None or nouveau.startswith("LOCAL-") or CODE_INTERNE_RE.match(nouveau):
        raise HTTPException(422, "code-barres invalide")
    try:
        with cx.transaction():
            if _code_pris(cx, nouveau):
                raise HTTPException(409, "ce code-barres est déjà dans le Wiki")
            if cx.execute("SELECT 1 FROM wiki WHERE ean = %s FOR UPDATE", (ean,)).fetchone() is None:
                raise HTTPException(404, "fiche inconnue")
            if CODE_INTERNE_RE.match(ean):
                cx.execute("UPDATE wiki SET ean = %s, maj = %s WHERE ean = %s", (nouveau, maintenant(), ean))
                _suivre_changement_de_code(cx, ean, nouveau)
                principal = nouveau
            else:
                cx.execute(
                    "INSERT INTO wiki_codes (ean, fiche, ajout) VALUES (%s, %s, %s)", (nouveau, ean, maintenant()),
                )
                # Une canette déjà enregistrée sous ce code rejoint la fiche, sauf si le compte l'a déjà.
                cx.execute(
                    "UPDATE collection c SET ean = %s, maj = %s WHERE c.ean = %s AND NOT EXISTS "
                    "(SELECT 1 FROM collection d WHERE d.user_id = c.user_id AND d.ean = %s)",
                    (ean, maintenant(), nouveau, ean),
                )
                cx.execute("DELETE FROM wiki_exclus WHERE ean = %s", (nouveau,))
                principal = ean
            r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (principal,)).fetchone()
    except psycopg.errors.UniqueViolation:  # deux associations simultanées du même code
        raise HTTPException(409, "ce code-barres est déjà dans le Wiki") from None
    return _fiche(r)


@router.delete("/wiki/{ean}/code-barres/{code}")
def wiki_retirer_code(
    ean: str, code: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Retire un code-barres supplémentaire associé par erreur : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        n = cx.execute("DELETE FROM wiki_codes WHERE ean = %s AND fiche = %s", (code, ean)).rowcount
        if n == 0:
            raise HTTPException(404, "code inconnu pour cette fiche")
        r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (ean,)).fetchone()
    return _fiche(r)


@router.delete("/wiki/{ean}", status_code=204)
def wiki_supprimer(ean: str, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> Response:
    """Supprime une fiche du catalogue partagé : réservé à OWNER_EMAIL."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        # Une canette n'existe que dans le Wiki : une fiche encore dans une collection ne se supprime pas.
        if cx.execute(
            "SELECT 1 FROM collection WHERE ean = %s OR ean IN (SELECT ean FROM wiki_codes WHERE fiche = %s) "
            "OR ean IN (SELECT ean FROM wiki_exclus WHERE vers = %s) LIMIT 1",
            (ean, ean, ean),
        ).fetchone():
            raise HTTPException(409, "cette canette est dans au moins une collection : suppression impossible")
        # Ses codes supplémentaires disparaissent avec elle et ne doivent pas la recréer non plus.
        cx.execute(
            "INSERT INTO wiki_exclus (ean, exclu) SELECT ean, %s FROM wiki_codes WHERE fiche = %s "
            "ON CONFLICT (ean) DO NOTHING",
            (maintenant(), ean),
        )
        n = cx.execute("DELETE FROM wiki WHERE ean = %s", (ean,)).rowcount
        if n:
            cx.execute("UPDATE wiki_exclus SET vers = NULL WHERE vers = %s", (ean,))  # plus de redirection
            cx.execute(
                "INSERT INTO wiki_exclus (ean, exclu) VALUES (%s, %s) ON CONFLICT (ean) DO NOTHING",
                (ean, maintenant()),
            )
    if n == 0:
        raise HTTPException(404, "fiche inconnue")
    return Response(status_code=204)


@router.post("/wiki/{ean}/signalement", status_code=201)
def wiki_signaler(
    ean: str, sig: Signalement, request: Request,
    u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Signale une erreur sur une fiche. Le motif est gardé sans lien avec le compte (comme la fiche)."""
    _limiter_ip(cx, request, "signalement", 20, int(time.time()))
    with cx.transaction():
        if not cx.execute("SELECT 1 FROM wiki WHERE ean = %s", (ean,)).fetchone():
            raise HTTPException(404, "fiche inconnue")
        cx.execute(
            "INSERT INTO wiki_signalements (fiche, motif, cree) VALUES (%s, %s, %s)", (ean, sig.motif, maintenant()),
        )
    return {"ok": True}


def _doublons_probables(cx: psycopg.Connection, nom: str) -> list[str]:
    """Noms de fiches très proches du nom proposé (doublon probable), hors fiches refusées."""
    # word_similarity : un nom existant contenu, à une faute près, dans le nom proposé (« Monster Mango Loko »
    # contient presque « Mango Loco »), sans pénaliser les mots en plus comme « Monster ».
    return [r["nom"] for r in cx.execute(
        "SELECT nom, GREATEST(similarity(sm_texte(nom), sm_texte(%s)), word_similarity(sm_texte(nom), sm_texte(%s))) AS score "
        "FROM wiki WHERE moderation <> 'refusee' AND nom <> '' ORDER BY score DESC, lower(nom) LIMIT 3",
        (nom, nom),
    ).fetchall() if r["score"] >= 0.6]


@router.post("/wiki/propositions", status_code=201)
def wiki_proposer(
    prop: Proposition, request: Request, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion),
) -> dict:
    """Un membre propose une canette au catalogue : elle est créée « à vérifier » (acceptée si c'est le propriétaire).

    Sans code-barres, le code est tiré du nom (convert.py). Un code déjà connu est refusé ; un nom très proche
    d'une fiche existante demande une confirmation (confirmer_doublon) pour éviter les doublons.
    """
    _limiter_ip(cx, request, "proposition", 30, int(time.time()))
    proprio = _est_proprietaire(u["email"])
    if prop.ean.strip():
        ean = _normaliser_code(prop.ean.strip())
        if ean is None or ean.startswith("LOCAL-"):
            raise HTTPException(422, "code-barres invalide")
    else:
        ean = convert.nom_en_13_chiffres(prop.nom)
    with cx.transaction():
        if _code_pris(cx, ean) or cx.execute("SELECT 1 FROM wiki_exclus WHERE ean = %s", (ean,)).fetchone():
            raise HTTPException(409, "cette canette existe déjà dans le Wiki" if prop.ean.strip()
                                else "une canette du même nom existe déjà dans le Wiki")
        if not prop.confirmer_doublon:
            proches = _doublons_probables(cx, prop.nom)
            if proches:
                raise HTTPException(409, "doublon probable : " + " ; ".join(proches))
        r = cx.execute(
            """INSERT INTO wiki (ean, nom, volume, categorie, flavor, region, variante, photo, source, moderation, cree, maj)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'proposition', %s, %s, %s)
               RETURNING """ + COLONNES_FICHE,
            (ean, prop.nom, prop.volume, prop.categorie, prop.flavor, prop.region, prop.variante,
             prop.photo, "acceptee" if proprio else "en_attente", maintenant(), maintenant()),
        ).fetchone()
    return _fiche(r, proprio)


@router.post("/wiki/{ean}/moderation")
def wiki_moderer(ean: str, d: Decision, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Le propriétaire accepte ou refuse une fiche ; chaque décision est gardée dans l'historique."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        if cx.execute("UPDATE wiki SET moderation = %s, maj = %s WHERE ean = %s", (d.decision, maintenant(), ean)).rowcount == 0:
            raise HTTPException(404, "fiche inconnue")
        cx.execute(
            "INSERT INTO wiki_moderations (fiche, decision, motif, cree) VALUES (%s, %s, %s, %s)",
            (ean, d.decision, " ".join(d.motif.split()), maintenant()),
        )
        r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (ean,)).fetchone()
    return _fiche(r, proprietaire=True)


@router.post("/wiki/signalements/{ident}/traite")
def wiki_signalement_traite(ident: int, u: dict = Depends(utilisateur), cx: psycopg.Connection = Depends(connexion)) -> dict:
    """Le propriétaire classe un signalement (corrigé ou rejeté) ; renvoie la fiche à jour."""
    if not _est_proprietaire(u["email"]):
        raise HTTPException(403, "réservé au propriétaire")
    with cx.transaction():
        s = cx.execute(
            "UPDATE wiki_signalements SET traite = %s WHERE id = %s AND traite IS NULL RETURNING fiche",
            (maintenant(), ident),
        ).fetchone()
        if s is None:
            raise HTTPException(404, "signalement inconnu ou déjà traité")
        r = cx.execute(f"SELECT {COLONNES_FICHE} FROM wiki WHERE ean = %s", (s["fiche"],)).fetchone()
    return _fiche(r, proprietaire=True)


app = FastAPI(title="StackMonsters", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(RequestValidationError)
async def _validation_lisible(_: Request, e: RequestValidationError) -> JSONResponse:
    """422 avec un message lisible (« volume attendu en ml… ») au lieu de la liste brute de Pydantic."""
    messages = [str(err.get("msg", "")).removeprefix("Value error, ") for err in e.errors()]
    return JSONResponse(status_code=422, content={"detail": " ; ".join(m for m in messages if m) or "données invalides"})

for r in (auth, router):  # avec et sans le préfixe /api (selon ce que Vercel transmet)
    app.include_router(r)
    app.include_router(r, prefix="/api")
