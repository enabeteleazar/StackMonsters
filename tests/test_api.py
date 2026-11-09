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
        cx.execute("DELETE FROM wiki WHERE ean LIKE 'TEST-%'")
    yield TestClient(ix.app), codes
    with ix.base() as cx:
        cx.execute("DELETE FROM users WHERE email LIKE 'test-%@example.com'")
        cx.execute("DELETE FROM codes WHERE email LIKE 'test-%@example.com'")
        cx.execute(
            "DELETE FROM connexions_uniques WHERE ip_hash = ANY(%s)",
            ([ix._empreinte_ip(IP_A), ix._empreinte_ip(IP_B)],),
        )
        cx.execute("DELETE FROM wiki WHERE ean LIKE 'TEST-%'")


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
    assert {cle: fiche(c, h, "TEST-1")[cle] for cle in ("categorie", "flavor", "status", "region")} == {
        "categorie": "Ultra", "flavor": "Mango", "status": "Active", "region": "Global",
    }

    c.put("/api/cans", json=canette(categorie="Juiced", flavor="Autre", status="Stop"), headers=h)
    assert {cle: fiche(c, h, "TEST-1")[cle] for cle in ("categorie", "flavor", "status", "region")} == {
        "categorie": "Ultra", "flavor": "Mango", "status": "Active", "region": "Global",
    }
    assert c.put("/api/cans", json=canette(status="Discontinued"), headers=h).status_code == 422


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
    assert c.get("/api/wiki/TEST-1/photo").status_code == 401
    assert c.put("/api/wiki/TEST-1", json={"pays": "France"}).status_code == 401


