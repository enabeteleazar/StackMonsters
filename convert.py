import hashlib

def nom_en_13_chiffres(nom):
    # Crée un hash unique basé sur le nom
    hash_object = hashlib.sha256(nom.encode('utf-8'))
    hash_hex = hash_object.hexdigest()
    
    # Convertit le hash hexadécimal en un grand nombre décimal
    grand_nombre = int(hash_hex, 16)
    
    # Réduit le nombre pour obtenir strictement 13 chiffres
    chiffre_13 = (grand_nombre % 9000000000000) + 1000000000000
    return chiffre_13

# Demande à l'utilisateur d'entrer un nom
nom_saisi = input("Entrez le nom à convertir : ")

# Calcule et affiche le résultat
resultat = nom_en_13_chiffres(nom_saisi)
print(f"La série de 13 chiffres pour '{nom_saisi}' est : {resultat}")
