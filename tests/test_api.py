import pytest
from fastapi.testclient import TestClient

import api.index as ix

A, B = "test-a@example.com", "test-b@example.com"
IP_A, IP_B = "198.51.100.10", "203.0.113.11"


@pytest.fixture()
def env(monkeypatch):
    codes = {}
    monkeypatch.setattr(ix, "envoyer_code", lambda email, code: codes.__setitem__(email, code))
    with ix.base() as cx:
        cx.execute("DELETE FROM users WHERE email LIKE 'test-%@example.com'")
        cx.execute("DELETE FROM codes WHERE email LIKE 'test-%@example.com'")
        cx.execute(
            "DELETE FROM connexions_uniques WHERE ip_hash = ANY(%s)",
            ([ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)],),
        )
    yield TestClient(ix.app), codes
    with ix.base() as cx:
        cx.execute("DELETE FROM users WHERE email LIKE 'test-%@example.com'")
        cx.execute("DELETE FROM codes WHERE email LIKE 'test-%@example.com'")
        cx.execute(
            "DELETE FROM connexions_uniques WHERE ip_hash = ANY(%s)",
            ([ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)],),
        )


def connecter(client, codes, email, ip=None):
    assert client.post("/api/auth/demande", json={"email": email}).status_code == 200
    headers = {"X-Forwarded-For": ip} if ip else {}
    r = client.post("/api/auth/verification", json={"email": email, "code": codes[email]}, headers=headers)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def canette(ean="TEST-1", **kw):
    return {"ean": ean, "nom": "Mango", "nb": 1, "ajout": "2026-01-01T00:00:00.000Z", **kw}


def test_sans_session_tout_est_refuse(env):
    c, _ = env
    assert c.get("/api/cans").status_code == 401
    assert c.get("/api/cans", headers={"Authorization": "Bearer faux"}).status_code == 401
    assert c.put("/api/cans", json=canette()).status_code == 401


def test_connexion_et_collection(env):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.get("/api/auth/moi", headers=h).json() == {"email": A}
    assert c.put("/api/cans", json=canette(), headers=h).status_code == 200
    assert [x["ean"] for x in c.get("/api/cans", headers=h).json()] == ["TEST-1"]
    assert c.patch("/api/cans/TEST-1/nb", json={"delta": 2}, headers=h).json()["nb"] == 3


def test_chaque_utilisateur_ne_voit_que_sa_collection(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="de A"), headers=ha)
    assert c.get("/api/cans", headers=hb).json() == []
    assert c.get("/api/cans/TEST-1", headers=hb).status_code == 404
    assert c.delete("/api/cans/TEST-1", headers=hb).status_code == 404
    c.put("/api/cans", json=canette(nom="de B"), headers=hb)  # même EAN, autre propriétaire
    assert c.get("/api/cans/TEST-1", headers=ha).json()["nom"] == "de A"


def test_email_insensible_a_la_casse(env):
    c, codes = env
    c.post("/api/auth/demande", json={"email": " Test-A@Example.com "})
    r = c.post("/api/auth/verification", json={"email": A, "code": codes[A]})
    assert r.status_code == 200 and r.json()["email"] == A


def test_mauvais_code_et_limite_d_essais(env):
    c, codes = env
    c.post("/api/auth/demande", json={"email": A})
    faux = "000000" if codes[A] != "000000" else "111111"
    for _ in range(5):
        assert c.post("/api/auth/verification", json={"email": A, "code": faux}).status_code == 401
    # après 5 échecs, même le bon code est refusé
    assert c.post("/api/auth/verification", json={"email": A, "code": codes[A]}).status_code == 401


def test_code_a_usage_unique(env):
    c, codes = env
    connecter(c, codes, A)
    assert c.post("/api/auth/verification", json={"email": A, "code": codes[A]}).status_code == 401


def test_limite_de_demandes_et_adresse_invalide(env):
    c, _ = env
    assert c.post("/api/auth/demande", json={"email": "pas-un-email"}).status_code == 422
    for _ in range(5):
        assert c.post("/api/auth/demande", json={"email": A}).status_code == 200
    assert c.post("/api/auth/demande", json={"email": A}).status_code == 429


