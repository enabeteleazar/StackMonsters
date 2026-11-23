"""Garde-fou de ./dev.sh (scripts/garde_prod.py) : jamais la base de production par mégarde."""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import garde_prod as g  # noqa: E402

PROD = "postgresql://u:secret@ep-prod-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"
PROD_DIRECT = "postgresql://u:secret@ep-prod-123456.eu-central-1.aws.neon.tech/neondb"
PREVIEW = "postgresql://u:secret@ep-preview-999-pooler.eu-central-1.aws.neon.tech/neondb"
LOCALE = "postgresql://postgres:test@127.0.0.1:55432/postgres"
DECLARE = "ep-prod-123456.eu-central-1.aws.neon.tech"


def test_prod_declaree_refusee_avec_ou_sans_pooler():
    for url in (PROD, PROD_DIRECT):
        ok, message = g.verdict(url, DECLARE, False)
        assert not ok and "PRODUCTION" in message and "SM_JE_VEUX_LA_PROD=1" in message
        assert "secret" not in message  # jamais le mot de passe


def test_prod_declaree_avec_pooler_ou_plusieurs_hotes():
    assert not g.verdict(PROD_DIRECT, "autre.example.com, ep-prod-123456-pooler.eu-central-1.aws.neon.tech", False)[0]


def test_preview_et_base_locale_autorisees_quand_la_prod_est_declaree():
    assert g.verdict(PREVIEW, DECLARE, False) == (True, "")
    assert g.verdict(LOCALE, DECLARE, False) == (True, "")


def test_sans_declaration_toute_base_neon_est_refusee_mais_pas_une_base_locale():
    ok, message = g.verdict(PREVIEW, "", False)
    assert not ok and "SM_PROD_DB_HOST" in message
    assert g.verdict(LOCALE, "", False) == (True, "")


def test_exception_explicite_avec_avertissement():
    ok, message = g.verdict(PROD, DECLARE, True)
    assert ok and "ATTENTION" in message and g.ROUGE in message


def test_dev_sh_s_arrete_avant_toute_connexion(tmp_path):
    """./dev.sh (sans .env.local dans ce dossier) refuse de démarrer, et --migrer aussi, sur la prod déclarée."""
    racine = Path(__file__).resolve().parent.parent
    if (racine / ".env.local").exists():
        import pytest

        pytest.skip(".env.local présent : dev.sh le chargerait par-dessus l'environnement du test")
    env = {"PATH": "/usr/bin:/bin", "DATABASE_URL": PROD, "SM_PROD_DB_HOST": DECLARE, "HOME": str(tmp_path)}
    for args in ([], ["--migrer"]):
        r = subprocess.run(["bash", str(racine / "dev.sh"), *args], env=env, capture_output=True, text=True, timeout=30)
        assert r.returncode == 1 and "Refusé" in r.stderr and "Migrations" not in r.stdout, r.stderr
