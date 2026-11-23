"""Garde-fou de ./dev.sh : refuser de démarrer (et donc de migrer) sur la base de production.

Le 23/11/2026, ./dev.sh --migrer lancé avec un .env.local qui pointait sur la production a appliqué une
migration encore en cours d'écriture. Désormais (logique « fail-closed ») :

- sans déclaration, seules les bases LOCALES sont acceptées : localhost, 127.x.x.x, ::1, socket Unix (chemin ou
  aucun hôte), nom de conteneur sans point (« db ») ;
- une base distante n'est acceptée que si SM_PROD_DB_HOST (dans .env.local, jamais dans le dépôt) est déclarée et
  qu'aucun des hôtes de DATABASE_URL n'y correspond. Plusieurs hôtes possibles, séparés par des virgules ; pour
  Neon (*.neon.tech) et Vercel Postgres (*.vercel-storage.com), la comparaison porte sur l'identifiant
  d'endpoint (« ep-… », avec ou sans « -pooler ») ;
- les hôtes sont lus dans l'URL (y compris plusieurs hôtes et le paramètre ?host= / ?hostaddr=), dans la forme
  mots-clés (« host=… dbname=… ») et, à défaut, dans PGHOST / PGHOSTADDR ; une DATABASE_URL illisible est refusée ;
- seule exception : SM_JE_VEUX_LA_PROD=1, avec un avertissement en rouge.

Code de sortie 0 : démarrage autorisé ; 1 : refus. N'utilise que la bibliothèque standard (lancé avant la
création éventuelle du .venv) et n'affiche jamais l'URL complète (elle contient le mot de passe).
"""

from __future__ import annotations

import ipaddress
import os
import shlex
import sys
import urllib.parse

ROUGE, FIN = "\033[1;31m", "\033[0m"
DOMAINES_ENDPOINT = (".neon.tech", ".vercel-storage.com")


class Illisible(ValueError):
    """DATABASE_URL dont on ne sait pas lire les hôtes : refusée par prudence."""


def _endpoint(hote: str) -> str:
    """Identifiant comparable d'un hôte : pour Neon / Vercel Postgres, « ep-xxx » sans « -pooler »."""
    hote = hote.strip().lower().rstrip(".")
    if hote.endswith(DOMAINES_ENDPOINT):
        return hote.split(".", 1)[0].removesuffix("-pooler")
    return hote


def _est_local(hote: str) -> bool:
    hote = hote.strip().lower()
    if not hote or hote.startswith("/") or hote == "localhost":
        return True  # socket Unix (chemin)
    try:
        return ipaddress.ip_address(hote.strip("[]")).is_loopback
    except ValueError:
        return "." not in hote  # nom de conteneur du réseau Docker local (« db », « postgres »)


def _separer(liste: str) -> list[str]:
    return [h.strip() for h in liste.split(",") if h.strip()]


def _hotes_netloc(netloc: str) -> list[str]:
    """Hôtes de la partie « utilisateur:mdp@h1:port,h2 » d'une URL (IPv6 entre crochets)."""
    partie = netloc.rsplit("@", 1)[-1]
    hotes = []
    for morceau in _separer(partie):
        if morceau.startswith("["):
            fin = morceau.find("]")
            if fin < 0:
                raise Illisible("IPv6 mal formée")
            hotes.append(morceau[1:fin])
        else:
            hotes.append(urllib.parse.unquote(morceau.split(":", 1)[0]))
    return hotes


def hotes(url: str, env: dict[str, str] | None = None) -> list[str]:
    """Tous les hôtes que libpq pourrait joindre pour cette DATABASE_URL ; [] = socket Unix local par défaut."""
    env = os.environ if env is None else env
    url = url.strip()
    trouves: list[str] = []
    if "://" in url:
        morceaux = urllib.parse.urlsplit(url)
        if morceaux.scheme not in ("postgres", "postgresql"):
            raise Illisible(f"schéma inattendu : {morceaux.scheme}")
        # Un « / », « ? » ou « # » non encodé dans le mot de passe coupe la partie hôte trop tôt (l'hôte lu serait
        # l'utilisateur) : un « @ » après cette coupure trahit cette URL ambiguë.
        if "@" in url.split("://", 1)[1][len(morceaux.netloc):]:
            raise Illisible("caractère spécial non encodé avant l'hôte (mot de passe ?)")
        trouves += [h for h in _hotes_netloc(morceaux.netloc) if h]
        for cle, valeur in urllib.parse.parse_qsl(morceaux.query):
            if cle in ("host", "hostaddr"):
                trouves += _separer(valeur)
    elif url:
        try:
            paires = shlex.split(url)
        except ValueError as exc:
            raise Illisible(str(exc)) from None
        for paire in paires:
            if "=" not in paire:
                raise Illisible("forme mots-clés attendue (host=… dbname=…)")
            cle, valeur = paire.split("=", 1)
            if cle.strip() in ("host", "hostaddr"):
                trouves += _separer(valeur)
    else:
        raise Illisible("DATABASE_URL vide")
    if not trouves:  # libpq se rabat alors sur PGHOST / PGHOSTADDR, sinon sur le socket local
        trouves = _separer(env.get("PGHOST", "")) + _separer(env.get("PGHOSTADDR", ""))
    return trouves


def verdict(url: str, hotes_prod: str, force: bool, env: dict[str, str] | None = None) -> tuple[bool, str]:
    """(autorisé, message) pour la base de DATABASE_URL."""
    prod = {_endpoint(h) for h in _separer(hotes_prod)}
    try:
        liste = hotes(url, env)
    except Illisible as exc:
        est_prod = True
        raison = f"DATABASE_URL illisible ({exc}) : impossible de vérifier que ce n'est pas la production."
    else:
        distants = [h for h in liste if not _est_local(h)]
        visees = [h for h in distants if _endpoint(h) in prod]
        if visees:
            est_prod = True
            raison = f"DATABASE_URL désigne la base de PRODUCTION ({visees[0]}, déclarée dans SM_PROD_DB_HOST)."
        elif distants and not prod:
            est_prod = True
            raison = (f"DATABASE_URL désigne une base distante ({distants[0]}) et SM_PROD_DB_HOST n'est pas déclarée : "
                      "impossible de vérifier que ce n'est pas la production.")
        else:
            est_prod, raison = False, ""
    if not est_prod:
        return True, ""
    if force:
        return True, (f"{ROUGE}ATTENTION : {raison}\nSM_JE_VEUX_LA_PROD=1 : démarrage quand même. Toute action dans "
                      f"l'appli locale (et --migrer) écrit peut-être en PRODUCTION.{FIN}")
    conseil = ("Utilise une base locale, ou une base de prévisualisation après avoir déclaré l'hôte de la prod dans "
               ".env.local (SM_PROD_DB_HOST=ep-….neon.tech).")
    return False, (f"{ROUGE}Refusé : {raison}{FIN}\n{conseil}\n"
                   "Exception volontaire et ponctuelle seulement : SM_JE_VEUX_LA_PROD=1 ./dev.sh")


def main() -> int:
    ok, message = verdict(
        os.environ.get("DATABASE_URL", ""),
        os.environ.get("SM_PROD_DB_HOST", ""),
        os.environ.get("SM_JE_VEUX_LA_PROD") == "1",
    )
    if message:
        print(message, file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