def test_echec_envoi_ne_bloque_pas_une_nouvelle_demande(env, monkeypatch):
    c, _ = env

    def echec(_email, _code):
        raise ix.HTTPException(503, "configuration Resend invalide")

    monkeypatch.setattr(ix, "envoyer_code", echec)
    assert c.post("/api/auth/demande", json={"email": A}).status_code == 503
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s", (A,)).fetchone()["n"] == 0

    monkeypatch.setattr(ix, "envoyer_code", lambda email, code: None)
    assert c.post("/api/auth/demande", json={"email": A}).status_code == 200


def test_refus_resend_indique_une_configuration_a_corriger(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "cle-de-test")

    def refuse(*_args, **_kwargs):
        raise ix.urllib.error.HTTPError("https://api.resend.com/emails", 403, "forbidden", None, None)

    monkeypatch.setattr(ix.urllib.request, "urlopen", refuse)
    with pytest.raises(ix.HTTPException) as erreur:
        ix.envoyer_code(A, "123456")

    assert erreur.value.status_code == 503
    assert "MAIL_FROM" in erreur.value.detail


def test_deconnexion_invalide_la_session(env):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.post("/api/auth/deconnexion", headers=h).status_code == 204
    assert c.get("/api/cans", headers=h).status_code == 401


def test_le_proprietaire_recupere_la_collection_historique(env, monkeypatch):
    c, codes = env
    with ix.base() as cx:
        cx.execute("DELETE FROM canettes WHERE ean = 'TEST-HIST'")
        cx.execute("INSERT INTO canettes (ean, nom, ajout, maj) VALUES ('TEST-HIST', 'Ancienne', '2025-01-01T00:00:00.000Z', 'x')")
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    assert "TEST-HIST" in [x["ean"] for x in c.get("/api/cans", headers=h).json()]
    hb = connecter(c, codes, B)
    assert c.get("/api/cans", headers=hb).json() == []
    with ix.base() as cx:
        cx.execute("DELETE FROM canettes WHERE ean = 'TEST-HIST'")


def test_documentation_fermee(env):
    c, _ = env
    assert all(c.get(p).status_code == 404 for p in ("/docs", "/redoc", "/openapi.json"))


def test_stats_reservees_au_proprietaire(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    assert c.get("/api/stats").status_code == 401
    assert c.get("/api/stats", headers=hb).status_code == 403
    c.put("/api/cans", json=canette(nb=3), headers=ha)
    c.put("/api/cans", json=canette("TEST-2", nb=2), headers=hb)
    avant = c.get("/api/stats", headers=ha).json()
    assert avant["utilisateurs"] >= 2 and avant["references"] >= 2
    c.put("/api/cans", json=canette("TEST-3", nb=4), headers=ha)
    apres = c.get("/api/stats", headers=ha).json()
    assert apres["references"] == avant["references"] + 1
    assert apres["connexions_uniques"] == avant["connexions_uniques"]


def test_stats_comptent_les_adresses_ip_uniques(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha = connecter(c, codes, A, IP_A)
    avant = c.get("/api/stats", headers=ha).json()["connexions_uniques"]

    connecter(c, codes, B, IP_A)
    meme_ip = c.get("/api/stats", headers=ha).json()["connexions_uniques"]
    assert meme_ip == avant

    c.post("/api/auth/demande", json={"email": A})
    r = c.post(
        "/api/auth/verification",
        json={"email": A, "code": codes[A]},
        headers={"X-Forwarded-For": IP_B},
    )
    assert r.status_code == 200
    nouvelles = c.get("/api/stats", headers=ha).json()["connexions_uniques"]
    assert nouvelles == avant + 1

    with ix.base() as cx:
        empreintes = cx.execute(
            "SELECT ip_hash FROM connexions_uniques WHERE ip_hash = ANY(%s)",
            ([ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)],),
        ).fetchall()
    assert len(empreintes) == 2
    assert IP_A not in str(empreintes) and IP_B not in str(empreintes)


def test_stats_refusees_sans_proprietaire_configure(env, monkeypatch):
    c, codes = env
    monkeypatch.delenv("OWNER_EMAIL", raising=False)
    h = connecter(c, codes, A)
    assert c.get("/api/stats", headers=h).status_code == 403
