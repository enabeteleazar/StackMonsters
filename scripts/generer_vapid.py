"""Génère les clés des notifications (Web Push, VAPID) et les ajoute à .env.local, sans jamais les afficher.

    .venv/bin/python scripts/generer_vapid.py

Ne fait rien si .env.local contient déjà VAPID_PRIVATE_KEY : changer de clés désabonne tous les appareils.
Les trois variables sont ensuite à copier dans Vercel (Production et Preview) :
    vercel env add VAPID_PUBLIC_KEY      (valeur : celle de .env.local)
    vercel env add VAPID_PRIVATE_KEY     (secrète : jamais dans git ni dans une variable VITE_/NEXT_PUBLIC_)
    vercel env add VAPID_SUBJECT         (mailto:contact@mail.stackmonsters.fr)
"""

import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

FICHIER = Path(__file__).resolve().parent.parent / ".env.local"


def b64(octets: bytes) -> str:
    return base64.urlsafe_b64encode(octets).rstrip(b"=").decode()


def main() -> None:
    contenu = FICHIER.read_text() if FICHIER.exists() else ""
    if "VAPID_PRIVATE_KEY=" in contenu:
        print(f"{FICHIER.name} contient déjà des clés VAPID : rien n'est changé.")
        return
    cle = ec.generate_private_key(ec.SECP256R1())
    privee = b64(cle.private_numbers().private_value.to_bytes(32, "big"))
    publique = b64(cle.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    ajout = (
        ("" if contenu.endswith("\n") or not contenu else "\n")
        + "# Notifications (Web Push) : à copier aussi dans les variables d'environnement Vercel.\n"
        + f"VAPID_PUBLIC_KEY={publique}\nVAPID_PRIVATE_KEY={privee}\nVAPID_SUBJECT=mailto:contact@mail.stackmonsters.fr\n"
    )
    FICHIER.write_text(contenu + ajout)
    FICHIER.chmod(0o600)
    print(f"Clés VAPID ajoutées à {FICHIER.name} (non affichées). À copier dans Vercel : voir l'en-tête de ce script.")


if __name__ == "__main__":
    main()
