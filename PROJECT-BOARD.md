# StackMonsters — Project board

> Vue de suivi statique dans le dépôt. Pour déplacer une carte, modifier sa section et synchroniser le statut de l'Issue GitHub.
> Le GitHub Project natif n'a pas pu être créé avec les opérations disponibles dans cette connexion.

## Colonnes

### Backlog
Tickets enregistrés, à prioriser ou à planifier.

- [ ] [#1 — Auditer et renouveler les secrets d’environnement](https://github.com/enabeteleazar/StockMonsters/issues/1) · P0 · Sécurité
- [ ] [#2 — Protection contre les créations de comptes abusives](https://github.com/enabeteleazar/StockMonsters/issues/2) · P0 · Sécurité
- [ ] [#3 — Suppression complète d’un compte](https://github.com/enabeteleazar/StockMonsters/issues/3) · P1 · Comptes
- [ ] [#4 — Renforcer la gestion et la révocation des sessions](https://github.com/enabeteleazar/StockMonsters/issues/4) · P1 · Auth
- [ ] [#5 — Enrichir les fiches canettes](https://github.com/enabeteleazar/StockMonsters/issues/5) · P2 · Catalogue
- [ ] [#6 — Gérer plusieurs photos par canette](https://github.com/enabeteleazar/StockMonsters/issues/6) · P2 · Collection
- [ ] [#7 — Ajouter un historique des opérations](https://github.com/enabeteleazar/StockMonsters/issues/7) · P2 · Collection
- [ ] [#9 — Proposer une nouvelle référence au catalogue](https://github.com/enabeteleazar/StockMonsters/issues/9) · P3 · Catalogue
- [ ] [#11 — Améliorer le parcours après lecture du code-barres](https://github.com/enabeteleazar/StockMonsters/issues/11) · P2 · Scan
- [ ] [#12 — Ajouter des statistiques avancées](https://github.com/enabeteleazar/StockMonsters/issues/12) · P4 · Statistiques
- [ ] [#13 — Ajouter badges et niveaux](https://github.com/enabeteleazar/StockMonsters/issues/13) · P4 · Gamification
- [ ] [#14 — Partager sa collection en lecture seule](https://github.com/enabeteleazar/StockMonsters/issues/14) · P4 · Communauté
- [ ] [#15 — Renforcer les tests de bout en bout](https://github.com/enabeteleazar/StockMonsters/issues/15) · P1 · Qualité
- [ ] [#16 — Sauvegarde et restauration vérifiées](https://github.com/enabeteleazar/StockMonsters/issues/16) · P1 · Ops

### À faire

_Aucun ticket déplacé ici pour le moment._

### En cours

_Aucun ticket signalé en cours._

### En test

_Aucun ticket en validation._

### Terminé

- [x] [#8 — Créer un catalogue mondial partagé](https://github.com/enabeteleazar/StockMonsters/issues/8) · P3 · Catalogue
  — le Wiki est la référence commune, les collections en sont les exemplaires. EAN absents (code « 20… » tiré
  du nom) et multiples (codes secondaires) gérés ; un EAN réutilisé selon les marchés reste lié à une seule fiche
  (choix assumé, cas jugé trop rare). Provenance anonyme et signalement des erreurs ajoutés ensuite.
- [x] [#10 — Rechercher dans le catalogue global](https://github.com/enabeteleazar/StockMonsters/issues/10) · P3 · Recherche
  — recherche côté serveur (nom, saveur, pays, gamme, code-barres, sans accents), index trigramme, filtres,
  tri, pagination et suggestions ; ne lit que le catalogue, jamais les collections.

## Conventions

- P0 : à traiter en premier, risque sécurité.
- P1 : fondations de fiabilité et de protection des comptes.
- P2 : expérience de collection et scanner.
- P3 : catalogue mondial.
- P4 : statistiques, progression et communauté.
- Déplacer une carte uniquement lorsque le travail commence ou que les critères d'acceptation sont réellement validés.
- Le statut GitHub Issue (open/closed) reste la source de vérité pour savoir si un ticket est terminé.

Voir aussi la [roadmap produit](ROADMAP.md) et les [Issues GitHub](https://github.com/enabeteleazar/StockMonsters/issues).
