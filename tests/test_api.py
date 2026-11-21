import json
import sys
import threading

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
        cx.execute("DELETE FROM wiki WHERE ean LIKE '200000000%' OR ean LIKE 'LOCAL-%' OR ean LIKE 'TEST-%'")
        cx.execute("DELETE FROM limites_ip")  # base de test uniquement (voir conftest.py)
        cx.execute("DELETE FROM wiki_exclus WHERE ean LIKE '200000000%' OR ean LIKE 'TEST-%'")
    yield TestClient(ix.app), codes
    with ix.base() as cx:
        cx.execute("DELETE FROM users WHERE email LIKE 'test-%@example.com'")
        cx.execute("DELETE FROM codes WHERE email LIKE 'test-%@example.com'")
        cx.execute(
            "DELETE FROM connexions_uniques WHERE ip_hash = ANY(%s)",
            ([ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)],),
        )
        cx.execute("DELETE FROM wiki WHERE ean LIKE '200000000%'")


def connecter(client, codes, email, ip=None):
    assert client.post("/api/auth/demande", json={"email": email}).status_code == 200
    headers = {"X-Forwarded-For": ip} if ip else {}
    r = client.post("/api/auth/verification", json={"email": email, "code": codes[email]}, headers=headers)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def canette(ean="2000000000015", **kw):
    return {"ean": ean, "nom": "Mango", "nb": 1, "ajout": "2026-01-01T00:00:00.000Z", **kw}


def test_sans_session_tout_est_refuse(env):
    c, _ = env
    assert c.get("/api/cans").status_code == 401
    assert c.get("/api/cans", headers={"Authorization": "Bearer faux"}).status_code == 401
    assert c.put("/api/cans", json=canette()).status_code == 401


def test_connexion_et_collection(env):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.get("/api/auth/moi", headers=h).json() == {"email": A, "partage_doubles": True}
    assert c.put("/api/cans", json=canette(), headers=h).status_code == 200
    assert [x["ean"] for x in c.get("/api/cans", headers=h).json()] == ["2000000000015"]
    assert c.patch("/api/cans/2000000000015/nb", json={"delta": 2}, headers=h).json()["nb"] == 3


def test_ajout_canette_enregistre_les_champs_descriptifs_wiki(env):
    c, codes = env
    h = connecter(c, codes, A)
    champs = {
        "categorie": "Ultra", "flavor": "Mango", "status": "Active", "region": "Global",
        "etat": "Pleine", "nb": 2, "notes": "Collection spéciale",
    }

    r = c.put("/api/cans", json=canette(**champs), headers=h)
    assert r.status_code == 200
    assert {cle: r.json()[cle] for cle in champs} == champs
    assert {cle: fiche(c, h, "2000000000015")[cle] for cle in ("categorie", "flavor", "status", "region")} == {
        "categorie": "Ultra", "flavor": "Mango", "status": "Active", "region": "Global",
    }

    c.put("/api/cans", json=canette(categorie="Juiced", flavor="Autre", status="Stop"), headers=h)
    assert {cle: fiche(c, h, "2000000000015")[cle] for cle in ("categorie", "flavor", "status", "region")} == {
        "categorie": "Ultra", "flavor": "Mango", "status": "Active", "region": "Global",
    }
    assert c.put("/api/cans", json=canette(status="Discontinued"), headers=h).status_code == 422


def test_chaque_utilisateur_ne_voit_que_sa_collection(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="de A"), headers=ha)
    assert c.get("/api/cans", headers=hb).json() == []
    assert c.get("/api/cans/2000000000015", headers=hb).status_code == 404
    assert c.delete("/api/cans/2000000000015", headers=hb).status_code == 404
    c.put("/api/cans", json=canette(nom="de B"), headers=hb)  # même EAN, autre propriétaire
    assert c.get("/api/cans/2000000000015", headers=ha).json()["nom"] == "De A"


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


def test_essais_simultanes_ne_depassent_pas_la_limite(env):
    c, codes = env
    c.post("/api/auth/demande", json={"email": A})
    faux = "000000" if codes[A] != "000000" else "111111"
    depart = threading.Barrier(30)

    def essayer():
        depart.wait()
        c.post("/api/auth/verification", json={"email": A, "code": faux})

    fils = [threading.Thread(target=essayer) for _ in range(30)]
    for fil in fils:
        fil.start()
    for fil in fils:
        fil.join()

    with ix.base() as cx:
        essais = cx.execute("SELECT essais FROM codes WHERE email = %s", (A,)).fetchone()["essais"]
    assert essais == ix.ESSAIS_MAX
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


def test_limite_de_demandes_tient_sur_une_heure(env, monkeypatch):
    c, _ = env
    debut = ix.time.time()
    horloge = [debut]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])

    for _ in range(5):
        assert c.post("/api/auth/demande", json={"email": A}).status_code == 200

    # Les codes ont expiré (10 min), mais ils comptent encore dans la limite horaire.
    horloge[0] = debut + ix.DUREE_CODE + 1
    assert c.post("/api/auth/demande", json={"email": A}).status_code == 429

    horloge[0] = debut + ix.FENETRE_DEMANDES + 1
    assert c.post("/api/auth/demande", json={"email": A}).status_code == 200
    with ix.base() as cx:
        restants = cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s", (A,)).fetchone()["n"]
    assert restants == 1  # les anciens codes sont purgés une fois la fenêtre passée


def test_code_expire_reste_refuse_pendant_la_fenetre_de_limite(env, monkeypatch):
    c, codes = env
    debut = ix.time.time()
    horloge = [debut]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])
    c.post("/api/auth/demande", json={"email": A})

    horloge[0] = debut + ix.DUREE_CODE + 1
    assert c.post("/api/auth/verification", json={"email": A, "code": codes[A]}).status_code == 401


def test_les_limites_indiquent_le_delai_avant_de_reessayer(env, monkeypatch):
    c, _ = env
    debut = ix.time.time()
    horloge = [debut]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])
    for _ in range(ix.DEMANDES_MAX):
        c.post("/api/auth/demande", json={"email": A})
    horloge[0] = debut + 600
    r = c.post("/api/auth/demande", json={"email": A})
    assert r.status_code == 429 and int(r.headers["retry-after"]) == ix.FENETRE_DEMANDES - 600

    monkeypatch.setattr(ix, "VERIFICATIONS_MAX_IP", 1)
    corps, ip = {"email": B, "code": "000000"}, {"X-Forwarded-For": IP_A}
    c.post("/api/auth/verification", json=corps, headers=ip)
    horloge[0] = debut + 1200
    r = c.post("/api/auth/verification", json=corps, headers=ip)
    assert r.status_code == 429 and int(r.headers["retry-after"]) == ix.FENETRE_DEMANDES - 600
    assert r.json()["detail"] == "trop de tentatives"


def test_limite_de_demandes_par_ip(env):
    c, _ = env
    entetes = {"X-Forwarded-For": IP_A}
    for i in range(ix.DEMANDES_MAX_IP):
        assert c.post("/api/auth/demande", json={"email": f"test-ip-{i}@example.com"}, headers=entetes).status_code == 200
    assert c.post("/api/auth/demande", json={"email": A}, headers=entetes).status_code == 429
    assert c.post("/api/auth/demande", json={"email": A}, headers={"X-Forwarded-For": IP_B}).status_code == 200
    with ix.base() as cx:
        assert IP_A not in str(cx.execute("SELECT * FROM limites_ip").fetchall())


def test_limite_ip_ne_consomme_pas_les_essais_du_compte(env, monkeypatch):
    c, codes = env
    monkeypatch.setattr(ix, "VERIFICATIONS_MAX_IP", 2)
    c.post("/api/auth/demande", json={"email": A})
    faux = "000000" if codes[A] != "000000" else "111111"
    attaquant = {"X-Forwarded-For": IP_A}
    statuts = [c.post("/api/auth/verification", json={"email": A, "code": faux}, headers=attaquant).status_code for _ in range(4)]
    assert statuts == [401, 401, 429, 429]
    r = c.post("/api/auth/verification", json={"email": A, "code": codes[A]}, headers={"X-Forwarded-For": IP_B})
    assert r.status_code == 200


def test_limite_ip_repart_apres_la_fenetre(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(ix, "VERIFICATIONS_MAX_IP", 1)
    debut = ix.time.time()
    horloge = [debut]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])
    corps, entetes = {"email": A, "code": "000000"}, {"X-Forwarded-For": "2001:db8::1"}
    assert c.post("/api/auth/verification", json=corps, headers=entetes).status_code == 401
    # Une autre adresse du même /64 partage le compteur.
    assert c.post("/api/auth/verification", json=corps, headers={"X-Forwarded-For": "2001:db8::2"}).status_code == 429
    horloge[0] = debut + ix.FENETRE_DEMANDES + 1
    assert c.post("/api/auth/verification", json=corps, headers=entetes).status_code == 401


def _horloge(monkeypatch):
    horloge = [ix.time.time()]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])
    return horloge


def _creer(c, codes, email, ip):
    """Demande puis vérification d'un code depuis une IP ; renvoie la réponse de la vérification."""
    entetes = {"X-Forwarded-For": ip}
    assert c.post("/api/auth/demande", json={"email": email}, headers=entetes).status_code == 200
    return c.post("/api/auth/verification", json={"email": email, "code": codes[email]}, headers=entetes)


