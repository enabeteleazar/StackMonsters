"""Local-only API harness that captures OTPs for Playwright; never deployed."""
import os
import sys
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.database_safety import validate_test_database_url

database_url = os.environ.get("TEST_DATABASE_URL", "")
try:
    validate_test_database_url(database_url)
except ValueError as erreur:
    raise SystemExit(str(erreur)) from erreur

os.environ["DATABASE_URL"] = database_url
os.environ["SESSION_SECRET"] = "stackmonster-e2e-session-secret"
os.environ.pop("RESEND_API_KEY", None)
os.environ.pop("OWNER_EMAIL", None)

import api.index as ix

codes: dict[str, str] = {}


def capturer_code(email: str, code: str) -> None:
    codes[email] = code


ix.envoyer_code = capturer_code
app = ix.app


def valider_email_test(email: str) -> str:
    normalized = email.strip().lower()
    if not normalized.startswith("e2e-") or not normalized.endswith("@example.test"):
        raise HTTPException(404, "test account not found")
    return normalized


@app.get("/__e2e__/health")
def e2e_health() -> dict[str, bool]:
    with ix.base():
        pass
    return {"ready": True}


@app.get("/__e2e__/mailbox/{email}")
def lire_code(email: str) -> dict[str, str]:
    normalized = valider_email_test(email)
    code = codes.get(normalized)
    if code is None:
        raise HTTPException(404, "no code was sent to this test account")
    return {"code": code}


@app.delete("/__e2e__/accounts/{email}", status_code=204)
def supprimer_compte_test(email: str) -> None:
    normalized = valider_email_test(email)
    codes.pop(normalized, None)
    with ix.base() as cx:
        cx.execute("DELETE FROM codes WHERE email = %s", (normalized,))
        cx.execute("DELETE FROM users WHERE email = %s", (normalized,))