def test_wiki_recoit_les_canettes_ajoutees_sans_donnees_de_collection(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put(
        "/api/cans",
        json=canette(nom="Mango Loco", volume="500 ml", edition="Juiced", etat="Pleine", nb=7, notes="secret", photo=PNG_1PX),
        headers=ha,
    )
    f = fiche(c, hb, "TEST-1")  # visible par un autre compte
    assert f["nom"] == "Mango Loco" and f["volume"] == "500 ml"
    assert f["edition"] == "Juiced"
    assert f["pays"] == "" and f["description"] == ""
    assert (f["categorie"], f["flavor"], f["status"], f["region"]) == ("", "", "", "")
    assert set(f) == {
        "ean", "nom", "edition", "volume", "categorie", "flavor", "status", "region",
        "pays", "description", "photo",
    }
    assert f["photo"]  # simple marqueur de version : les octets de l'image ne sont pas dans la liste
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
    f = fiche(c, ha, "TEST-1")
    assert f["nom"] == "Original"  # pas d'écrasement
    assert f["edition"] == "Ultra"
    assert f["volume"] == "473 ml" and f["photo"]  # mais les champs vides sont complétés


def test_wiki_conserve_la_fiche_quand_on_retire_la_canette(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Durable"), headers=ha)
    assert c.delete("/api/cans/TEST-1", headers=ha).status_code == 204
    assert c.get("/api/cans", headers=ha).json() == []
    assert fiche(c, hb, "TEST-1")["nom"] == "Durable"


def test_wiki_photo_servie_a_part(env):
    c, codes = env
    h = connecter(c, codes, A)
    c.put("/api/cans", json=canette(photo=PNG_1PX), headers=h)
    r = c.get("/api/wiki/TEST-1/photo", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG") and r.headers["x-content-type-options"] == "nosniff"
    c.put("/api/cans", json=canette("TEST-2"), headers=h)  # sans photo
    assert c.get("/api/wiki/TEST-2/photo", headers=h).status_code == 404
    assert c.get("/api/wiki/TEST-INCONNU/photo", headers=h).status_code == 404


def test_wiki_ne_sert_que_des_formats_d_image_surs(env):
    c, codes = env
    h = connecter(c, codes, A)
    svg = "data:image/svg+xml;base64,PHN2Zy8+"
    c.put("/api/cans", json=canette(photo=svg), headers=h)
    assert c.get("/api/wiki/TEST-1/photo", headers=h).status_code == 404


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
        "pays": "États-Unis", "description": "Boisson énergisante.",
    }
    assert c.put("/api/wiki/TEST-1", json=corps, headers=hb).status_code == 403
    assert fiche(c, hb, "TEST-1")["pays"] == ""

    r = c.put("/api/wiki/TEST-1", json=corps, headers=ha)
    assert r.status_code == 200 and r.json()["pays"] == "États-Unis"
    assert r.json()["edition"] == "Ultra"
    assert (r.json()["categorie"], r.json()["flavor"], r.json()["status"], r.json()["region"]) == (
        "Ultra", "Mango Tropical", "Active", "Global",
    )
    assert c.get("/api/cans/TEST-1", headers=hb).json()["categorie"] == "Ultra"
    assert fiche(c, hb, "TEST-1")["description"] == "Boisson énergisante."
    assert c.put("/api/wiki/TEST-INCONNU", json=corps, headers=ha).status_code == 404
    assert c.put("/api/wiki/TEST-1", json={"description": "x" * 4001}, headers=ha).status_code == 422
    assert c.put("/api/wiki/TEST-1", json={**corps, "status": "Discontinued"}, headers=ha).status_code == 422


def test_wiki_code_barres_modifiable_uniquement_par_le_proprietaire_sans_modifier_les_collections(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)

    corps = {"ean": "TEST-2", "nom": "Mango", "volume": "500 ml", "pays": "France", "description": "Fiche."}
    assert c.put("/api/wiki/TEST-1", json=corps, headers=hb).status_code == 403
    assert c.put("/api/wiki/TEST-1", json=corps, headers=ha).status_code == 200

    assert fiche(c, hb, "TEST-1") is None
    assert fiche(c, hb, "TEST-2")["nom"] == "Mango"
    assert c.get("/api/cans/TEST-1", headers=hb).status_code == 200
    assert c.get("/api/cans/TEST-2", headers=hb).status_code == 404


def test_wiki_refuse_code_barres_deja_utilise(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(ean="TEST-1", nom="Mango"), headers=hb)
    c.put("/api/cans", json=canette(ean="TEST-2", nom="Ultra"), headers=hb)

    corps = {"ean": "TEST-2", "nom": "Mango", "volume": "", "pays": "", "description": ""}
    r = c.put("/api/wiki/TEST-1", json=corps, headers=ha)
    assert r.status_code == 409
    assert fiche(c, hb, "TEST-1")["nom"] == "Mango"


def test_wiki_suppression_reservee_au_proprietaire_sans_supprimer_les_collections(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)

    assert c.delete("/api/wiki/TEST-1").status_code == 401
    assert c.delete("/api/wiki/TEST-1", headers=hb).status_code == 403
    assert fiche(c, hb, "TEST-1") is not None

    r = c.delete("/api/wiki/TEST-1", headers=ha)
    assert r.status_code == 204
    assert fiche(c, hb, "TEST-1") is None
    assert c.get("/api/cans/TEST-1", headers=hb).status_code == 200
    assert c.delete("/api/wiki/TEST-INCONNU", headers=ha).status_code == 404


def test_wiki_modification_du_proprietaire_survit_a_un_nouvel_ajout(env, monkeypatch):
    c, codes = env
    monkeypatch.setenv("OWNER_EMAIL", A)
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="Mango"), headers=hb)
    c.put("/api/wiki/TEST-1", json={"nom": "Mango Loco", "pays": "France", "description": "Texte."}, headers=ha)
    c.put("/api/cans", json=canette(nom="Autre nom"), headers=hb)
    f = fiche(c, hb, "TEST-1")
    assert (f["nom"], f["pays"], f["description"]) == ("Mango Loco", "France", "Texte.")



def test_wiki_amorce_depuis_les_collections_existantes_une_seule_fois(env):
    c, codes = env
    ha, hb = connecter(c, codes, A), connecter(c, codes, B)
    c.put("/api/cans", json=canette(nom="", volume=""), headers=ha)
    c.put("/api/cans", json=canette(nom="Nommée", volume="500 ml", photo=PNG_1PX, nb=4, notes="privé"), headers=hb)
    # Simule une base d'avant le Wiki : la table n'existe pas encore, les collections si.
    with ix.base() as cx:
        cx.execute("DROP TABLE wiki")
    ix._schema_pret = False
    with ix.base() as cx:
        r = cx.execute("SELECT * FROM wiki WHERE ean = 'TEST-1'").fetchall()
    assert len(r) == 1 and r[0]["nom"] == "Nommée" and r[0]["photo"] == PNG_1PX  # la fiche la plus complète
    assert "privé" not in str(r) and "nb" not in r[0]

    # Une fois la table remplie, un redémarrage ne ré-importe plus rien.
    with ix.base() as cx:
        cx.execute("INSERT INTO wiki (ean, cree, maj) VALUES ('TEST-2', 'x', 'x')")
        cx.execute("DELETE FROM wiki WHERE ean = 'TEST-1'")
    ix._schema_pret = False
    with ix.base() as cx:
        assert cx.execute("SELECT COUNT(*) AS n FROM wiki WHERE ean = 'TEST-1'").fetchone()["n"] == 0
