"""Garde-fou de scripts/reinit_e2e.py : seule une base e2e locale (« sm_e2e » ou « e2e_… ») peut être remise à zéro."""

import os
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "scripts"))
import reinit_e2e as r  # noqa: E402


def test_bases_e2e_locales_acceptees():
    for url in (
        "postgresql://postgres:x@127.0.0.1:55432/sm_e2e",
        "postgresql://postgres:x@localhost/e2e_sarah",
        "postgresql://postgres:x@[::1]/e2e_donald_2",
        "host=/var/run/postgresql dbname=sm_e2e",
        "postgresql://postgres:x@db:5432/sm_e2e",
    ):
        assert r.verdict(url, env={}) == (True, ""), url


def test_autres_bases_refusees():
    refus = {
        "postgresql://postgres:x@127.0.0.1:55432/postgres": "seules",
        "postgresql://postgres:x@127.0.0.1:55432/test_donald": "seules",
        "postgresql://postgres:x@127.0.0.1:55432/sm_e2e_bis": "seules",
        "postgresql://postgres:x@127.0.0.1:55432/E2E_x": "seules",
        "postgresql://u:x@ep-prod-1.eu-central-1.aws.neon.tech/sm_e2e": "distante",
        "postgresql://u:x@localhost/sm_e2e?host=ep-prod-1.eu-central-1.aws.neon.tech": "distante",
        "postgresql://postgres:x@127.0.0.1:55432/sm_e2e?dbname=neondb": "seules",
        "postgresql://u:pa/ss@ep-prod-1.eu-central-1.aws.neon.tech/sm_e2e": "illisible",
        "": "manquante",
    }
    for url, motif in refus.items():
        ok, raison = r.verdict(url, env={})
        assert not ok and motif in raison and "x@" not in raison, url


def test_pghost_distant_refuse():
    assert not r.verdict("dbname=sm_e2e", env={"PGHOST": "ep-prod-1.eu-central-1.aws.neon.tech"})[0]


def test_le_script_refuse_sans_rien_toucher():
    env = {"PATH": os.environ.get("PATH", ""), "E2E_DATABASE_URL": "postgresql://postgres:x@127.0.0.1:1/postgres"}
    p = subprocess.run([sys.executable, str(RACINE / "scripts" / "reinit_e2e.py")], env=env, capture_output=True,
                       text=True, timeout=30)
    assert p.returncode == 1 and "refusée" in p.stderr  # refus avant toute connexion (port 1 : rien n'écoute)