def test_limite_de_demandes_par_ip_sur_24_heures(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(ix, "DEMANDES_MAX_IP_JOUR", 3)
    horloge = _horloge(monkeypatch)
    debut, entetes = horloge[0], {"X-Forwarded-For": IP_A}
    for i in range(3):  # réparties sur plusieurs heures : la limite horaire ne joue pas
        horloge[0] = debut + i * 2 * ix.FENETRE_DEMANDES
        assert c.post("/api/auth/demande", json={"email": f"test-j{i}@example.com"}, headers=entetes).status_code == 200
    horloge[0] = debut + 7 * ix.FENETRE_DEMANDES
    r = c.post("/api/auth/demande", json={"email": A}, headers=entetes)
    assert r.status_code == 429 and int(r.headers["retry-after"]) == ix.FENETRE_JOUR - 7 * ix.FENETRE_DEMANDES
    # La purge horaire ne doit pas effacer le compteur de 24 h.
    assert c.post("/api/auth/demande", json={"email": A}, headers=entetes).status_code == 429
    horloge[0] = debut + ix.FENETRE_JOUR + 1
    assert c.post("/api/auth/demande", json={"email": A}, headers=entetes).status_code == 200


def test_la_demande_ne_revele_pas_si_le_compte_existe(env, monkeypatch):
    c, codes = env
    connecter(c, codes, A)
    monkeypatch.setattr(ix, "DEMANDES_MAX", 1)
    existant, nouveau = (c.post("/api/auth/demande", json={"email": e}) for e in (A, B))
    assert (existant.status_code, existant.json()) == (nouveau.status_code, nouveau.json()) == (200, {"ok": True})
    existant, nouveau = (c.post("/api/auth/demande", json={"email": e}) for e in (A, B))
    assert existant.status_code == nouveau.status_code == 429 and existant.json() == nouveau.json()


def test_creations_de_comptes_limitees_par_ip(env, monkeypatch):
    c, codes = env
    monkeypatch.setattr(ix, "COMPTES_MAX_IP_JOUR", 2)
    for i in range(2):
        assert _creer(c, codes, f"test-c{i}@example.com", IP_A).status_code == 200
    # La demande de code reste acceptée, comme pour toute adresse : rien ne trahit l'absence de compte.
    r = _creer(c, codes, A, IP_A)
    assert r.status_code == 429 and r.json()["detail"] == ix.INSCRIPTIONS_LIMITEES
    assert int(r.headers["retry-after"]) > ix.FENETRE_DEMANDES
    with ix.base() as cx:
        assert not cx.execute("SELECT 1 FROM users WHERE email = %s", (A,)).fetchone()
    # Un compte existant se connecte toujours depuis cette IP…
    assert _creer(c, codes, "test-c0@example.com", IP_A).status_code == 200
    # … et la création réussit depuis une autre IP, avec le même code.
    r = c.post("/api/auth/verification", json={"email": A, "code": codes[A]}, headers={"X-Forwarded-For": IP_B})
    assert r.status_code == 200


def test_creations_de_comptes_limitees_globalement(env, monkeypatch):
    c, codes = env
    monkeypatch.setattr(ix, "COMPTES_MAX_HEURE", 2)
    horloge = _horloge(monkeypatch)
    assert _creer(c, codes, "test-g0@example.com", IP_A).status_code == 200
    assert _creer(c, codes, "test-g1@example.com", IP_B).status_code == 200
    r = _creer(c, codes, A, "192.0.2.50")
    assert r.status_code == 429 and r.json()["detail"] == ix.INSCRIPTIONS_LIMITEES
    assert _creer(c, codes, "test-g0@example.com", "192.0.2.50").status_code == 200  # membres non bloqués
    # Le refus global n'a pas consommé le quota de l'IP ; la variable d'environnement relève le seuil.
    monkeypatch.setenv("SM_COMPTES_MAX_HEURE", "3")
    assert c.post("/api/auth/verification", json={"email": A, "code": codes[A]},
                  headers={"X-Forwarded-For": "192.0.2.50"}).status_code == 200
    monkeypatch.delenv("SM_COMPTES_MAX_HEURE")
    horloge[0] += ix.FENETRE_DEMANDES + 1
    assert _creer(c, codes, B, IP_A).status_code == 200


def test_demandes_de_code_limitees_globalement(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(ix, "DEMANDES_MAX_HEURE", 3)
    ips = ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4"]
    for i, ip in enumerate(ips[:3]):
        assert c.post("/api/auth/demande", json={"email": f"test-d{i}@example.com"},
                      headers={"X-Forwarded-For": ip}).status_code == 200
    r = c.post("/api/auth/demande", json={"email": A}, headers={"X-Forwarded-For": ips[3]})
    assert r.status_code == 429 and r.json()["detail"] == "trop de tentatives"


def test_seuil_global_invalide_garde_la_valeur_par_defaut(monkeypatch):
    monkeypatch.setenv("SM_COMPTES_MAX_HEURE", "beaucoup")
    assert ix._seuil("SM_COMPTES_MAX_HEURE", 30) == 30
    monkeypatch.setenv("SM_COMPTES_MAX_HEURE", "0")
    assert ix._seuil("SM_COMPTES_MAX_HEURE", 30) == 1


def test_script_de_deblocage(env, monkeypatch):
    sys.path.insert(0, str(ix.Path(__file__).resolve().parent.parent / "scripts"))
    from debloquer import debloquer

    c, codes = env
    monkeypatch.setattr(ix, "COMPTES_MAX_IP_JOUR", 1)
    monkeypatch.setattr(ix, "DEMANDES_MAX", 1)
    assert _creer(c, codes, "test-x@example.com", IP_A).status_code == 200
    assert _creer(c, codes, A, IP_A).status_code == 429
    assert c.post("/api/auth/demande", json={"email": B}).status_code == 200
    assert c.post("/api/auth/demande", json={"email": B}).status_code == 429
    with ix.base() as cx:
        apercu = debloquer(cx, ips=[IP_A], emails=[B])
        assert any("compte (" + IP_A + ") : 1" in ligne for ligne in apercu)
        assert f"codes de connexion de {B} : 1" in apercu
    verifier_a = {"email": A, "code": codes[A]}
    assert c.post("/api/auth/verification", json=verifier_a, headers={"X-Forwarded-For": IP_A}).status_code == 429
    assert c.post("/api/auth/demande", json={"email": B}).status_code == 429  # l'aperçu n'efface rien
    with ix.base() as cx:
        debloquer(cx, ips=[IP_A], emails=[B], appliquer=True)
    assert c.post("/api/auth/verification", json=verifier_a, headers={"X-Forwarded-For": IP_A}).status_code == 200
    assert c.post("/api/auth/demande", json={"email": B}).status_code == 200
    with ix.base() as cx, pytest.raises(ValueError):
        debloquer(cx, ips=["pas-une-ip"])


def test_identifiants_base_refuses_renvoient_503_sans_exposer_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://dbuser:placeholder@secret-host/db")

    def connexion_refusee(*_args, **_kwargs):
        raise ix.psycopg.OperationalError(
            "password authentication failed for user 'dbuser' at secret-host"
        )

    monkeypatch.setattr(ix.psycopg, "connect", connexion_refusee)
    response = TestClient(ix.app).post("/api/auth/demande", json={"email": A})

    assert response.status_code == 503
    assert response.json()["detail"] == "Identifiants PostgreSQL refusés. Actualise DATABASE_URL depuis Neon."
    assert "secret-host" not in response.text


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
    assert fiche(c, h, "TEST-HIST")["nom"] == "Ancienne"  # reprise dans une collection : elle a sa fiche
    with ix.base() as cx:
        cx.execute("DELETE FROM canettes WHERE ean = 'TEST-HIST'")


def test_version_lue_dans_package_json(env):
    c, codes = env
    h = connecter(c, codes, A)
    attendue = json.loads((ix.Path(ix.__file__).resolve().parent.parent / "package.json").read_text())["version"]
    assert c.get("/api/health", headers=h).json()["version"] == attendue != "0.0.0"


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
    c.put("/api/cans", json=canette("2000000000022", nb=2), headers=hb)
    avant = c.get("/api/stats", headers=ha).json()
    assert avant["utilisateurs"] >= 2 and avant["references"] >= 2
    c.put("/api/cans", json=canette("2000000000039", nb=4), headers=ha)
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


def test_empreintes_ip_purgees_apres_13_mois(env):
    c, _ = env
    vieille, recente = ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)
    maintenant = int(ix.time.time())
    with ix.base() as cx:
        cx.execute(
            "INSERT INTO connexions_uniques (ip_hash, premiere_connexion) VALUES (%s, %s), (%s, %s)",
            (vieille, maintenant - ix.DUREE_EMPREINTES_IP - 60, recente, maintenant - 86400),
        )
    c.post("/api/auth/demande", json={"email": A})
    with ix.base() as cx:
        restantes = {r["ip_hash"] for r in cx.execute(
            "SELECT ip_hash FROM connexions_uniques WHERE ip_hash = ANY(%s)", ([vieille, recente],),
        ).fetchall()}
    assert restantes == {recente}


def test_stats_refusees_sans_proprietaire_configure(env, monkeypatch):
    c, codes = env
    monkeypatch.delenv("OWNER_EMAIL", raising=False)
    h = connecter(c, codes, A)
    assert c.get("/api/stats", headers=h).status_code == 403


def test_liste_sans_photos_et_photo_chargee_a_part(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(photo=PNG_1PX), headers=ha)
    c.put("/api/cans", json=canette("2000000000022"), headers=ha)

    r = c.get("/api/cans", headers=ha)
    assert "base64" not in r.text and all("photo" not in x for x in r.json())
    versions = {x["ean"]: x["photo_version"] for x in r.json()}
    assert versions["2000000000015"] and versions["2000000000022"] is None
    assert "base64" not in c.get("/api/cans/2000000000015", headers=ha).text

    photo = c.get("/api/cans/2000000000015/photo", headers=ha)
    assert photo.status_code == 200 and photo.content.startswith(b"\x89PNG")
    assert photo.headers["vary"] == "Authorization" and "private" in photo.headers["cache-control"]
    assert c.get("/api/cans/2000000000015/photo").status_code == 401
    assert c.get("/api/cans/2000000000015/photo", headers=hb).status_code == 404
    assert c.get("/api/cans/2000000000022/photo", headers=ha).status_code == 404


def test_enregistrer_sans_champ_photo_conserve_la_photo(env):
    c, codes = env
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(photo=PNG_1PX), headers=h)
    assert c.put("/api/cans", json=canette(nom="Renommée"), headers=h).json()["photo_version"]
    assert c.get("/api/cans/2000000000015/photo", headers=h).status_code == 200
    # La photo est devenue celle de la fiche du Wiki : retirer la photo personnelle ne la retire pas.
    r = c.put("/api/cans", json=canette(photo=None), headers=h).json()
    assert r["photo_version"] and r["photo_wiki"]


def test_upc_a_normalise_sans_doublon(env):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette("036000291452"), headers=h).json()["ean"] == "0036000291452"
    assert c.put("/api/cans", json=canette("0036000291452"), headers=h).status_code == 200
    assert c.put("/api/cans", json=canette("96385074"), headers=h).json()["ean"] == "96385074"  # EAN-8
    assert sorted(x["ean"] for x in c.get("/api/cans", headers=h).json()) == ["0036000291452", "96385074"]


@pytest.mark.parametrize("code", ["12345", "2000000000016", "036000291453", "abc", "LOCAL-", "local-abc", "LOCAL-a b"])
def test_code_barres_invalide_refuse(env, code):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette(code), headers=h).status_code == 422
    assert c.get("/api/cans", headers=h).json() == []


def test_fiche_ancienne_au_code_non_conforme_reste_modifiable(env):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.base() as cx:
        uid = cx.execute("SELECT id FROM users WHERE email = %s", (A,)).fetchone()["id"]
        cx.execute(
            "INSERT INTO collection (user_id, ean, nom, ajout, maj) VALUES (%s, '036000291452', 'Ancienne', 'x', 'x')",
            (uid,),
        )
    r = c.put("/api/cans", json=canette("036000291452", nom="Corrigée"), headers=h)
    assert r.status_code == 200 and r.json()["ean"] == "036000291452"
    assert [x["nom"] for x in c.get("/api/cans", headers=h).json()] == ["Corrigée"]


@pytest.mark.parametrize("champ,taille", [("nom", 201), ("volume", 41), ("etat", 41)])
def test_longueurs_refusees(env, champ, taille):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette(**{champ: "x" * taille}), headers=h).status_code == 422


