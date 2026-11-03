"""Les tests écrivent dans une vraie base Postgres : variable dédiée exigée, jamais la production."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

URL_TEST = os.environ.get("TEST_DATABASE_URL")
if not URL_TEST:
    pytest.skip("TEST_DATABASE_URL non défini", allow_module_level=True)

os.environ["DATABASE_URL"] = URL_TEST
os.environ["SESSION_SECRET"] = "secret-de-test"
os.environ.pop("RESEND_API_KEY", None)
os.environ.pop("OWNER_EMAIL", None)
