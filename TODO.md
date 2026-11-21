# StackMonsters — À faire

Idées et tâches à venir, pas encore planifiées. Voir aussi le [tableau de suivi](PROJECT-BOARD.md) et la
[roadmap](ROADMAP.md).

## Wiki

- [ ] **Fusionner deux fiches du Wiki** (propriétaire)
  - **Besoin** : une même canette scannée avec deux codes-barres différents (autre pays, autre format) peut
    finir en deux fiches, si le second code a été ajouté sans « Associer ce code-barres ». Aujourd'hui, aucun
    outil ne permet de réunir ces doublons.
  - **Proposition** : sur la fiche en double, une action « Fusionner avec une autre fiche », réservée à
    `OWNER_EMAIL` : choix de la fiche à garder, aperçu de ce qui va bouger, confirmation.
  - **Effet attendu** :
    - le code principal et les codes supplémentaires du doublon deviennent des codes supplémentaires de la
      fiche gardée (`wiki_codes`) ;
    - les exemplaires des collections passent sur la fiche gardée ; un compte qui possède déjà les deux
      garde une seule ligne, quantités additionnées ;
    - les champs vides de la fiche gardée sont complétés par ceux du doublon, sans rien écraser ; la photo
      du doublon n'est reprise que si la fiche gardée n'en a pas ;
    - signalements et historique de modération rattachés à la fiche gardée ;
    - l'ancien code est noté dans `wiki_exclus` (vers la fiche gardée) pour qu'il ne recrée pas de fiche ;
    - le doublon est supprimé.
  - **Contraintes** : une seule transaction, autorisation vérifiée côté serveur, tests API (dont deux comptes
    et un compte qui possède les deux fiches) et parcours de bout en bout.

## Échanges entre collectionneurs

- [x] **1. Doubles et recherchées** : branche `market` (compteurs anonymes, filtres du Wiki).
- [x] **2. Correspondances automatiques** : branche `messagerie` (notifications, double accord « Échange »,
  messagerie interne anonyme). À suivre : signaler ou bloquer un membre, notifications push.
- [ ] **3. Bourse d'échange** : petites annonces sans argent, liées aux fiches, avec modération.
- [ ] **4. Échange suivi de bout en bout** : proposé → accepté → envoyé → reçu, collections mises à jour,
  réputation.
- [ ] **5. Liste partageable et QR code** : page publique « Mes doubles / Je cherche » (voir issue #14).
