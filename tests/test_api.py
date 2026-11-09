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
        cx.execute("DELETE FROM wiki WHERE ean LIKE '200000000%'")
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
    assert c.get("/api/auth/moi", headers=h).json() == {"email": A}
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
    assert c.get("/api/cans/2000000000015", headers=ha).json()["nom"] == "de A"


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
    assert c.put("/api/cans", json=canette(photo=None), headers=h).json()["photo_version"] is None
    assert c.get("/api/cans/2000000000015/photo", headers=h).status_code == 404


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


@pytest.mark.parametrize("champ,taille", [("nom", 201), ("edition", 201), ("volume", 41), ("etat", 41)])
def test_longueurs_refusees(env, champ, taille):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette(**{champ: "x" * taille}), headers=h).status_code == 422


@pytest.mark.parametrize("photo", ["pas une image", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,abc"])
def test_format_de_photo_refuse(env, photo):
    c, codes = env
    h = connecter(c, codes, A)
    assert c.put("/api/cans", json=canette(photo=photo), headers=h).status_code == 422


def test_ajuster_sans_fiche_wiki(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(), headers=h)
    c.delete("/api/wiki/2000000000015", headers=h)
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
        "ean": "2000000000015", "nom": "Mango", "edition": "Ultra", "volume": "500 ml", "categorie": "Juiced",
        "flavor": "Mango", "status": "Active", "region": "Global", "etat": "Pleine", "nb": 4, "notes": "Rare",
        "photo": None, "ajout": "2025-01-01T00:00:00.000Z",
    }
    locale = {"ean": "LOCAL-RESTO", "nom": "Perso", "photo": PNG_1PX, "nb": 2, "ajout": "2025-01-02T00:00:00.000Z"}

    restaurer(monkeypatch, tmp_path, [fiche_sauvee, locale], A.upper())
    restaurer(monkeypatch, tmp_path, [fiche_sauvee, locale], A)  # relance sans doublon

    cans = {x["ean"]: x for x in c.get("/api/cans", headers=ha).json()}
    assert set(cans) == {"2000000000015", "2000000000022", "LOCAL-RESTO"}
    r = cans["2000000000015"]
    assert (r["nom"], r["etat"], r["nb"], r["notes"], r["ajout"]) == (
        "Mango", "Pleine", 4, "Rare", "2025-01-01T00:00:00.000Z",
    )
    assert r["categorie"] == "Juiced" and r["flavor"] == "Mango"
    assert r["photo_version"]  # une sauvegarde sans photo n'efface pas la photo existante
    assert cans["LOCAL-RESTO"]["photo_version"]
    assert fiche(c, hb, "LOCAL-RESTO") is None
    assert fiche(c, hb, "2000000000015")["photo"] is None
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


def test_suppression_de_compte_efface_ses_donnees_seulement(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango", photo=PNG_1PX, notes="privé"), headers=ha)
    c.put("/api/cans", json=canette(nom="De B"), headers=hb)
    c.post("/api/auth/demande", json={"email": A})

    assert c.delete("/api/auth/compte").status_code == 401
    assert c.delete("/api/auth/compte", headers=ha).status_code == 204
    assert c.get("/api/auth/moi", headers=ha).status_code == 401
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM users WHERE email = %s", (A,)).fetchone()["n"] == 0
        assert cx.execute("SELECT COUNT(*) AS n FROM codes WHERE email = %s", (A,)).fetchone()["n"] == 0
    assert [x["nom"] for x in c.get("/api/cans", headers=hb).json()] == ["De B"]
    assert fiche(c, hb, "2000000000015")["nom"] == "Mango"  # le Wiki, anonyme, reste

    h = connecter(c, codes, A)  # une nouvelle inscription repart de zéro
    assert c.get("/api/cans", headers=h).json() == []


def test_le_compte_proprietaire_ne_se_supprime_pas(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    h = connecter(c, codes, A)
    assert c.delete("/api/auth/compte", headers=h).status_code == 403
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

    _vieillir_nouveaute("2000000000015", 29)
    assert fiche(c, hb, "2000000000015")["status"] == "Nouveauté"
    _vieillir_nouveaute("2000000000015", 31)
    assert fiche(c, hb, "2000000000015")["status"] == "Active"
    assert c.get("/api/cans", headers=hb).json()[0]["status"] == "Active"
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


def test_nouveaute_choisie_a_la_creation(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    assert c.put("/api/cans", json=canette(status="Nouveauté"), headers=ha).json()["status"] == "Nouveauté"
    _vieillir_nouveaute("2000000000015", 31)
    assert fiche(c, hb, "2000000000015")["status"] == "Active"
    assert c.put("/api/cans", json=canette(status="Bientôt"), headers=ha).status_code == 422


# --- Wiki (catalogue partagé) ----------------------------------------------------

PNG_1PX = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/"
    "q842iQAAAABJRU5ErkJggg=="
)


def fiche(c, h, ean):
    fiches = c.get("/api/wiki", headers=h).json()["fiches"]
    return next((f for f in fiches if f["ean"] == ean), None)


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
    assert f["edition"] == "Juiced"
    assert f["description"] == ""
    assert (f["categorie"], f["flavor"], f["status"], f["region"]) == ("", "", "", "")
    assert set(f) == {
        "ean", "nom", "edition", "volume", "categorie", "flavor", "status", "region",
        "description", "photo",
    }
    assert f["photo"] is None  # la photo d'un compte reste privée
    assert c.get("/api/wiki/2000000000015/photo", headers=hb).status_code == 404
    assert "base64" not in str(c.get("/api/wiki", headers=hb).json())


def test_wiki_la_premiere_fiche_reste_et_se_complete(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Original", volume=""), headers=ha)
    c.put(
        "/api/cans",
        json=canette(nom="Vandale", edition="Ultra", volume="473 ml", photo=PNG_1PX),
        headers=hb,
    )
    f = fiche(c, ha, "2000000000015")
    assert f["nom"] == "Original"  # pas d'écrasement
    assert f["edition"] == "Ultra"
    assert f["volume"] == "473 ml"  # mais les champs vides sont complétés
    assert f["photo"] is None


def test_wiki_conserve_la_fiche_quand_on_retire_la_canette(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Durable"), headers=ha)
    assert c.delete("/api/cans/2000000000015", headers=ha).status_code == 204
    assert c.get("/api/cans", headers=ha).json() == []
    assert fiche(c, hb, "2000000000015")["nom"] == "Durable"


def test_canette_sans_code_barres_reste_hors_du_wiki(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    r = c.put("/api/cans", json=canette("LOCAL-TEST", nom="Perso", photo=PNG_1PX, categorie="Ultra"), headers=ha)
    assert r.status_code == 200 and r.json()["categorie"] == ""
    assert fiche(c, hb, "LOCAL-TEST") is None
    assert c.get("/api/cans/LOCAL-TEST", headers=ha).json()["nom"] == "Perso"
    assert c.patch("/api/cans/LOCAL-TEST/nb", json={"delta": 1}, headers=ha).json()["nb"] == 2


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
        "nom": "Monster Mango Loco", "edition": "Ultra", "volume": "500 ml",
        "categorie": "Ultra", "flavor": "Mango Tropical", "status": "Active", "region": "Global",
        "description": "Boisson énergisante.",
    }
    assert c.put("/api/wiki/2000000000015", json=corps, headers=hb).status_code == 403
    assert fiche(c, hb, "2000000000015")["description"] == ""

    r = c.put("/api/wiki/2000000000015", json=corps, headers=ha)
    assert r.status_code == 200 and r.json()["description"] == "Boisson énergisante."
    assert r.json()["edition"] == "Ultra"
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
    assert noms == {"2000000000015": "Ancienne", "2000000000022": "Déjà là"}


def test_wiki_fiche_supprimee_ne_reapparait_pas(env, monkeypatch, tmp_path):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    assert c.delete("/api/wiki/2000000000015", headers=ha).status_code == 204

    assert c.put("/api/cans", json=canette(nom="Mango 2"), headers=hb).status_code == 200
    restaurer(monkeypatch, tmp_path, [{"ean": "2000000000015", "nom": "Mango 3"}], B)
    assert fiche(c, ha, "2000000000015") is None
    assert c.get("/api/cans/2000000000015", headers=hb).json()["nom"] == "Mango 3"


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


def test_wiki_suppression_reservee_au_proprietaire_sans_supprimer_les_collections(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)

    assert c.delete("/api/wiki/2000000000015").status_code == 401
    assert c.delete("/api/wiki/2000000000015", headers=hb).status_code == 403
    assert fiche(c, hb, "2000000000015") is not None

    r = c.delete("/api/wiki/2000000000015", headers=ha)
    assert r.status_code == 204
    assert fiche(c, hb, "2000000000015") is None
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
        cx.execute("DROP TABLE wiki")
        cx.execute("DELETE FROM schema_migrations")
        assert ix.appliquer_migrations(cx) == [v for v, _ in ix.MIGRATIONS]
    with ix.base() as cx:
        r = cx.execute("SELECT * FROM wiki WHERE ean = '2000000000015'").fetchall()
        assert cx.execute("SELECT COUNT(*) AS n FROM wiki WHERE ean = 'LOCAL-AMORCE'").fetchone()["n"] == 0
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
