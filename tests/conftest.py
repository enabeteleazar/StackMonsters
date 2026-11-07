"""Les tests écrivent dans une vraie base Postgres : variable dédiée exigée, jamais la production."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests.database_safety import validate_test_database_url

URL_TEST = os.environ.get("TEST_DATABASE_URL")
if not URL_TEST:
    pytest.skip("TEST_DATABASE_URL non défini", allow_module_level=True)

try:
    validate_test_database_url(URL_TEST)
except ValueError as erreur:
    raise pytest.UsageError(str(erreur)) from erreur

os.environ["DATABASE_URL"] = URL_TEST
os.environ["SESSION_SECRET"] = "secret-de-test"
os.environ.pop("RESEND_API_KEY", None)
os.environ.pop("OWNER_EMAIL", None)
