import hashlib

# Préfixe « 20 » : plage réservée par GS1 à l'usage interne. Aucun produit vendu en magasin
# ne porte un code commençant par 20, donc un code inventé ne peut pas prendre celui d'une
# vraie canette scannée plus tard.
PREFIXE = "20"


def cle_de_controle(douze_chiffres: str) -> str:
    """Dernier chiffre d'un EAN-13 : poids 1 et 3 en alternance, depuis la gauche."""
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(douze_chiffres))
    return str((10 - total % 10) % 10)


def nom_en_13_chiffres(nom: str) -> str:
    """Code EAN-13 valide et stable pour un nom : le même nom donne toujours le même code."""
    # « Mango Loco », « mango loco » et « Mango  Loco » donnent le même code.
    nom_normalise = " ".join(nom.split()).lower()
    grand_nombre = int(hashlib.sha256(nom_normalise.encode("utf-8")).hexdigest(), 16)
    # 2 chiffres de préfixe + 10 chiffres tirés du hash = 12 chiffres, puis la clé.
    douze = PREFIXE + str(grand_nombre % 10**10).zfill(10)
    # Chaîne de caractères et non nombre : un code peut contenir des zéros significatifs.
    return douze + cle_de_controle(douze)


if __name__ == "__main__":
    nom_saisi = input("Entrez le nom à convertir : ")
    print(f"Le code-barres pour '{nom_saisi}' est : {nom_en_13_chiffres(nom_saisi)}")