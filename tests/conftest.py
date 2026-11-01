"""Les tests écrivent dans une vraie base Postgres : on exige une variable dédiée
pour ne jamais viser la base de production par accident."""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

URL_TEST = os.environ.get("TEST_DATABASE_URL")
if not URL_TEST:
    pytest.skip("TEST_DATABASE_URL non défini", allow_module_level=True)

os.environ["DATABASE_URL"] = URL_TEST
os.environ["API_TOKEN"] = "jeton-de-test"