@pytest.mark.parametrize("photo", ["pas une image", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,abc"])
def test_format_de_photo_refuse(env, photo):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette(photo=photo), headers=h).status_code == 422


def test_ajuster_une_canette_dont_la_fiche_est_protegee(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(), headers=h)
    assert c.delete("/api/wiki/2000000000015", headers=h).status_code == 409  # possédée : pas de suppression
    assert c.patch("/api/cans/2000000000015/nb", json={"delta": 1}, headers=h).json()["nb"] == 2


def restaurer(monkeypatch, tmp_path, fiches, email):
    from scripts import migrer

    fichier = tmp_path / "sauvegarde.json"
    fichier.write_text(json.dumps(fiches), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["migrer.py", str(fichier), "--email", email])
    migrer.main()


def test_restauration_dans_un_compte_existant(env, monkeypatch, tmp_path):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000022", nom="Hors sauvegarde"), headers=ha)
    c.put("/api/cans", json=canette(nom="Avant", photo=PNG_1PX), headers=ha)
    fiche_sauvee = {
        "ean": "2000000000015", "nom": "Mango", "volume": "500 ml", "categorie": "Juiced",
        "flavor": "Mango", "status": "Active", "region": "Global", "etat": "Pleine", "nb": 4, "notes": "Rare",
        "photo": None, "ajout": "2025-01-01T00:00:00.000Z",
    }
    locale = {"ean": "LOCAL-RESTO", "nom": "Perso", "photo": PNG_1PX, "nb": 2, "ajout": "2025-01-02T00:00:00.000Z"}

    restaurer(monkeypatch, tmp_path, [fiche_sauvee, locale], A.upper())
    restaurer(monkeypatch, tmp_path, [fiche_sauvee, locale], A)  # relance sans doublon

    cans = {x["ean"]: x for x in c.get("/api/cans", headers=ha).json()}
    assert set(cans) == {"2000000000015", "2000000000022", "LOCAL-RESTO"}
    r = cans["2000000000015"]
    # Le nom affiché est celui de la fiche du Wiki (« Avant », première valeur reçue) ; le reste est restauré.
    assert (r["nom"], r["etat"], r["nb"], r["notes"], r["ajout"]) == (
        "Avant", "Pleine", 4, "Rare", "2025-01-01T00:00:00.000Z",
    )
    assert r["categorie"] == "Juiced" and r["flavor"] == "Mango"
    assert r["photo_version"]  # une sauvegarde sans photo n'efface pas la photo existante
    assert cans["LOCAL-RESTO"]["photo_version"]
    assert fiche(c, hb, "LOCAL-RESTO")["photo"] is None  # restaurée : elle a sa fiche, sans photo publiée
    assert fiche(c, hb, "2000000000015")["photo"]  # photo envoyée par l'API avant la restauration
    assert c.get("/api/cans", headers=hb).json() == []


def test_restauration_refuse_un_compte_inconnu(env, monkeypatch, tmp_path):
    with pytest.raises(SystemExit, match="Aucun compte"):
        restaurer(monkeypatch, tmp_path, [{"ean": "2000000000015"}], "test-inconnu@example.com")


def test_restauration_tout_ou_rien(env, monkeypatch, tmp_path):
    c, codes = env
    h = connecter(c, codes, A)
    with pytest.raises(Exception):
        restaurer(monkeypatch, tmp_path, [{"ean": "2000000000015"}, {"ean": "2000000000022", "nb": "pas un nombre"}], A)
    assert c.get("/api/cans", headers=h).json() == []


def test_deconnexion_partout_revoque_toutes_les_sessions(env):
    c, codes = env
    h1, h2, autre = connecter(c, codes, A), connecter(c, codes, A), connecter(c, codes, B)
    assert c.post("/api/auth/deconnexion-partout").status_code == 401
    assert c.post("/api/auth/deconnexion-partout", headers=h1).status_code == 204
    assert c.get("/api/auth/moi", headers=h1).status_code == 401
    assert c.get("/api/auth/moi", headers=h2).status_code == 401
    assert c.get("/api/auth/moi", headers=autre).status_code == 200


def test_deconnexion_ne_touche_pas_les_autres_appareils(env):
    c, codes = env
    h1, h2 = connecter(c, codes, A), connecter(c, codes, A)
    assert c.post("/api/auth/deconnexion", headers=h1).status_code == 204
    assert c.get("/api/auth/moi", headers=h1).status_code == 401
    assert c.get("/api/auth/moi", headers=h2).status_code == 200


def _horloge_session(monkeypatch):
    horloge = [ix.time.time()]
    monkeypatch.setattr(ix.time, "time", lambda: horloge[0])
    return horloge


def _session(h):
    with ix.base() as cx:
        return cx.execute("SELECT * FROM sessions WHERE hash = %s",
                          (ix._hash_session(h["Authorization"].removeprefix("Bearer ")),)).fetchone()


def test_session_expire_apres_30_jours_sans_utilisation(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    debut = horloge[0]
    h = connecter(c, codes, A)
    horloge[0] = debut + ix.INACTIVITE_SESSION - 60
    assert c.get("/api/auth/moi", headers=h).status_code == 200
    horloge[0] = debut + ix.INACTIVITE_SESSION + 60  # utilisée la veille : échéance repoussée
    assert c.get("/api/auth/moi", headers=h).status_code == 200
    horloge[0] += ix.INACTIVITE_SESSION + 1  # puis 30 jours sans utilisation
    assert c.get("/api/auth/moi", headers=h).status_code == 401


def test_session_prolongee_au_plus_une_fois_par_heure(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    h = connecter(c, codes, A)
    echeance = _session(h)["expire"]
    horloge[0] += ix.PROLONGATION_MIN - 60
    c.get("/api/auth/moi", headers=h)
    assert _session(h)["expire"] == echeance  # pas d'écriture à chaque requête
    horloge[0] += 120
    c.get("/api/auth/moi", headers=h)
    assert _session(h)["expire"] == int(horloge[0]) + ix.INACTIVITE_SESSION


def test_session_plafonnee_a_90_jours_meme_utilisee(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    debut = horloge[0]
    h = connecter(c, codes, A)
    while horloge[0] < debut + ix.DUREE_MAX_SESSION - 10 * 86400:  # dernier usage au 80e jour
        horloge[0] += 10 * 86400
        assert c.get("/api/auth/moi", headers=h).status_code == 200
    assert _session(h)["expire"] == int(debut) + ix.DUREE_MAX_SESSION
    horloge[0] = debut + ix.DUREE_MAX_SESSION + 1
    assert c.get("/api/auth/moi", headers=h).status_code == 401


def test_rotation_quotidienne_du_jeton(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    debut = horloge[0]
    h = connecter(c, codes, A)
    assert c.post("/api/auth/renouveler").status_code == 401
    assert c.post("/api/auth/renouveler", headers=h).json() == {"token": None}  # jeton du jour

    horloge[0] = debut + ix.ROTATION_SESSION + 1
    nouveau = c.post("/api/auth/renouveler", headers=h).json()["token"]
    h2 = {"Authorization": f"Bearer {nouveau}"}
    assert nouveau and c.get("/api/auth/moi", headers=h2).json()["email"] == A
    # L'ancien jeton reste valable quelques minutes, ne se renouvelle plus et n'est plus prolongé.
    assert c.get("/api/auth/moi", headers=h).status_code == 200
    assert c.post("/api/auth/renouveler", headers=h).json() == {"token": None}
    horloge[0] += ix.PROLONGATION_MIN + ix.GRACE_ROTATION
    assert c.get("/api/auth/moi", headers=h).status_code == 401
    assert c.get("/api/auth/moi", headers=h2).status_code == 200
    # Le nouveau jeton garde la date de connexion : le plafond de 90 jours ne repart pas.
    assert _session(h2)["cree"] == int(debut)
    horloge[0] = debut + ix.DUREE_MAX_SESSION + 1
    assert c.get("/api/auth/moi", headers=h2).status_code == 401


def test_rotations_simultanees_ne_creent_qu_un_jeton(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    h = connecter(c, codes, A)
    horloge[0] += ix.ROTATION_SESSION + 1
    depart, jetons = threading.Barrier(8), []

    def tourner():
        depart.wait()
        jetons.append(c.post("/api/auth/renouveler", headers=h).json()["token"])

    fils = [threading.Thread(target=tourner) for _ in range(8)]
    for fil in fils:
        fil.start()
    for fil in fils:
        fil.join()
    assert len([j for j in jetons if j]) == 1
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id "
                          "WHERE u.email = %s", (A,)).fetchone()["n"] == 2


def test_revocation_atteint_aussi_les_jetons_renouveles(env, monkeypatch):
    c, codes = env
    horloge = _horloge_session(monkeypatch)
    h = connecter(c, codes, A)
    horloge[0] += ix.ROTATION_SESSION + 1
    h2 = {"Authorization": f"Bearer {c.post('/api/auth/renouveler', headers=h).json()['token']}"}
    assert c.post("/api/auth/deconnexion-partout", headers=h2).status_code == 204
    assert c.get("/api/auth/moi", headers=h).status_code == 401
    assert c.get("/api/auth/moi", headers=h2).status_code == 401


def test_migration_12_garde_l_echeance_des_sessions_existantes(env):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        expire = _session(h)["expire"]
        cx.execute("ALTER TABLE sessions DROP COLUMN cree, DROP COLUMN emis, DROP COLUMN remplacee")
        cx.execute("DELETE FROM schema_migrations WHERE version >= 12")
        assert ix.appliquer_migrations(cx) == [v for v, _ in ix.MIGRATIONS if v >= 12]
    s = _session(h)
    assert (s["expire"], s["cree"], s["emis"], s["remplacee"]) == (expire, expire - 30 * 86400, expire - 30 * 86400, None)
    assert c.get("/api/auth/moi", headers=h).status_code == 200


def test_vider_sa_collection_seulement(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango", photo=PNG_1PX, notes="privé"), headers=ha)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra"), headers=ha)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=hb)
    vider = lambda h, corps: c.request("DELETE", "/api/cans", json=corps, headers=h)
    assert vider({}, {"confirmation": "vider"}).status_code == 401
    assert vider(ha, {}).status_code == 422  # confirmation obligatoire
    assert vider(ha, {"confirmation": "oui"}).status_code == 422
    assert len(c.get("/api/cans", headers=ha).json()) == 2
    r = vider(ha, {"confirmation": "vider"})
    assert r.status_code == 200 and r.json() == {"retirees": 2}
    assert c.get("/api/cans", headers=ha).json() == []
    assert c.get("/api/auth/moi", headers=ha).status_code == 200  # le compte reste
    assert [x["nom"] for x in c.get("/api/cans", headers=hb).json()] == ["Mango"]  # l'autre collection aussi
    assert fiche(c, hb, "2000000000022")["nom"] == "Ultra"  # le Wiki ne change pas
    assert vider(ha, {"confirmation": "vider"}).json() == {"retirees": 0}


def supprimer(c, h, confirmation):
    return c.request("DELETE", "/api/auth/compte", json={"confirmation": confirmation}, headers=h)


def test_une_session_creee_par_l_ancienne_api_reste_valable(env):
    """L'API v0.4.1, encore en production pendant la migration, insère ses sessions sans cree ni emis."""
    c, codes = env
    connecter(c, codes, A)
    jeton = "ancien-jeton-sans-dates"
    with ix.base() as cx:
        uid = cx.execute("SELECT id FROM users WHERE email = %s", (A,)).fetchone()["id"]
        cx.execute("INSERT INTO sessions (hash, user_id, expire) VALUES (%s, %s, %s)",
                   (ix._hash_session(jeton), uid, int(ix.time.time()) + 30 * 86400))
    s = _session({"Authorization": f"Bearer {jeton}"})
    assert abs(s["cree"] - ix.time.time()) < 60 and s["emis"] == s["cree"]
    assert c.get("/api/auth/moi", headers={"Authorization": f"Bearer {jeton}"}).status_code == 200


def test_suppression_de_compte_efface_ses_donnees_seulement(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    ha2 = connecter(c, codes, A)  # un second appareil
    c.put("/api/cans", json=canette(nom="Mango", photo=PNG_1PX, notes="privé"), headers=ha)
    c.put("/api/cans", json=canette(nom="De B"), headers=hb)
    assert c.get("/api/cans/2000000000015/photo", headers=ha).status_code == 200
    c.post("/api/auth/demande", json={"email": A})

    assert supprimer(c, {}, A).status_code == 401
    assert supprimer(c, ha, " TEST-A@example.com ").status_code == 204  # casse et espaces ignorés
    for h in (ha, ha2):  # accès révoqué sur tous les appareils
        assert c.get("/api/auth/moi", headers=h).status_code == 401
        assert c.get("/api/cans", headers=h).status_code == 401
        assert c.get("/api/cans/2000000000015/photo", headers=h).status_code == 401
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM users WHERE email = %s", (A,)).fetchone()["n"] == 0
        assert cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s", (A,)).fetchone()["n"] == 0
        # Plus aucune trace de la collection : ni ligne, ni photo, ni note.
        restes = cx.execute("SELECT * FROM collection WHERE notes = 'privé' OR photo IS NOT NULL").fetchall()
        assert restes == []
        assert A not in str(cx.execute("SELECT * FROM wiki WHERE ean = '2000000000015'").fetchall())
    assert [x["nom"] for x in c.get("/api/cans", headers=hb).json()] == ["Mango"]  # nom repris du Wiki
    assert fiche(c, hb, "2000000000015")["nom"] == "Mango"  # le Wiki, anonyme, reste
    # La photo donnée à la fiche (qui n'en avait pas) est une contribution au Wiki, sans lien avec le compte.
    assert c.get("/api/wiki/2000000000015/photo", headers=hb).status_code == 200

    h = connecter(c, codes, A)  # une nouvelle inscription repart de zéro
    assert c.get("/api/cans", headers=h).json() == []


def test_suppression_exige_l_adresse_du_compte(env):
    c, codes = env
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(nom="Mango"), headers=h)
    assert c.delete("/api/auth/compte", headers=h).status_code == 422  # sans confirmation
    assert supprimer(c, h, B).status_code == 422
    assert supprimer(c, h, "").status_code == 422
    assert c.get("/api/auth/moi", headers=h).status_code == 200
    assert len(c.get("/api/cans", headers=h).json()) == 1


def test_le_compte_proprietaire_ne_se_supprime_pas(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    assert supprimer(c, h, A).status_code == 403
    assert c.get("/api/auth/moi", headers=h).status_code == 200


def _vieillir_nouveaute(ean, jours):
    with ix.base() as cx:
        cx.execute(
            "UPDATE wiki SET nouveaute_depuis = %s WHERE ean = %s", (int(ix.time.time()) - jours * 86400, ean),
        )


def test_nouveaute_redevient_active_apres_30_jours(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(), headers=hb)
    corps = {"nom": "Mango", "status": "Nouveauté"}
    assert c.put("/api/wiki/2000000000015", json=corps, headers=ha).json()["status"] == "Nouveauté"
    assert c.get("/api/cans/2000000000015", headers=hb).json()["status"] == "Nouveauté"

    c.put("/api/cans", json=canette("2000000000022", nom="Ancienne"), headers=hb)
    nouveautes = lambda: [f["ean"] for f in _rechercher(c, hb, nouveautes="true", par_page=60)["fiches"]]
    _vieillir_nouveaute("2000000000015", 29)
    assert fiche(c, hb, "2000000000015")["status"] == "Nouveauté"
    assert "2000000000015" in nouveautes() and "2000000000022" not in nouveautes()  # filtre « Nouveautés »
    _vieillir_nouveaute("2000000000015", 31)
    assert fiche(c, hb, "2000000000015")["status"] == "Active"
    assert "2000000000015" not in nouveautes()
    assert next(x for x in c.get("/api/cans", headers=hb).json() if x["ean"] == "2000000000015")["status"] == "Active"
    assert c.patch("/api/cans/2000000000015/nb", json={"delta": 1}, headers=hb).json()["status"] == "Active"

    # Choisie de nouveau après expiration : 30 nouveaux jours.
    assert c.put("/api/wiki/2000000000015", json=corps, headers=ha).json()["status"] == "Nouveauté"


def test_nouveaute_en_cours_garde_sa_date(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(), headers=h)
    c.put("/api/wiki/2000000000015", json={"nom": "Mango", "status": "Nouveauté"}, headers=h)
    _vieillir_nouveaute("2000000000015", 25)
    c.put("/api/wiki/2000000000015", json={"nom": "Mango corrigé", "status": "Nouveauté"}, headers=h)
    # La date ne doit pas avoir été remise à zéro.
    with ix.base() as cx:
        depuis = cx.execute("SELECT nouveaute_depuis FROM wiki WHERE ean = '2000000000015'").fetchone()["nouveaute_depuis"]
    assert int(ix.time.time()) - depuis >= 25 * 86400 - 5

    c.put("/api/wiki/2000000000015", json={"nom": "Mango", "status": "Active"}, headers=h)
    with ix.base() as cx:
        assert cx.execute("SELECT nouveaute_depuis FROM wiki WHERE ean = '2000000000015'").fetchone()["nouveaute_depuis"] is None


def test_seul_le_proprietaire_valide_une_nouveaute(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    # Proposée par un autre compte : ignorée, sans erreur (le scan recopie le statut d'une fiche).
    r = c.put("/api/cans", json=canette("2000000000022", status="Nouveauté"), headers=hb)
    assert r.status_code == 200 and r.json()["status"] == ""
    assert fiche(c, ha, "2000000000022")["status"] == ""

    assert c.put("/api/cans", json=canette(status="Nouveauté"), headers=ha).json()["status"] == "Nouveauté"
    assert fiche(c, hb, "2000000000015")["status"] == "Nouveauté"
    # Un autre compte qui l'ajoute ensuite la voit telle quelle.
    assert c.put("/api/cans", json=canette(status="Nouveauté"), headers=hb).json()["status"] == "Nouveauté"
    _vieillir_nouveaute("2000000000015", 31)
    assert fiche(c, hb, "2000000000015")["status"] == "Active"
    assert c.put("/api/cans", json=canette(status="Bientôt"), headers=ha).status_code == 422


REELS = ("3017620422003", "0036000291452", "96385074")  # vrais codes du commerce, sans préfixe interne


def _oublier_codes_reels():
    with ix.base() as cx:
        cx.execute("DELETE FROM wiki_codes WHERE ean = ANY(%s) OR fiche = ANY(%s)", (list(REELS), list(REELS)))
        cx.execute("DELETE FROM wiki WHERE ean = ANY(%s)", (list(REELS),))
        cx.execute("DELETE FROM wiki_exclus WHERE ean = ANY(%s)", (list(REELS),))


def test_un_scan_donne_son_vrai_code_a_une_fiche_sans_code_barres(env, monkeypatch):
    c, codes = env
    _oublier_codes_reels()
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango Loco", nb=3, photo=PNG_1PX), headers=ha)  # code interne 20…

    assert c.post("/api/wiki/2000000000015/code-barres", json={"ean": REELS[0]}).status_code == 401
    r = c.post("/api/wiki/2000000000015/code-barres", json={"ean": " 036000291452 "}, headers=hb)  # UPC-A
    assert r.status_code == 200 and r.json()["ean"] == REELS[1] and r.json()["nom"] == "Mango Loco"

    assert fiche(c, hb, "2000000000015") is None
    mienne = c.get(f"/api/cans/{REELS[1]}", headers=ha).json()  # la collection du propriétaire a suivi
    assert mienne["nb"] == 3 and mienne["photo_version"]
    c.put("/api/cans", json=canette(nom="Ancien code"), headers=hb)  # l'ancien code ne revient pas
    assert fiche(c, hb, "2000000000015") is None
    _oublier_codes_reels()


def test_association_de_code_refusee(env, monkeypatch):
    c, codes = env
    _oublier_codes_reels()
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Sans code"), headers=ha)
    c.put("/api/cans", json=canette(REELS[0], nom="Déjà réel"), headers=ha)

    associer = lambda ean, code: c.post(f"/api/wiki/{ean}/code-barres", json={"ean": code}, headers=hb)  # noqa: E731
    assert associer("2000000000015", REELS[0]).status_code == 409  # ce code est déjà dans le Wiki
    for invalide in ("3017620422004", "2000000000022", "LOCAL-ABC", "123"):
        assert associer("2000000000015", invalide).status_code == 422
    assert associer("2000000000039", REELS[2]).status_code == 404  # fiche interne inconnue
    assert fiche(c, hb, "2000000000015")["nom"] == "Sans Code"
    _oublier_codes_reels()


def test_fiche_a_plusieurs_codes_barres(env, monkeypatch):
    c, codes = env
    _oublier_codes_reels()
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(REELS[0], nom="Ultra Paradise", nb=2), headers=ha)
    # Une autre canette a été enregistrée sous le second code avant qu'on sache que c'est la même.
    c.put("/api/cans", json=canette(REELS[2], nom="Paradise EU"), headers=hb)
    with ix.base() as cx:
        cx.execute("DELETE FROM wiki WHERE ean = %s", (REELS[2],))

    r = c.post(f"/api/wiki/{REELS[0]}/code-barres", json={"ean": REELS[2]}, headers=hb)
    assert r.status_code == 200 and r.json()["ean"] == REELS[0] and r.json()["codes"] == [REELS[2]]
    assert fiche(c, hb, REELS[0])["codes"] == [REELS[2]]
    # La canette de B rejoint la fiche ; scanner le second code ne crée plus de doublon.
    assert [x["ean"] for x in c.get("/api/cans", headers=hb).json()] == [REELS[0]]
    # A possède déjà la fiche : refus explicite plutôt qu'écraser sa quantité.
    assert c.put("/api/cans", json=canette(REELS[2], nom="Autre nom"), headers=ha).status_code == 409
    assert [(x["ean"], x["nb"]) for x in c.get("/api/cans", headers=ha).json()] == [(REELS[0], 2)]
    hc = connecter(c, codes, "test-c@example.com")  # un nouveau venu qui scanne le second code
    assert c.put("/api/cans", json=canette(REELS[2], nom="Paradise"), headers=hc).json()["ean"] == REELS[0]
    assert all(f["ean"] != REELS[2] for f in c.get("/api/wiki", headers=ha).json()["fiches"])

    assert c.post(f"/api/wiki/{REELS[0]}/code-barres", json={"ean": REELS[2]}, headers=hb).status_code == 409
    assert c.put(f"/api/wiki/{REELS[1]}", json={"ean": REELS[2], "nom": "x"}, headers=ha).status_code in (404, 409)

    # Renommer la fiche garde ses codes ; seul le propriétaire retire un code.
    c.put(f"/api/wiki/{REELS[0]}", json={"ean": REELS[1], "nom": "Ultra Paradise"}, headers=ha)
    assert fiche(c, ha, REELS[1])["codes"] == [REELS[2]]
    assert c.delete(f"/api/wiki/{REELS[1]}/code-barres/{REELS[2]}", headers=hb).status_code == 403
    r = c.delete(f"/api/wiki/{REELS[1]}/code-barres/{REELS[2]}", headers=ha)
    assert r.status_code == 200 and r.json()["codes"] == []
    assert c.delete(f"/api/wiki/{REELS[1]}/code-barres/{REELS[2]}", headers=ha).status_code == 404
    _oublier_codes_reels()


def test_suppression_d_une_fiche_retire_ses_codes(env, monkeypatch):
    c, codes = env
    _oublier_codes_reels()
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(REELS[0], nom="Mango"), headers=h)
    c.post(f"/api/wiki/{REELS[0]}/code-barres", json={"ean": REELS[2]}, headers=h)
    assert c.delete(f"/api/wiki/{REELS[0]}", headers=h).status_code == 409  # encore possédée
    assert c.delete(f"/api/cans/{REELS[0]}", headers=h).status_code == 204
    assert c.delete(f"/api/wiki/{REELS[0]}", headers=h).status_code == 204
    assert c.get("/api/wiki/" + REELS[2] + "/photo", headers=h).status_code == 404
    # Une fiche retirée par le propriétaire ne revient pas, ni par son code ni par un code secondaire.
    assert c.put("/api/cans", json=canette(REELS[2], nom="Recréée ?"), headers=h).status_code == 409
    assert fiche(c, h, REELS[2]) is None
    _oublier_codes_reels()


# --- Wiki (catalogue partagé) ----------------------------------------------------

PNG_1PX = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/"
    "q842iQAAAABJRU5ErkJggg=="
)


def fiche(c, h, ean):
    fiches = c.get("/api/wiki", headers=h).json()["fiches"]
    return next((f for f in fiches if f["ean"] == ean), None)


def test_fiche_encore_possedee_masquee_au_lieu_d_etre_supprimee(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=hb)
    assert c.delete("/api/wiki/2000000000015", headers=ha).status_code == 409
    r = c.post("/api/wiki/2000000000015/moderation",
               json={"decision": "refusee", "motif": "Masquée : encore dans une collection"}, headers=ha)
    assert r.status_code == 200 and r.json()["moderation"] == "refusee"
    assert fiche(c, hb, "2000000000015") is None  # masquée du Wiki des membres…
    assert [x["nom"] for x in c.get("/api/cans", headers=hb).json()] == ["Mango"]  # … mais gardée dans sa collection
    assert fiche(c, ha, "2000000000015")["moderation"] == "refusee"  # toujours visible du propriétaire
    c.post("/api/wiki/2000000000015/moderation", json={"decision": "acceptee"}, headers=ha)
    assert fiche(c, hb, "2000000000015")["nom"] == "Mango"  # « Accepter la fiche » la fait revenir


def test_wiki_exige_une_session(env):
    c, _ = env
    assert c.get("/api/wiki").status_code == 401
    assert c.get("/api/wiki/2000000000015/photo").status_code == 401
    assert c.put("/api/wiki/2000000000015", json={"description": "x"}).status_code == 401


def test_wiki_recoit_les_canettes_ajoutees_sans_donnees_de_collection(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put(
        "/api/cans",
        json=canette(nom="Mango Loco", volume="500 ml", edition="Juiced", etat="Pleine", nb=7, notes="secret", photo=PNG_1PX),
        headers=ha,
    )
    f = fiche(c, hb, "2000000000015")  # visible par un autre compte
    assert f["nom"] == "Mango Loco" and f["volume"] == "500 ml"
    assert "edition" not in f  # champ retiré : un ancien client qui l'envoie est ignoré
    assert f["description"] == ""
    assert (f["categorie"], f["flavor"], f["status"], f["region"]) == ("", "", "", "")
    assert set(f) == {
        "ean", "nom", "volume", "categorie", "flavor", "status", "region", "variante",
        "description", "photo", "codes", "doubles", "recherches", "je_cherche", "je_possede",
        "partage_doubles",  # réglage du compte qui consulte, pas de celui qui a ajouté la canette
    }
    assert f["photo"]  # la fiche n'avait pas de photo : celle envoyée devient la sienne
    assert c.get("/api/wiki/2000000000015/photo", headers=hb).status_code == 200
    assert "base64" not in str(c.get("/api/wiki", headers=hb).json())
    # Une fiche qui a déjà une photo la garde.
    c.put("/api/cans", json=canette(nom="Mango Loco", photo=PNG_1PX), headers=hb)
    assert fiche(c, hb, "2000000000015")["photo"] == f["photo"]


def test_wiki_la_premiere_fiche_reste_et_se_complete(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Original", volume=""), headers=ha)
    c.put(
        "/api/cans",
        json=canette(nom="Vandale", volume="473 ml", photo=PNG_1PX),
        headers=hb,
    )
    f = fiche(c, ha, "2000000000015")
    assert f["nom"] == "Original"  # pas d'écrasement
    assert f["volume"] == "473 ml"  # mais les champs vides sont complétés
    assert f["photo"]  # la fiche n'avait pas de photo : elle reçoit la première envoyée


def test_wiki_conserve_la_fiche_quand_on_retire_la_canette(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Durable"), headers=ha)
    assert c.delete("/api/cans/2000000000015", headers=ha).status_code == 204
    assert c.get("/api/cans", headers=ha).json() == []
    assert fiche(c, hb, "2000000000015")["nom"] == "Durable"


def test_canette_sans_code_barres_exige_un_nom(env):
    c, codes = env
    ha = connecter(c, codes, A)
    r = c.put("/api/cans", json=canette("LOCAL-TEST", nom="  "), headers=ha)
    assert r.status_code == 422
    assert c.get("/api/cans", headers=ha).json() == []


def test_canette_sans_code_barres_recoit_un_code_tire_du_nom(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    code = ix.convert.nom_en_13_chiffres("Test Sans Code")
    try:
        r = c.put("/api/cans", json=canette("LOCAL-TEST", nom="test  sans code", categorie="Ultra"), headers=ha)
        assert r.status_code == 200
        assert (r.json()["ean"], r.json()["nom"]) == (code, "Test Sans Code")
        assert fiche(c, hb, code)["categorie"] == "Ultra"
        # Même nom, autre compte : même code, donc la même fiche du Wiki, sans doublon.
        assert c.put("/api/cans", json=canette("LOCAL-AUTRE", nom="Test Sans Code"), headers=hb).json()["ean"] == code
        # Même nom dans la même collection : refusé plutôt qu'écraser la canette existante.
        assert c.put("/api/cans", json=canette("LOCAL-BIS", nom="Test Sans Code"), headers=ha).status_code == 409
    finally:
        with ix.base() as cx:
            cx.execute("DELETE FROM wiki WHERE ean = %s", (code,))


def test_wiki_photo_reservee_au_proprietaire(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    corps = {"photo": PNG_1PX}

    assert c.put("/api/wiki/2000000000015/photo", json=corps).status_code == 401
    assert c.put("/api/wiki/2000000000015/photo", json=corps, headers=hb).status_code == 403
    assert c.delete("/api/wiki/2000000000015/photo", headers=hb).status_code == 403
    assert fiche(c, hb, "2000000000015")["photo"] is None

    r = c.put("/api/wiki/2000000000015/photo", json=corps, headers=ha)
    assert r.status_code == 200 and r.json()["photo"]
    assert c.put("/api/wiki/TEST-INCONNU/photo", json=corps, headers=ha).status_code == 404
    for refusee in ("data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,abc", "pas une image"):
        assert c.put("/api/wiki/2000000000015/photo", json={"photo": refusee}, headers=ha).status_code == 422

    r = c.delete("/api/wiki/2000000000015/photo", headers=ha)
    assert r.status_code == 200 and r.json()["photo"] is None and r.json()["nom"] == "Mango"
    assert c.get("/api/wiki/2000000000015/photo", headers=hb).status_code == 404
    assert c.delete("/api/wiki/TEST-INCONNU/photo", headers=ha).status_code == 404


def test_wiki_photo_servie_a_part(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(), headers=h)
    c.put("/api/wiki/2000000000015/photo", json={"photo": PNG_1PX}, headers=h)
    r = c.get("/api/wiki/2000000000015/photo", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG") and r.headers["x-content-type-options"] == "nosniff"
    c.put("/api/cans", json=canette("2000000000022"), headers=h)  # sans photo
    assert c.get("/api/wiki/2000000000022/photo", headers=h).status_code == 404
    assert c.get("/api/wiki/TEST-INCONNU/photo", headers=h).status_code == 404


def test_wiki_ne_sert_que_des_formats_d_image_surs(env):
    c, codes = env
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(), headers=h)
    with ix.base() as cx:  # une ancienne fiche peut encore contenir un format non servi
        cx.execute("UPDATE wiki SET photo = 'data:image/svg+xml;base64,PHN2Zy8+' WHERE ean = '2000000000015'")
    assert c.get("/api/wiki/2000000000015/photo", headers=h).status_code == 404


def test_wiki_modification_reservee_au_proprietaire(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    assert c.get("/api/wiki", headers=ha).json()["peut_editer"] is True
    assert c.get("/api/wiki", headers=hb).json()["peut_editer"] is False

    corps = {
        "nom": "Monster Mango Loco", "volume": "500 ml",
        "categorie": "Ultra", "flavor": "Mango Tropical", "status": "Active", "region": "Global",
        "description": "Boisson énergisante.",
    }
    assert c.put("/api/wiki/2000000000015", json=corps, headers=hb).status_code == 403
    assert fiche(c, hb, "2000000000015")["description"] == ""

    r = c.put("/api/wiki/2000000000015", json=corps, headers=ha)
    assert r.status_code == 200 and r.json()["description"] == "Boisson énergisante."
    assert "edition" not in r.json()
    assert (r.json()["categorie"], r.json()["flavor"], r.json()["status"], r.json()["region"]) == (
        "Ultra", "Mango Tropical", "Active", "Global",
    )
    assert c.get("/api/cans/2000000000015", headers=hb).json()["categorie"] == "Ultra"
    assert fiche(c, hb, "2000000000015")["description"] == "Boisson énergisante."
    assert c.put("/api/wiki/TEST-INCONNU", json=corps, headers=ha).status_code == 404
    assert c.put("/api/wiki/2000000000015", json={"description": "x" * 4001}, headers=ha).status_code == 422
    assert c.put("/api/wiki/2000000000015", json={**corps, "status": "Discontinued"}, headers=ha).status_code == 422


def test_wiki_changement_de_code_barres_suit_les_collections_sans_doublon(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango", categorie="Ultra", photo=PNG_1PX), headers=hb)

    corps = {"ean": "2000000000022", "nom": "Mango", "categorie": "Ultra", "volume": "500 ml"}
    assert c.put("/api/wiki/2000000000015", json=corps, headers=hb).status_code == 403
    assert c.put("/api/wiki/2000000000015", json=corps, headers=ha).status_code == 200

    assert fiche(c, hb, "2000000000015") is None
    assert fiche(c, hb, "2000000000022")["nom"] == "Mango"
    assert c.get("/api/cans/2000000000015", headers=hb).status_code == 404
    r = c.get("/api/cans/2000000000022", headers=hb).json()
    assert r["categorie"] == "Ultra" and r["photo_version"]

    c.put("/api/cans", json=canette(nom="Ancien code"), headers=ha)  # l'ancien code ne recrée pas de fiche
    assert fiche(c, hb, "2000000000015") is None


def test_wiki_changement_de_code_barres_garde_les_deux_lignes_d_un_compte(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Ancienne"), headers=hb)
    with ix.base() as cx:
        uid = cx.execute("SELECT id FROM users WHERE email = %s", (B,)).fetchone()["id"]
        cx.execute(
            "INSERT INTO collection (user_id, ean, nom, ajout, maj) VALUES (%s, '2000000000022', 'Déjà là', 'x', 'x')",
            (uid,),
        )
    assert c.put("/api/wiki/2000000000015", json={"ean": "2000000000022", "nom": "M"}, headers=ha).status_code == 200
    noms = {x["ean"]: x["nom"] for x in c.get("/api/cans", headers=hb).json()}
    # Les deux lignes sont gardées ; l'ancien code mène à la fiche qui l'a remplacé, dont le nom est affiché.
    assert noms == {"2000000000015": "M", "2000000000022": "M"}


def test_wiki_fiche_supprimee_ne_revient_que_par_restauration(env, monkeypatch, tmp_path):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    assert c.delete("/api/cans/2000000000015", headers=hb).status_code == 204
    assert c.delete("/api/wiki/2000000000015", headers=ha).status_code == 204
    assert fiche(c, ha, "2000000000015") is None

    # Un nouvel ajout est refusé : la fiche a été retirée volontairement.
    assert c.put("/api/cans", json=canette(nom="Mango 2"), headers=hb).status_code == 409
    assert fiche(c, ha, "2000000000015") is None
    # Une restauration (opération d'administration) remet la canette, et donc sa fiche.
    restaurer(monkeypatch, tmp_path, [{"ean": "2000000000015", "nom": "Mango 3"}], B)
    assert fiche(c, ha, "2000000000015")["nom"] == "Mango 3"


def test_wiki_refuse_code_barres_deja_utilise(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(ean="2000000000015", nom="Mango"), headers=hb)
    c.put("/api/cans", json=canette(ean="2000000000022", nom="Ultra"), headers=hb)

    corps = {"ean": "2000000000022", "nom": "Mango", "volume": "", "description": ""}
    r = c.put("/api/wiki/2000000000015", json=corps, headers=ha)
    assert r.status_code == 409
    assert fiche(c, hb, "2000000000015")["nom"] == "Mango"


def test_wiki_suppression_reservee_au_proprietaire_et_refusee_si_possedee(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)

    assert c.delete("/api/wiki/2000000000015").status_code == 401
    assert c.delete("/api/wiki/2000000000015", headers=hb).status_code == 403
    assert fiche(c, hb, "2000000000015") is not None

    # Encore dans une collection : la fiche ne se supprime pas, et la collection reste intacte.
    assert c.delete("/api/wiki/2000000000015", headers=ha).status_code == 409
    assert fiche(c, hb, "2000000000015") is not None
    assert c.get("/api/cans/2000000000015", headers=hb).status_code == 200
    assert c.delete("/api/wiki/TEST-INCONNU", headers=ha).status_code == 404


def test_wiki_modification_du_proprietaire_survit_a_un_nouvel_ajout(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    c.put("/api/wiki/2000000000015", json={"nom": "Mango Loco", "description": "Texte."}, headers=ha)
    c.put("/api/cans", json=canette(nom="Autre nom"), headers=hb)
    f = fiche(c, hb, "2000000000015")
    assert (f["nom"], f["description"]) == ("Mango Loco", "Texte.")



def test_wiki_amorce_depuis_les_collections_existantes_une_seule_fois(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="", volume=""), headers=ha)
    c.put("/api/cans", json=canette(nom="Nommée", volume="500 ml", photo=PNG_1PX, nb=4, notes="privé"), headers=hb)
    c.put("/api/cans", json=canette("LOCAL-AMORCE", nom="Perso"), headers=ha)
    # Simule une base d'avant le Wiki : la table n'existe pas encore, les collections si.
    with ix.connecter() as cx:
        cx.execute("DROP TABLE messages")
        cx.execute("DROP TABLE echanges")
        cx.execute("DROP TABLE recherches")
        cx.execute("DROP TABLE wiki_moderations")
        cx.execute("DROP TABLE wiki_signalements")
        cx.execute("DROP TABLE wiki_codes")
        cx.execute("DROP TABLE wiki")
        cx.execute("DELETE FROM schema_migrations")
        assert ix.appliquer_migrations(cx) == [v for v, _ in ix.MIGRATIONS]
    with ix.base() as cx:
        r = cx.execute("SELECT * FROM wiki WHERE ean = '2000000000015'").fetchall()
        assert cx.execute("SELECT COUNT(*) AS n FROM wiki WHERE ean = 'LOCAL-AMORCE'").fetchone()["n"] == 0
        assert cx.execute(  # la canette ajoutée sans code-barres a sa fiche, sous le code tiré du nom
            "SELECT COUNT(*) AS n FROM wiki WHERE ean = %s", (ix.convert.nom_en_13_chiffres("Perso"),)
        ).fetchone()["n"] == 1
    assert len(r) == 1 and r[0]["nom"] == "Nommée" and r[0]["photo"] is None  # les photos restent privées
    assert "privé" not in str(r) and "nb" not in r[0]

    # Une fois la table remplie, un redémarrage ne ré-importe plus rien.
    with ix.connecter() as cx:
        cx.execute("INSERT INTO wiki (ean, cree, maj) VALUES ('2000000000022', 'x', 'x')")
        cx.execute("DELETE FROM wiki WHERE ean = '2000000000015'")
        assert ix.appliquer_migrations(cx) == []
        assert cx.execute("SELECT COUNT(*) AS n FROM wiki WHERE ean = '2000000000015'").fetchone()["n"] == 0


def test_api_refuse_une_base_non_migree_sans_la_modifier(env, monkeypatch):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        cx.execute("DELETE FROM schema_migrations WHERE version = %s", (ix.MIGRATIONS[-1][0],))
    monkeypatch.setattr(ix, "_schema_pret", False)
    try:
        r = c.get("/api/cans", headers=h)
        assert r.status_code == 503 and "mettre à jour" in r.json()["detail"]
    finally:
        with ix.connecter() as cx:
            assert ix.appliquer_migrations(cx) == [ix.MIGRATIONS[-1][0]]


def test_une_preview_vercel_met_sa_base_a_jour_seule(env, monkeypatch):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        cx.execute("DELETE FROM schema_migrations WHERE version = %s", (ix.MIGRATIONS[-1][0],))
    monkeypatch.setattr(ix, "_schema_pret", False)
    monkeypatch.setenv("VERCEL_ENV", "preview")
    monkeypatch.setenv("SM_MIGRATION_AUTO", "1")
    assert c.get("/api/cans", headers=h).status_code == 200
    with ix.connecter() as cx:
        v = cx.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()["v"]
    assert v == ix.MIGRATIONS[-1][0]


def test_une_preview_sans_sm_migration_auto_ne_migre_pas(env, monkeypatch):
    """Preview qui partage la base de production : elle ne doit pas la migrer d'elle-même."""
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        cx.execute("DELETE FROM schema_migrations WHERE version = %s", (ix.MIGRATIONS[-1][0],))
    monkeypatch.setattr(ix, "_schema_pret", False)
    monkeypatch.setenv("VERCEL_ENV", "preview")
    monkeypatch.delenv("SM_MIGRATION_AUTO", raising=False)
    try:
        assert c.get("/api/cans", headers=h).status_code == 503
        with ix.connecter() as cx:
            v = cx.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()["v"]
        assert v == ix.MIGRATIONS[-1][0] - 1
    finally:
        with ix.connecter() as cx:
            assert ix.appliquer_migrations(cx) == [ix.MIGRATIONS[-1][0]]


def test_la_production_ne_migre_jamais_seule(env, monkeypatch):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        cx.execute("DELETE FROM schema_migrations WHERE version = %s", (ix.MIGRATIONS[-1][0],))
    monkeypatch.setattr(ix, "_schema_pret", False)
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("SM_MIGRATION_AUTO", "1")  # sans effet en production
    try:
        assert c.get("/api/cans", headers=h).status_code == 503
    finally:
        with ix.connecter() as cx:
            assert ix.appliquer_migrations(cx) == [ix.MIGRATIONS[-1][0]]


def test_une_seule_connexion_par_requete(env, monkeypatch):
    c, codes = env
    h = connecter(c, codes, A)
    vraie, appels = ix.psycopg.connect, []
    monkeypatch.setattr(ix.psycopg, "connect", lambda *a, **k: appels.append(1) or vraie(*a, **k))

    assert c.get("/api/cans").status_code == 401 and appels == []
    assert c.get("/api/cans", headers=h).status_code == 200 and len(appels) == 1
    appels.clear()
    assert c.put("/api/cans", json=canette(), headers=h).status_code == 200 and len(appels) == 1
    assert c.delete("/api/cans/2000000000099", headers=h).status_code == 404
    assert c.get("/api/cans", headers={"Authorization": "Bearer faux"}).status_code == 401


@pytest.mark.parametrize(
    ("saisi", "attendu"),
    [
        ("monster energy ultra white", "Monster Energy Ultra White"),
        ("  monster   lo-carb ", "Monster Lo-Carb"),
        ("pipeline punch (USA)", "Pipeline Punch (USA)"),
        ("", ""),
    ],
)
def test_nom_majuscule_a_chaque_mot(saisi, attendu):
    assert ix.formater_nom(saisi) == attendu
    assert ix.Canette(ean="1", nom=saisi).nom == attendu
    assert ix.FicheWiki(nom=saisi).nom == attendu


def test_la_collection_reprend_les_infos_du_wiki(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango", volume="500 ml", photo=PNG_1PX, notes="à moi"), headers=hb)
    perso = c.get("/api/cans/2000000000015", headers=hb).json()
    assert perso["dans_wiki"] and perso["photo_wiki"]  # la photo envoyée est devenue celle de la fiche

    corps = {"nom": "Mango Loco", "volume": "473 ml", "description": "Texte du Wiki."}
    assert c.put("/api/wiki/2000000000015", json=corps, headers=ha).status_code == 200

    r = c.get("/api/cans/2000000000015", headers=hb).json()
    assert (r["nom"], r["volume"], r["description"], r["notes"]) == ("Mango Loco", "473 ml", "Texte du Wiki.", "à moi")
    assert r["photo_wiki"] and r["photo_version"].startswith("wiki-")
    assert c.get("/api/cans", headers=hb).json()[0]["nom"] == "Mango Loco"
    assert c.patch("/api/cans/2000000000015/nb", json={"delta": 1}, headers=hb).json()["nom"] == "Mango Loco"
    assert c.get("/api/cans/2000000000015/photo", headers=hb).status_code == 200

    # Photo du Wiki retirée par le propriétaire : la photo personnelle, conservée, revient.
    assert c.delete("/api/wiki/2000000000015/photo", headers=ha).status_code == 200
    r = c.get("/api/cans/2000000000015", headers=hb).json()
    assert r["photo_version"] and not r["photo_wiki"]


def test_migration_cree_la_fiche_des_canettes_hors_wiki(env):
    c, codes = env
    ha = connecter(c, codes, A)
    c.put("/api/cans", json=canette(nom="Mango"), headers=ha)
    with ix.base() as cx:
        uid = cx.execute("SELECT id FROM users WHERE email = %s", (A,)).fetchone()["id"]
        cx.execute(  # ancienne canette privée, d'avant la règle « tout est dans le Wiki »
            "INSERT INTO collection (user_id, ean, nom, photo, ajout, maj) VALUES (%s, 'LOCAL-ANCIENNE', 'Perso', %s, 'x', 'x')",
            (uid, PNG_1PX),
        )
        cx.execute("DELETE FROM wiki WHERE ean = '2000000000015'")
        cx.execute("INSERT INTO wiki_exclus (ean, exclu) VALUES ('2000000000015', 'x') ON CONFLICT DO NOTHING")
        cx.execute(ix.FICHES_MANQUANTES)
        cx.execute(ix.FICHES_MANQUANTES)  # sans effet la seconde fois
        assert cx.execute("SELECT COUNT(*) AS n FROM wiki_exclus WHERE ean = '2000000000015'").fetchone()["n"] == 0
        assert cx.execute("SELECT COUNT(*) AS n FROM collection WHERE user_id = %s", (uid,)).fetchone()["n"] == 2
    assert fiche(c, ha, "2000000000015")["nom"] == "Mango"
    ancienne = fiche(c, ha, "LOCAL-ANCIENNE")
    assert ancienne["nom"] == "Perso" and ancienne["photo"] is None  # les anciennes photos privées le restent


def test_un_ancien_code_mene_a_la_fiche_qui_l_a_remplace(env, monkeypatch):
    c, codes = env
    _oublier_codes_reels()
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    interne = ix.convert.nom_en_13_chiffres("Test Redirection")
    try:
        assert c.put("/api/cans", json=canette("LOCAL-X", nom="Test Redirection"), headers=ha).json()["ean"] == interne
        assert c.post(f"/api/wiki/{interne}/code-barres", json={"ean": REELS[0]}, headers=ha).json()["ean"] == REELS[0]
        # Même nom ajouté sans code-barres par un autre compte : il rejoint la fiche, sans doublon.
        r = c.put("/api/cans", json=canette("LOCAL-Y", nom="Test Redirection"), headers=hb)
        assert r.status_code == 200 and r.json()["ean"] == REELS[0]
        assert fiche(c, hb, interne) is None
        assert c.delete(f"/api/wiki/{REELS[0]}", headers=ha).status_code == 409
    finally:
        with ix.base() as cx:
            cx.execute("DELETE FROM wiki_exclus WHERE ean = %s", (interne,))
        _oublier_codes_reels()


def test_le_mail_du_code_a_une_version_html_et_texte(monkeypatch):
    envoye = {}

    class Reponse:
        def close(self):
            pass

    def faux_urlopen(req, timeout):
        envoye.update(json.loads(req.data))
        return Reponse()

    monkeypatch.setenv("RESEND_API_KEY", "cle-de-test")
    monkeypatch.setenv("SITE_URL", "https://exemple.test/")
    monkeypatch.setattr(ix.urllib.request, "urlopen", faux_urlopen)
    ix.envoyer_code("test-a@example.com", "482913")

    assert envoye["to"] == ["test-a@example.com"] and "482913" in envoye["subject"]
    assert "482913" in envoye["text"] and "10 minutes" in envoye["text"]
    html = envoye["html"]
    # Le code est affiché chiffre par chiffre ; le logo et le lien pointent vers le site, sans double barre.
    assert all(f">{c}</div>" in html for c in "482913")
    assert 'src="https://exemple.test/images/logo-mail.png"' in html and "//images" not in html
    assert "<style" not in html  # styles sur chaque balise : Gmail ignore les feuilles de style


def test_provenance_anonyme_visible_du_seul_proprietaire(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    code = ix.convert.nom_en_13_chiffres("Test Provenance")
    try:
        c.put("/api/cans", json=canette("LOCAL-PROV", nom="Test Provenance"), headers=hb)
        assert "provenance" not in fiche(c, hb, "2000000000015")  # un autre compte ne la voit pas
        p = fiche(c, ha, "2000000000015")["provenance"]
        assert p["source"] == "code-barres" and p["cree"] and p["corrigee"] is None
        assert fiche(c, ha, code)["provenance"]["source"] == "sans-code"

        r = c.put("/api/wiki/2000000000015", json={"nom": "Mango Loco"}, headers=ha).json()
        assert r["provenance"]["source"] == "code-barres" and r["provenance"]["corrigee"]
        # Aucune trace du compte : la table wiki n'a pas de colonne d'auteur.
        with ix.base() as cx:
            cols = {x["column_name"] for x in cx.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name IN ('wiki', 'wiki_signalements')"
            ).fetchall()}
        assert not cols & {"user_id", "email", "auteur"}
    finally:
        with ix.base() as cx:
            cx.execute("DELETE FROM wiki WHERE ean = %s", (code,))


def test_signaler_une_fiche_et_traiter_le_signalement(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)

    assert c.post("/api/wiki/2000000000015/signalement", json={"motif": "Mauvais"}).status_code == 401
    assert c.post("/api/wiki/2000000000015/signalement", json={"motif": " x "}, headers=hb).status_code == 422
    assert c.post("/api/wiki/TEST-INCONNU/signalement", json={"motif": "Erreur"}, headers=hb).status_code == 404
    r = c.post("/api/wiki/2000000000015/signalement", json={"motif": "  Mauvais   volume : 473 ml "}, headers=hb)
    assert r.status_code == 201

    assert "signalements" not in fiche(c, hb, "2000000000015")  # réservé au propriétaire
    sig = fiche(c, ha, "2000000000015")["signalements"]
    assert len(sig) == 1 and sig[0]["motif"] == "Mauvais volume : 473 ml"

    assert c.post(f"/api/wiki/signalements/{sig[0]['id']}/traite", headers=hb).status_code == 403
    r = c.post(f"/api/wiki/signalements/{sig[0]['id']}/traite", headers=ha)
    assert r.status_code == 200 and r.json()["signalements"] == []
    assert c.post(f"/api/wiki/signalements/{sig[0]['id']}/traite", headers=ha).status_code == 404


def _rechercher(c, h, **params):
    r = c.get("/api/wiki/recherche", params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_recherche_catalogue_par_nom_saveur_pays_gamme_et_code(env, monkeypatch):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango Loco", flavor="Mangue Passion", categorie="Juiced",
                                     region="Europe", notes="note très privée", nb=7), headers=ha)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra Rosà", categorie="Ultra", region="US"), headers=ha)
    c.put("/api/cans", json=canette("2000000000039", nom="Pipeline Punch", categorie="Juiced", region="US"), headers=ha)

    assert c.get("/api/wiki/recherche").status_code == 401
    noms = lambda r: [f["nom"] for f in r["fiches"]]
    # B ne possède rien : la recherche porte sur le catalogue, pas sur les collections.
    assert noms(_rechercher(c, hb, q="mango")) == ["Mango Loco"]
    assert noms(_rechercher(c, hb, q="ROSA")) == ["Ultra Rosà"]  # sans accents ni majuscules
    assert noms(_rechercher(c, hb, q="passion")) == ["Mango Loco"]  # par la saveur
    assert noms(_rechercher(c, hb, q="2000000000022")) == ["Ultra Rosà"]  # par le code-barres
    assert noms(_rechercher(c, hb, q="juiced us")) == ["Pipeline Punch"]  # chaque mot doit correspondre
    assert noms(_rechercher(c, hb, categorie="Juiced", tri="nom")) == ["Mango Loco", "Pipeline Punch"]
    assert noms(_rechercher(c, hb, region="US", categorie="Ultra")) == ["Ultra Rosà"]
    c.put("/api/cans", json=canette("2000000000046", nom="Sans Gamme"), headers=ha)
    monkeypatch.setenv("OWNER_EMAIL", A)
    sans = noms(_rechercher(c, ha, sans_categorie="true", par_page=60))
    assert "Sans Gamme" in sans and not {"Mango Loco", "Ultra Rosà", "Pipeline Punch"} & set(sans)
    tout = noms(_rechercher(c, hb, sans_categorie="true", par_page=60))  # ignoré pour un membre
    assert {"Mango Loco", "Ultra Rosà", "Pipeline Punch", "Sans Gamme"} <= set(tout)
    assert noms(_rechercher(c, hb, q="100%_")) == []  # % et _ ne sont pas des jokers

    r = _rechercher(c, hb, q="mango")
    assert r["total_catalogue"] >= 3 and r["total"] == 1 and r["pages"] == 1
    fiche_trouvee = r["fiches"][0]
    assert "note" not in str(fiche_trouvee) and "nb" not in fiche_trouvee and "etat" not in fiche_trouvee


def test_recherche_paginee_et_suggestions(env):
    c, codes = env
    h = connecter(c, codes, A)
    for i in range(5):
        code = ix.convert.nom_en_13_chiffres(f"Test Pagination {i}")
        c.put("/api/cans", json=canette(f"LOCAL-P{i}", nom=f"Test Pagination {i}"), headers=h)
    try:
        p1 = _rechercher(c, h, q="pagination", tri="nom", par_page=2)
        p3 = _rechercher(c, h, q="pagination", tri="nom", par_page=2, page=3)
        assert (p1["total"], p1["pages"], len(p1["fiches"])) == (5, 3, 2)
        assert [f["nom"] for f in p3["fiches"]] == ["Test Pagination 4"]
        assert _rechercher(c, h, q="pagination", par_page=2, page=9)["fiches"] == []
        assert c.get("/api/wiki/recherche", params={"par_page": 500}, headers=h).status_code == 422

        r = _rechercher(c, h, q="paginatoin")  # faute de frappe : rien, mais des noms proches
        assert r["total"] == 0 and r["suggestions"] and all("Pagination" in n for n in r["suggestions"])
        assert _rechercher(c, h, q="zzzzqqq")["suggestions"] == []
    finally:
        with ix.base() as cx:
            cx.execute("DELETE FROM wiki WHERE nom LIKE 'Test Pagination %'")


def test_recherche_des_fiches_signalees_reservee_au_proprietaire(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra"), headers=hb)
    c.post("/api/wiki/2000000000015/signalement", json={"motif": "Mauvais nom"}, headers=hb)

    r = _rechercher(c, ha, signalees="true")
    assert r["signalees"] == 1 and [f["ean"] for f in r["fiches"]] == ["2000000000015"]
    r = _rechercher(c, hb, signalees="true")  # ignoré pour un autre compte
    assert r["signalees"] == 0 and len(r["fiches"]) >= 2



def test_une_fiche_creee_par_un_membre_est_a_verifier(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=hb)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra"), headers=ha)
    assert "moderation" not in fiche(c, hb, "2000000000015")  # statut réservé au propriétaire
    assert fiche(c, ha, "2000000000015")["moderation"] == "en_attente"
    assert fiche(c, ha, "2000000000022")["moderation"] == "acceptee"  # créée par le propriétaire
    # Un autre ajout de la même canette ne change pas le statut.
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=ha)
    assert fiche(c, ha, "2000000000015")["moderation"] == "en_attente"


def test_proposer_une_canette_sans_l_ajouter_a_sa_collection(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    corps = {"ean": "2000000000015", "nom": "mango loco", "region": "Europe", "flavor": "Mangue", "volume": "500 ml",
             "photo": PNG_1PX}
    assert c.post("/api/wiki/propositions", json=corps).status_code == 401
    r = c.post("/api/wiki/propositions", json=corps, headers=hb)
    assert r.status_code == 201
    f = r.json()
    assert (f["nom"], f["region"]) == ("Mango Loco", "Europe") and f["photo"] and "moderation" not in f
    assert fiche(c, ha, "2000000000015")["moderation"] == "en_attente"
    assert c.get("/api/cans", headers=hb).json() == []  # proposer n'ajoute pas à la collection

    assert c.post("/api/wiki/propositions", json=corps, headers=hb).status_code == 409  # même code-barres
    assert c.post("/api/wiki/propositions", json={"ean": "123", "nom": "X"}, headers=hb).status_code == 422
    # Nom très proche d'une fiche existante : confirmation demandée, puis acceptée.
    proche = {"nom": "Mango Loko"}
    r = c.post("/api/wiki/propositions", json=proche, headers=hb)
    assert r.status_code == 409 and "Mango Loco" in r.json()["detail"]
    code = ix.convert.nom_en_13_chiffres("Mango Loko")
    try:
        r = c.post("/api/wiki/propositions", json={**proche, "confirmer_doublon": True}, headers=hb)
        assert r.status_code == 201 and r.json()["ean"] == code  # sans code-barres : code tiré du nom
        # Proposée par le propriétaire : acceptée d'emblée.
        r = c.post("/api/wiki/propositions", json={"ean": "2000000000022", "nom": "Pipeline"}, headers=ha)
        assert r.json()["moderation"] == "acceptee"
    finally:
        with ix.base() as cx:
            cx.execute("DELETE FROM wiki WHERE ean = %s", (code,))


def test_moderation_accepter_refuser_et_historique(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=hb)
    url = "/api/wiki/2000000000015/moderation"
    assert c.post(url, json={"decision": "acceptee"}, headers=hb).status_code == 403
    assert c.post("/api/wiki/TEST-INCONNU/moderation", json={"decision": "acceptee"}, headers=ha).status_code == 404
    assert c.post(url, json={"decision": "peut-etre"}, headers=ha).status_code == 422

    r = c.post(url, json={"decision": "refusee", "motif": "  Doublon de   Mango Loco "}, headers=ha).json()
    assert r["moderation"] == "refusee" and r["moderations"][-1]["motif"] == "Doublon de Mango Loco"
    # Refusée : absente du catalogue des membres (liste, recherche), toujours visible du propriétaire…
    assert fiche(c, hb, "2000000000015") is None
    assert all(f["ean"] != "2000000000015" for f in _rechercher(c, hb, q="mango")["fiches"])
    assert fiche(c, ha, "2000000000015")["moderation"] == "refusee"
    # … et la collection du membre la garde.
    assert c.get("/api/cans/2000000000015", headers=hb).json()["nom"] == "Mango"

    r = c.post(url, json={"decision": "acceptee"}, headers=ha).json()
    assert r["moderation"] == "acceptee" and [m["decision"] for m in r["moderations"]] == ["refusee", "acceptee"]
    assert "moderations" not in fiche(c, hb, "2000000000015")  # historique réservé au propriétaire

    c.put("/api/cans", json=canette("2000000000022", nom="Ultra"), headers=hb)
    r = _rechercher(c, ha, a_verifier="true", par_page=60)
    eans = [f["ean"] for f in r["fiches"]]
    assert "2000000000022" in eans and "2000000000015" not in eans and r["a_verifier"] == len(eans)
    assert all(f["moderation"] == "en_attente" for f in r["fiches"])


# --- Fiches normalisées (issue #5) ----------------------------------------------------


def test_normaliser_volume():
    n = ix.normaliser_volume
    assert [n("500"), n(" 500ml "), n("355 ML"), n("16 oz"), n("16 fl oz"), n("")] == [
        "500 ml", "500 ml", "355 ml", "473 ml", "473 ml", ""]
    assert n("grand") is None and n("5") is None and n("9999") is None


def test_listes_controlees_identiques_au_front():
    """Catégories, pays et variantes : mêmes valeurs dans l'API et dans src/categories.ts."""
    import re
    from pathlib import Path
    ts = (Path(__file__).resolve().parent.parent / "src" / "categories.ts").read_text()

    def liste(nom):
        bloc = re.search(rf"export const {nom} = \[(.*?)\] as const", ts, re.S).group(1)
        return tuple(re.findall(r"'([^']+)'", bloc))

    assert liste("CATEGORIES") == ix.CATEGORIES
    assert liste("REGIONS") == ix.REGIONS
    assert liste("VARIANTES") == ix.VARIANTES


def test_fiche_champs_controles(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    url = "/api/wiki/2000000000015"
    base = {"nom": "Mango Loco", "categorie": "Juiced", "region": "Europe", "flavor": "Mangue", "variante": "Zero Sugar"}
    r = c.put(url, json={**base, "volume": "500"}, headers=ha)
    assert r.status_code == 200 and r.json()["volume"] == "500 ml" and r.json()["a_reprendre"] == []
    f = fiche(c, hb, "2000000000015")
    assert (f["volume"], f["variante"], f["flavor"]) == ("500 ml", "Zero Sugar", "Mangue")  # visible des membres
    r = c.put(url, json={**base, "volume": "grand"}, headers=ha)
    assert r.status_code == 422 and r.json()["detail"].startswith("volume attendu en ml")
    for mauvais in ({"volume": "grand"}, {"volume": "5"}, {"flavor": "x" * 61}, {"categorie": "Inconnue"},
                    {"region": "Mars"}, {"variante": "Géante"}):
        assert c.put(url, json={**base, **mauvais}, headers=ha).status_code == 422, mauvais
    assert c.put(url, json={**base, "volume": "", "variante": ""}, headers=ha).json()["variante"] == ""


def test_ajout_depuis_la_collection_normalise_sans_bloquer(env):
    c, codes = env
    h = connecter(c, codes, A)
    # Une ancienne appli encore en cache envoie un volume nu ou illisible : accepté, mis au format si possible.
    assert c.put("/api/cans", json=canette("2000000000015", nom="Mango", volume="500", variante="Shot"),
                 headers=h).status_code == 200
    assert c.put("/api/cans", json=canette("2000000000022", nom="Ultra", volume="un grand", variante="Géante"),
                 headers=h).status_code == 200
    f1, f2 = fiche(c, h, "2000000000015"), fiche(c, h, "2000000000022")
    assert (f1["volume"], f1["variante"]) == ("500 ml", "Shot")
    assert (f2["volume"], f2["variante"]) == ("un grand", "")
    assert next(x for x in c.get("/api/cans", headers=h).json() if x["ean"] == "2000000000015")["variante"] == "Shot"


def test_proposition_champs_controles(env):
    c, codes = env
    h = connecter(c, codes, A)
    corps = {"nom": "Ultra Fiesta", "volume": "355 ml", "variante": "Édition limitée", "region": "US"}
    assert c.post("/api/wiki/propositions", json={**corps, "volume": "beaucoup"}, headers=h).status_code == 422
    r = c.post("/api/wiki/propositions", json=corps, headers=h)
    assert r.status_code == 201 and (r.json()["volume"], r.json()["variante"]) == ("355 ml", "Édition limitée")


def test_recherche_par_variante_et_suggestions_de_saveurs(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette("2000000000015", nom="Vanilla Espresso", flavor="Vanille", variante="Shot"), headers=h)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra Vanille", flavor="Vanille"), headers=h)
    c.put("/api/cans", json=canette("2000000000039", nom="Mango", flavor="Mangue"), headers=h)
    noms = lambda r: [f["nom"] for f in r["fiches"]]
    assert noms(_rechercher(c, h, variante="Shot")) == ["Vanilla Espresso"]
    assert "Vanilla Espresso" in noms(_rechercher(c, h, q="shot"))  # la variante entre dans la recherche
    assert c.get("/api/wiki/saveurs").status_code == 401
    saveurs = c.get("/api/wiki/saveurs", headers=h).json()
    assert saveurs.index("Vanille") < saveurs.index("Mangue")  # la plus fréquente d'abord


def test_migration_14_normalise_les_anciennes_fiches_sans_perte(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    longue = "Sucré et salé, avec une pointe de vanille onctueuse et une finale caramel."
    anciennes = [
        ("2000000000015", "Monster Energy Zero Sugar Vanilla Shot", "500", longue, "", "Active"),
        ("2000000000022", "Monster VR46 Rossi", "355ml", longue, "Déjà une description", "Discontinued"),
        ("2000000000039", "Monster Ultra White", "un grand", "Agrumes", "", ""),
        ("2000000000046", "Monster Energy X McLaren", "", "", "", ""),
    ]
    with ix.connecter() as cx:
        for ean, nom, volume, flavor, description, status in anciennes:
            cx.execute("INSERT INTO wiki (ean, nom, volume, flavor, description, status, cree, maj) "
                       "VALUES (%s, %s, %s, %s, %s, %s, 'x', 'x')", (ean, nom, volume, flavor, description, status))
        cx.execute("UPDATE wiki SET variante = '' WHERE ean LIKE '200000000%'")
        cx.execute("DROP TABLE IF EXISTS sauvegarde_migration_14")
        cx.execute("DELETE FROM schema_migrations WHERE version = 14")
        assert ix.appliquer_migrations(cx) == [14]
        sauvegarde = {r["ean"]: r for r in cx.execute(
            "SELECT * FROM sauvegarde_migration_14 WHERE source = 'wiki' AND ean LIKE '200000000%'").fetchall()}
    assert sauvegarde["2000000000015"]["volume"] == "500" and sauvegarde["2000000000015"]["flavor"] == longue
    fiches = {f["ean"]: f for f in _rechercher(c, h, q="200000000", par_page=60)["fiches"]}
    shot, vr46, ultra, mclaren = (fiches[e] for e, *_ in anciennes)
    assert (shot["volume"], shot["flavor"], shot["description"], shot["variante"]) == ("500 ml", "", longue, "Shot")
    # Description déjà remplie : la saveur longue reste, signalée à reprendre.
    assert (vr46["volume"], vr46["flavor"], vr46["status"], vr46["variante"]) == ("355 ml", longue, "Stop", "Collaboration")
    assert vr46["a_reprendre"] == ["saveur"]
    assert (ultra["volume"], ultra["a_reprendre"], ultra["variante"]) == ("un grand", ["volume"], "")
    assert mclaren["variante"] == "Collaboration"
    # Les anciennes fiches restent modifiables et valides.
    r = c.put("/api/wiki/2000000000039", json={"nom": "Monster Ultra White", "volume": "500"}, headers=h)
    assert r.status_code == 200 and r.json()["a_reprendre"] == []


def test_migration_15_complete_les_variantes_vides(env):
    c, codes = env
    h = connecter(c, codes, A)
    with ix.connecter() as cx:
        for ean, nom, variante in [("2000000000015", "Monster Energy Limited Edition Gold", ""),
                                   ("2000000000022", "Monster Mango Édition Limitée", ""),
                                   ("2000000000039", "Monster Ultra White", ""),
                                   ("2000000000046", "Monster Energy Zero Sugar", "Zero Sugar"),
                                   ("2000000000053", "", "")]:
            cx.execute("INSERT INTO wiki (ean, nom, variante, cree, maj) VALUES (%s, %s, %s, 'x', 'x')", (ean, nom, variante))
        cx.execute("DELETE FROM schema_migrations WHERE version = 15")
        assert ix.appliquer_migrations(cx) == [15]
        lignes = cx.execute("SELECT ean, variante FROM wiki WHERE ean LIKE '200000000%'").fetchall()
    variantes = {r["ean"]: r["variante"] for r in lignes}
    assert variantes == {"2000000000015": "Édition limitée", "2000000000022": "Édition limitée",
                         "2000000000039": "Standard", "2000000000046": "Zero Sugar", "2000000000053": ""}


# --- Échanges, étape 1 : doubles et recherchées ------------------------------------------


def test_doubles_comptes_sur_la_fiche_sans_dire_qui(env):
    c, codes = env
    ha, hb, hc = connecter(c, codes, A), connecter(c, codes, B), connecter(c, codes, "test-c@example.com")
    c.put("/api/cans", json=canette(nom="Mango", nb=3), headers=ha)
    c.put("/api/cans", json=canette(nom="Mango", nb=1), headers=hb)  # un seul exemplaire : pas de double
    # Partage activé par défaut : les doubles de A comptent d'office, sans rien proposer canette par canette.
    f = fiche(c, hc, "2000000000015")
    assert f["doubles"] == 1 and A not in str(f) and B not in str(f)
    c.patch("/api/cans/2000000000015/nb", json={"delta": -2}, headers=ha)  # plus qu'un exemplaire
    assert fiche(c, hc, "2000000000015")["doubles"] == 0
    c.patch("/api/cans/2000000000015/nb", json={"delta": 1}, headers=ha)
    assert fiche(c, hc, "2000000000015")["doubles"] == 1
    # L'ancienne route de proposition par canette n'existe plus.
    assert c.patch("/api/cans/2000000000015/echange", json={"echange": True}, headers=ha).status_code in (404, 405)


def test_canette_recherchee_puis_trouvee(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=ha)
    url = "/api/wiki/2000000000015/recherche"
    assert c.post(url).status_code == 401
    assert c.post("/api/wiki/TEST-INCONNU/recherche", headers=hb).status_code == 404
    assert c.post(url, headers=ha).status_code == 409  # déjà dans sa collection
    r = c.post(url, headers=hb)
    assert r.status_code == 200 and r.json()["je_cherche"] is True and r.json()["recherches"] == 1
    assert c.post(url, headers=hb).json()["recherches"] == 1  # deux fois : compté une seule fois
    assert fiche(c, ha, "2000000000015")["recherches"] == 1
    assert fiche(c, ha, "2000000000015")["je_cherche"] is False  # propre à chaque compte
    assert fiche(c, ha, "2000000000015")["je_possede"] is True and fiche(c, hb, "2000000000015")["je_possede"] is False
    resultat = _rechercher(c, hb, je_cherche="true")
    assert [f["ean"] for f in resultat["fiches"]] == ["2000000000015"] and resultat["je_cherche"] == 1
    assert _rechercher(c, ha, je_cherche="true")["fiches"] == []
    # La collection de A montre combien la cherchent.
    assert c.get("/api/cans/2000000000015", headers=ha).json()["recherches"] == 1
    # B l'ajoute à sa collection : elle n'est plus recherchée.
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    assert fiche(c, ha, "2000000000015")["recherches"] == 0
    # Retirer une recherche
    c.delete("/api/cans/2000000000015", headers=hb)
    c.post(url, headers=hb)
    r = c.delete(url, headers=hb)
    assert r.status_code == 200 and r.json()["je_cherche"] is False and r.json()["recherches"] == 0


def test_filtre_doubles_disponibles(env):
    c, codes = env
    ha = connecter(c, codes, A)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango", nb=2), headers=ha)
    c.put("/api/cans", json=canette("2000000000022", nom="Ultra", nb=1), headers=ha)
    assert [f["ean"] for f in _rechercher(c, ha, doubles="true", par_page=60)["fiches"]] == ["2000000000015"]


def test_recherches_suivent_le_compte_et_la_fiche(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette("2000000000015", nom="Mango"), headers=ha)
    c.delete("/api/cans/2000000000015", headers=ha)
    c.post("/api/wiki/2000000000015/recherche", headers=hb)
    # Le code-barres de la fiche change : la recherche suit.
    c.put("/api/wiki/2000000000015", json={"ean": "2000000000022", "nom": "Mango"}, headers=ha)
    assert fiche(c, hb, "2000000000022")["je_cherche"] is True
    # Fiche supprimée : la recherche disparaît avec elle.
    assert c.delete("/api/wiki/2000000000022", headers=ha).status_code == 204
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM recherches").fetchone()["n"] == 0
    # Compte supprimé : ses recherches aussi.
    c.put("/api/cans", json=canette("2000000000039", nom="Ultra"), headers=ha)
    c.delete("/api/cans/2000000000039", headers=ha)
    c.post("/api/wiki/2000000000039/recherche", headers=hb)
    assert supprimer(c, hb, B).status_code == 204
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM recherches").fetchone()["n"] == 0


def test_partage_des_doublons_desactive_dans_les_reglages(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango", nb=3), headers=ha)
    assert fiche(c, hb, "2000000000015")["doubles"] == 1
    assert c.patch("/api/auth/partage-doubles", json={"echange": False}).status_code == 401
    r = c.patch("/api/auth/partage-doubles", json={"echange": False}, headers=ha)
    assert r.status_code == 200 and r.json() == {"partage_doubles": False}
    assert c.get("/api/auth/moi", headers=ha).json()["partage_doubles"] is False
    # Les fiches du Wiki portent le réglage du compte connecté (le bloc Échanges y est alors masqué).
    assert fiche(c, ha, "2000000000015")["partage_doubles"] is False
    assert fiche(c, hb, "2000000000015")["partage_doubles"] is True
    # Plus rien n'est compté ni trouvé par le filtre.
    assert fiche(c, hb, "2000000000015")["doubles"] == 0
    assert _rechercher(c, hb, doubles="true", par_page=60)["fiches"] == []
    canette_a = c.get("/api/cans/2000000000015", headers=ha).json()
    assert canette_a["partage_doubles"] is False
    # Réactivé : tous les doubles réapparaissent.
    c.patch("/api/auth/partage-doubles", json={"echange": True}, headers=ha)
    assert fiche(c, hb, "2000000000015")["doubles"] == 1


# --- Échanges, étape 2 : mise en relation et messagerie ----------------------------------------


C = "test-c@example.com"


def _echanges(c, h):
    r = c.get("/api/echanges", headers=h)
    assert r.status_code == 200
    return r.json()


def _mise_en_relation(c, codes, nb=2):
    """A a Mango en double, B le cherche."""
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango", nb=nb), headers=ha)
    c.delete("/api/cans/2000000000015", headers=hb)
    assert c.post("/api/wiki/2000000000015/recherche", headers=hb).status_code == 200
    return ha, hb


def test_echange_complet_jusqu_a_la_messagerie(env):
    c, codes = env
    assert c.get("/api/echanges").status_code == 401
    ha, hb = _mise_en_relation(c, codes)
    hc = connecter(c, codes, C)

    # 1. L'appli repère la paire : le chercheur est notifié, sans savoir qui ; le possesseur, rien encore.
    eb = _echanges(c, hb)
    assert len(eb["notifications"]) == 1 and eb["non_lus"] == 1
    n = eb["notifications"][0]
    assert (n["role"], n["statut"], n["action"], n["fiche"]["nom"]) == ("chercheur", "signalee", True, "Mango")
    assert A not in str(eb)
    assert _echanges(c, ha) == {"notifications": [], "conversations": [], "non_lus": 0}
    assert _echanges(c, hb)["notifications"][0]["id"] == n["id"]  # pas de doublon d'une lecture à l'autre

    # Un tiers ne peut rien faire sur cet échange.
    assert c.post(f"/api/echanges/{n['id']}/accepter", headers=hc).status_code == 404
    assert c.post(f"/api/echanges/{n['id']}/annuler", headers=hc).status_code == 404
    # Le possesseur ne peut pas répondre avant la demande.
    assert c.post(f"/api/echanges/{n['id']}/accepter", headers=ha).status_code in (404, 409)

    # 2. « Échange » du chercheur : le possesseur est notifié à son tour.
    r = c.post(f"/api/echanges/{n['id']}/accepter", headers=hb)
    assert r.status_code == 200 and r.json()["statut"] == "demandee"
    assert c.post(f"/api/echanges/{n['id']}/accepter", headers=hb).status_code == 409  # une seule fois
    eb = _echanges(c, hb)
    assert eb["notifications"][0]["action"] is False and eb["non_lus"] == 0  # en attente de réponse
    ea = _echanges(c, ha)
    assert len(ea["notifications"]) == 1 and ea["non_lus"] == 1 and B not in str(ea)
    assert (ea["notifications"][0]["role"], ea["notifications"][0]["action"]) == ("possesseur", True)
    assert c.get(f"/api/echanges/{n['id']}/messages", headers=hb).status_code == 404  # pas encore ouverte

    # 3. « Échange » du possesseur : la messagerie s'ouvre pour les deux.
    assert c.post(f"/api/echanges/{n['id']}/accepter", headers=ha).json()["statut"] == "acceptee"
    for h in (ha, hb):
        e = _echanges(c, h)
        assert e["notifications"] == [] and len(e["conversations"]) == 1

    # 4. Messagerie : seuls les deux membres lisent et écrivent ; jamais d'adresse.
    url = f"/api/echanges/{n['id']}/messages"
    assert c.post(url, json={"texte": "   "}, headers=hb).status_code == 422
    assert c.post(url, json={"texte": "x" * 1001}, headers=hb).status_code == 422
    assert c.post(url, json={"texte": "Salut, je te propose un Ultra"}, headers=hc).status_code == 404
    m = c.post(url, json={"texte": "  Salut, je te propose un Ultra  "}, headers=hb).json()
    assert m["de_moi"] is True and m["texte"] == "Salut, je te propose un Ultra"
    ea = _echanges(c, ha)
    assert ea["non_lus"] == 1 and ea["conversations"][0]["dernier"] == "Salut, je te propose un Ultra"
    assert _echanges(c, hb)["non_lus"] == 0  # ses propres messages ne comptent pas
    lu = c.get(url, headers=ha).json()
    assert [(x["texte"], x["de_moi"]) for x in lu["messages"]] == [("Salut, je te propose un Ultra", False)]
    assert A not in str(lu) and B not in str(lu)
    assert _echanges(c, ha)["non_lus"] == 0
    c.post(url, json={"texte": "Ok !"}, headers=ha)
    assert [x["texte"] for x in c.get(f"{url}?apres={m['id']}", headers=hb).json()["messages"]] == ["Ok !"]
    assert c.get(url, headers=hc).status_code == 404

    # La conversation reste même si la canette n'est plus cherchée.
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    assert len(_echanges(c, hb)["conversations"]) == 1

    # Le compte supprimé emporte ses échanges et ses messages.
    assert supprimer(c, ha, A).status_code == 204
    assert _echanges(c, hb)["conversations"] == []


def test_annuler_ne_previent_personne_et_n_est_pas_repropose(env):
    c, codes = env
    ha, hb = _mise_en_relation(c, codes)
    n = _echanges(c, hb)["notifications"][0]
    assert c.post(f"/api/echanges/{n['id']}/annuler", headers=ha).status_code == 409  # pas encore à lui
    assert c.post(f"/api/echanges/{n['id']}/annuler", headers=hb).json()["statut"] == "annulee"
    assert _echanges(c, hb)["notifications"] == []  # pas recréée
    assert _echanges(c, ha)["notifications"] == []  # A n'a jamais rien su
    assert c.post(f"/api/echanges/{n['id']}/accepter", headers=hb).status_code == 409


def test_le_possesseur_annule_la_demande(env):
    c, codes = env
    ha, hb = _mise_en_relation(c, codes)
    n = _echanges(c, hb)["notifications"][0]
    c.post(f"/api/echanges/{n['id']}/accepter", headers=hb)
    assert c.post(f"/api/echanges/{n['id']}/annuler", headers=ha).json()["statut"] == "annulee"
    assert _echanges(c, ha)["notifications"] == [] and _echanges(c, hb)["notifications"] == []
    assert c.get(f"/api/echanges/{n['id']}/messages", headers=hb).status_code == 404


def test_un_autre_possesseur_est_propose_apres_une_annulation(env):
    c, codes = env
    ha, hb = _mise_en_relation(c, codes)
    hc = connecter(c, codes, C)
    c.put("/api/cans", json=canette(nom="Mango", nb=3), headers=hc)
    notifs = _echanges(c, hb)["notifications"]
    assert len(notifs) == 1  # une seule notification par canette à la fois
    c.post(f"/api/echanges/{notifs[0]['id']}/annuler", headers=hb)
    suivante = _echanges(c, hb)["notifications"]
    assert len(suivante) == 1 and suivante[0]["id"] != notifs[0]["id"]
    # Une demande en cours bloque les autres notifications pour cette canette.
    c.post(f"/api/echanges/{suivante[0]['id']}/accepter", headers=hb)
    assert [x["statut"] for x in _echanges(c, hb)["notifications"]] == ["demandee"]


def test_pas_de_mise_en_relation_sans_double_ni_partage(env):
    c, codes = env
    ha, hb = _mise_en_relation(c, codes, nb=1)
    assert _echanges(c, hb)["notifications"] == []  # un seul exemplaire : pas de double
    c.patch("/api/cans/2000000000015/nb", json={"delta": 1}, headers=ha)
    n = _echanges(c, hb)["notifications"]
    assert len(n) == 1
    # Le possesseur coupe le partage : la notification disparaît, et « Échange » est refusé.
    c.patch("/api/auth/partage-doubles", json={"echange": False}, headers=ha)
    assert _echanges(c, hb)["notifications"] == []
    assert c.post(f"/api/echanges/{n[0]['id']}/accepter", headers=hb).status_code == 409
    c.patch("/api/auth/partage-doubles", json={"echange": True}, headers=ha)
    # Le chercheur coupe le sien : plus de notification non plus.
    c.patch("/api/auth/partage-doubles", json={"echange": False}, headers=hb)
    assert _echanges(c, hb)["notifications"] == []
    c.patch("/api/auth/partage-doubles", json={"echange": True}, headers=hb)
    # Le chercheur ne la cherche plus : masquée.
    c.delete("/api/wiki/2000000000015/recherche", headers=hb)
    assert _echanges(c, hb)["notifications"] == []


def test_messages_limites_par_heure(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("SM_MESSAGES_MAX_HEURE", "2")
    ha, hb = _mise_en_relation(c, codes)
    n = _echanges(c, hb)["notifications"][0]
    c.post(f"/api/echanges/{n['id']}/accepter", headers=hb)
    c.post(f"/api/echanges/{n['id']}/accepter", headers=ha)
    url = f"/api/echanges/{n['id']}/messages"
    assert [c.post(url, json={"texte": str(i)}, headers=hb).status_code for i in range(3)] == [200, 200, 429]
    assert c.post(url, json={"texte": "à moi"}, headers=ha).status_code == 200  # compté par compte
