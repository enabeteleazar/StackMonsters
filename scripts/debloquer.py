#!/usr/bin/env python3
"""Lève une limite anti-abus avant la fin de sa fenêtre (voir « Limites anti-abus » dans le README).

    DATABASE_URL=… SESSION_SECRET=… python scripts/debloquer.py --ip 203.0.113.7
    DATABASE_URL=… SESSION_SECRET=… python scripts/debloquer.py --email membre@exemple.fr --appliquer
    DATABASE_URL=… SESSION_SECRET=… python scripts/debloquer.py --inscriptions --demandes --appliquer

Les compteurs ne contiennent que des empreintes HMAC : il faut le même SESSION_SECRET que le site pour
retrouver ceux d'une IP. Sans --appliquer, le script affiche seulement ce qu'il effacerait.
Il n'efface que des compteurs et des codes de connexion, jamais un compte ni une collection.
"""

from __future__ import annotations

import argparse
import ipaddress
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg  # noqa: E402

from api.index import _cle_limite, connecter  # noqa: E402

ACTIONS_IP = ("demande", "demande-jour", "verification", "compte", "signalement", "proposition")


def debloquer(
    cx: psycopg.Connection, ips: list[str] = (), emails: list[str] = (),
    inscriptions: bool = False, demandes: bool = False, appliquer: bool = False,
) -> list[str]:
    """Efface (ou liste, sans « appliquer ») les compteurs visés ; renvoie un compte rendu ligne par ligne."""
    rapport: list[str] = []
    cles: dict[str, str] = {}
    for ip in ips:
        ipaddress.ip_address(ip)  # ValueError si l'adresse est invalide
        cles.update({_cle_limite(a, ip): f"{a} ({ip})" for a in ACTIONS_IP})
    if inscriptions:
        cles[_cle_limite("compte")] = "créations de comptes (tous visiteurs)"
    if demandes:
        cles[_cle_limite("demande")] = "demandes de code (tous visiteurs)"
    if cles:
        for r in cx.execute("SELECT cle, n FROM limites_ip WHERE cle = ANY(%s)", (list(cles),)).fetchall():
            rapport.append(f"compteur {cles[r['cle']]} : {r['n']} appel(s)")
        if appliquer:
            cx.execute("DELETE FROM limites_ip WHERE cle = ANY(%s)", (list(cles),))
    for email in emails:
        email = email.strip().lower()
        n = cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s", (email,)).fetchone()["n"]
        rapport.append(f"codes de connexion de {email} : {n}")
        if appliquer:
            cx.execute("DELETE FROM codes WHERE email = %s", (email,))
    if appliquer:
        cx.commit()
    return rapport


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ip", action="append", default=[], help="adresse IP à débloquer (toutes ses limites)")
    p.add_argument("--email", action="append", default=[], help="adresse e-mail : demandes et essais de code")
    p.add_argument("--inscriptions", action="store_true", help="limite globale de créations de comptes")
    p.add_argument("--demandes", action="store_true", help="limite globale de demandes de code")
    p.add_argument("--appliquer", action="store_true", help="effacer réellement (sinon simple aperçu)")
    a = p.parse_args()
    if not (a.ip or a.email or a.inscriptions or a.demandes):
        p.error("préciser au moins --ip, --email, --inscriptions ou --demandes")
    with connecter() as cx:
        rapport = debloquer(cx, a.ip, a.email, a.inscriptions, a.demandes, a.appliquer)
    print("\n".join(rapport) or "Aucun compteur actif : rien à débloquer.")
    print("Effacé." if a.appliquer else "Aperçu seulement : relancer avec --appliquer pour effacer.")


if __name__ == "__main__":
    main()
