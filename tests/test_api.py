import pytest
from fastapi.testclient import TestClient

from api.index import app, base

AUTH = {"Authorization": "Bearer jeton-de-test"}
EAN = "TEST-0000000000001"


@pytest.fixture()
def client():
    with base() as cx:
        cx.execute("DELETE FROM canettes WHERE ean LIKE 'TEST-%'")
    yield TestClient(app)
    with base() as cx:
        cx.execute("DELETE FROM canettes WHERE ean LIKE 'TEST-%'")


def canette(**kw):
    return {"ean": EAN, "nom": "Mango Loco", "edition": "Juiced", "volume": "500 ml",
            "etat": "Vide", "nb": 1, "notes": "", "photo": None,
            "ajout": "2026-01-01T10:00:00.000Z", **kw}


@pytest.mark.parametrize("prefixe", ["", "/api"])
def test_les_deux_prefixes_repondent(client, prefixe):
    r = client.get(f"{prefixe}/health", headers=AUTH)
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_sans_jeton_ou_mauvais_jeton(client):
    assert client.get("/api/cans").status_code == 401
    assert client.get("/api/cans", headers={"Authorization": "Bearer faux"}).status_code == 401
    assert client.put("/api/cans", json=canette()).status_code == 401
    assert client.delete(f"/api/cans/{EAN}").status_code == 401


def test_sans_api_token_configure_tout_est_refuse(client, monkeypatch):
    monkeypatch.delenv("API_TOKEN")
    assert client.get("/api/cans", headers=AUTH).status_code == 503


def test_creation_puis_liste_sans_colonne_maj(client):
    r = client.put("/api/cans", json=canette(), headers=AUTH)
    assert r.status_code == 200
    assert r.json() == canette()
    liste = client.get("/api/cans", headers=AUTH).json()
    assert [c["ean"] for c in liste if c["ean"].startswith("TEST-")] == [EAN]
    assert "maj" not in liste[0]


def test_la_date_d_ajout_d_origine_est_conservee(client):
    client.put("/api/cans", json=canette(), headers=AUTH)
    r = client.put("/api/cans", json=canette(nom="Renommée", ajout="2030-01-01T00:00:00.000Z"), headers=AUTH)
    assert r.json()["nom"] == "Renommée"
    assert r.json()["ajout"] == "2026-01-01T10:00:00.000Z"


def test_ajout_vide_recoit_une_date_iso_utc(client):
    r = client.put("/api/cans", json=canette(ajout=""), headers=AUTH)
    assert r.json()["ajout"].endswith(".000Z")


def test_incrementer_et_plancher_a_1(client):
    client.put("/api/cans", json=canette(), headers=AUTH)
    assert client.patch(f"/api/cans/{EAN}/nb", json={"delta": 2}, headers=AUTH).json()["nb"] == 3
    assert client.patch(f"/api/cans/{EAN}/nb", json={"delta": -99}, headers=AUTH).json()["nb"] == 1


def test_inconnue_donne_404(client):
    assert client.get("/api/cans/TEST-nope", headers=AUTH).status_code == 404
    assert client.patch("/api/cans/TEST-nope/nb", json={"delta": 1}, headers=AUTH).status_code == 404
    assert client.delete("/api/cans/TEST-nope", headers=AUTH).status_code == 404


def test_suppression(client):
    client.put("/api/cans", json=canette(), headers=AUTH)
    assert client.delete(f"/api/cans/{EAN}", headers=AUTH).status_code == 204
    assert client.get(f"/api/cans/{EAN}", headers=AUTH).status_code == 404


def test_validation(client):
    assert client.put("/api/cans", json=canette(nb=0), headers=AUTH).status_code == 422
    assert client.put("/api/cans", json=canette(ean=""), headers=AUTH).status_code == 422
    assert client.put("/api/cans", json=canette(photo="x" * 300_001), headers=AUTH).status_code == 422
    assert client.patch(f"/api/cans/{EAN}/nb", json={"delta": 100}, headers=AUTH).status_code == 422


def test_la_documentation_est_fermee(client):
    for chemin in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(chemin).status_code == 404
