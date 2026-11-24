"""Remet à zéro la base des tests de bout en bout (E2E_DATABASE_URL) : schéma vidé, puis toutes les migrations.

Appelé par e2e/global-setup.ts avant chaque suite Playwright, pour que les données et les compteurs anti-abus des
suites précédentes ne faussent pas les parcours.

Garde-fou : refus (sortie 1, rien n'est touché) si la base n'est pas LOCALE (localhost, 127.x, ::1, socket, conteneur
sans point ; même règle que scripts/garde_prod.py) ou si son nom n'est pas « sm_e2e » ou « e2e_… ». Le schéma est
vidé (DROP SCHEMA public CASCADE) plutôt que la base supprimée : le serveur d'API des tests peut déjà y être connecté.
L'URL complète n'est jamais affichée (elle contient le mot de passe).
"""

from __future__ import annotations

import os
import re
import sys
import urllib.parse
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "scripts"))
sys.path.insert(0, str(RACINE))

import garde_prod  # noqa: E402

NOM_AUTORISE = re.compile(r"^(sm_e2e|e2e_[a-z0-9_]+)$")


def _nom_base(url: str) -> str:
    """Nom de la base : chemin de l'URL, ou dbname= (forme mots-clés, URL ou paramètre)."""
    if "://" in url:
        morceaux = urllib.parse.urlsplit(url)
        nom = urllib.parse.unquote(morceaux.path.lstrip("/"))
        for cle, valeur in urllib.parse.parse_qsl(morceaux.query):
            if cle == "dbname":
                nom = valeur
        return nom
    for paire in url.split():
        if paire.startswith("dbname="):
            return paire.split("=", 1)[1].strip("'\"")
    return ""


def verdict(url: str, env: dict[str, str] | None = None) -> tuple[bool, str]:
    """(autorisé, raison du refus) pour la base à remettre à zéro."""
    if not url.strip():
        return False, "E2E_DATABASE_URL manquante."
    try:
        hotes = garde_prod.hotes(url, env)
    except garde_prod.Illisible as exc:
        return False, f"E2E_DATABASE_URL illisible ({exc})."
    distants = [h for h in hotes if not garde_prod._est_local(h)]
    if distants:
        return False, f"base distante ({distants[0]}) : seule une base locale peut être remise à zéro."
    nom = _nom_base(url)
    if not NOM_AUTORISE.match(nom):
        return False, f"base « {nom or '?'} » : seules « sm_e2e » et « e2e_… » peuvent être remises à zéro."
    return True, ""


def main() -> int:
    url = os.environ.get("E2E_DATABASE_URL", "")
    ok, raison = verdict(url)
    if not ok:
        print(f"{garde_prod.ROUGE}Remise à zéro de la base e2e refusée : {raison}{garde_prod.FIN}", file=sys.stderr)
        return 1
    os.environ["DATABASE_URL"] = url  # connecter() et les migrations lisent DATABASE_URL
    from api.index import appliquer_migrations, connecter

    with connecter() as cx:
        cx.execute("DROP SCHEMA IF EXISTS public CASCADE")
        cx.execute("CREATE SCHEMA public")
        cx.commit()
        appliquees = appliquer_migrations(cx)
    print(f"Base e2e « {_nom_base(url)} » remise à zéro ({len(appliquees)} migrations).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
