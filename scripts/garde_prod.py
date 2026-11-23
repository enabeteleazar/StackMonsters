"""Garde-fou de ./dev.sh : refuser de démarrer (et donc de migrer) sur la base de production.

Le 23/11/2026, ./dev.sh --migrer lancé avec un .env.local qui pointait sur la production a appliqué une
migration encore en cours d'écriture. Désormais :

- SM_PROD_DB_HOST (dans .env.local, jamais dans le dépôt) déclare l'hôte de la base de production ; plusieurs
  hôtes possibles, séparés par des virgules. Pour Neon, la comparaison se fait sur l'identifiant d'endpoint
  (« ep-… »), avec ou sans « -pooler » ;
- sans SM_PROD_DB_HOST, toute base Neon (*.neon.tech) est refusée : impossible de savoir si c'est la prod ;
  déclarer SM_PROD_DB_HOST suffit à autoriser une base de prévisualisation ;
- seule exception : SM_JE_VEUX_LA_PROD=1, avec un avertissement en rouge.

Code de sortie 0 : démarrage autorisé ; 1 : refus. N'utilise que la bibliothèque standard (lancé avant la
création éventuelle du .venv) et n'affiche jamais l'URL complète (elle contient le mot de passe).
"""

from __future__ import annotations

import os
import sys
import urllib.parse

ROUGE, FIN = "\033[1;31m", "\033[0m"


def _endpoint(hote: str) -> str:
    """Identifiant comparable d'un hôte : pour Neon, « ep-xxx » sans « -pooler » ; sinon l'hôte lui-même."""
    hote = hote.strip().lower().rstrip(".")
    if hote.endswith(".neon.tech"):
        premier = hote.split(".", 1)[0]
        return premier.removesuffix("-pooler")
    return hote


def verdict(url: str, hotes_prod: str, force: bool) -> tuple[bool, str]:
    """(autorisé, message) pour la base de DATABASE_URL."""
    hote = (urllib.parse.urlsplit(url).hostname or "").lower()
    prod = {_endpoint(h) for h in hotes_prod.split(",") if h.strip()}
    if prod:
        est_prod = _endpoint(hote) in prod if hote else False
        raison = f"DATABASE_URL désigne la base de PRODUCTION ({hote}, déclarée dans SM_PROD_DB_HOST)."
    else:
        est_prod = hote.endswith(".neon.tech")
        raison = (f"DATABASE_URL désigne une base Neon ({hote}) et SM_PROD_DB_HOST n'est pas déclarée : "
                  "impossible de vérifier que ce n'est pas la production.")
    if not est_prod:
        return True, ""
    if force:
        return True, (f"{ROUGE}ATTENTION : {raison}\nSM_JE_VEUX_LA_PROD=1 : démarrage quand même. Toute action dans "
                      f"l'appli locale (et --migrer) écrit en PRODUCTION.{FIN}")
    conseil = ("Utilise une base de test ou de prévisualisation dans .env.local."
               if prod else
               "Déclare l'hôte de la prod dans .env.local (SM_PROD_DB_HOST=ep-….neon.tech) pour autoriser une "
               "base de prévisualisation, ou utilise une base locale.")
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
