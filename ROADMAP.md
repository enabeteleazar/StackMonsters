# StackMonster — Roadmap

> Roadmap de travail proposée. Les versions sont des étapes de livraison, pas des dates promises.
> Les fonctionnalités déjà présentes dans l'application ne sont pas recréées ici : les tickets ciblent les évolutions et les chantiers de fiabilisation.

## Priorités immédiates — v0.2 · Fiabilisation

Objectif : sécuriser les comptes et les données avant d'élargir le produit.

- [ ] [#1 — Auditer et renouveler les secrets d’environnement](https://github.com/enabeteleazar/StockMonsters/issues/1)
- [ ] [#2 — Protection contre les créations de comptes abusives](https://github.com/enabeteleazar/StockMonsters/issues/2)
- [ ] [#3 — Suppression complète d’un compte](https://github.com/enabeteleazar/StockMonsters/issues/3)
- [ ] [#4 — Renforcer la gestion et la révocation des sessions](https://github.com/enabeteleazar/StockMonsters/issues/4)
- [ ] [#15 — Renforcer les tests de bout en bout](https://github.com/enabeteleazar/StockMonsters/issues/15)
- [ ] [#16 — Sauvegarde et restauration vérifiées](https://github.com/enabeteleazar/StockMonsters/issues/16)

**Sortie attendue :** comptes mieux protégés, tests des parcours critiques et procédure de reprise documentée.

## v0.3 · Fiches et collection enrichies

Objectif : rendre chaque canette mieux documentée et améliorer les gestes de collection.

- [ ] [#5 — Enrichir les fiches (pays, parfum, gamme)](https://github.com/enabeteleazar/StockMonsters/issues/5)
- [ ] [#6 — Gérer plusieurs photos par canette](https://github.com/enabeteleazar/StockMonsters/issues/6)
- [ ] [#7 — Ajouter un historique des opérations](https://github.com/enabeteleazar/StockMonsters/issues/7)
- [ ] [#11 — Améliorer le parcours après lecture du code-barres](https://github.com/enabeteleazar/StockMonsters/issues/11)

**Dépendance :** valider le modèle de données des fiches avant d'étendre les formulaires et l'historique.

## v0.4 · Catalogue mondial

Objectif : séparer les références Monster communes des exemplaires détenus par chaque collectionneur.

- [ ] [#8 — Créer un catalogue mondial partagé](https://github.com/enabeteleazar/StockMonsters/issues/8)
- [ ] [#9 — Permettre de proposer une nouvelle référence](https://github.com/enabeteleazar/StockMonsters/issues/9)
- [ ] [#10 — Rechercher dans le catalogue global](https://github.com/enabeteleazar/StockMonsters/issues/10)

**Dépendance :** le modèle de référence partagé (#8) précède la contribution (#9) et la recherche globale (#10). Les données personnelles de collection doivent rester isolées.

## v0.5 · Progression et statistiques

Objectif : donner une meilleure lecture de sa collection et encourager la découverte.

- [ ] [#12 — Ajouter des statistiques avancées](https://github.com/enabeteleazar/StockMonsters/issues/12)
- [ ] [#13 — Ajouter badges et niveaux](https://github.com/enabeteleazar/StockMonsters/issues/13)

## v0.6 · Communauté

Objectif : permettre de montrer sa collection sans exposer ses informations privées.

- [ ] [#14 — Partager sa collection en lecture seule](https://github.com/enabeteleazar/StockMonsters/issues/14)

## v1.0 · Version officielle

La version 1.0 sera envisagée lorsque les étapes précédentes seront stabilisées, que les parcours principaux seront couverts par les tests et que les sauvegardes/restaurations auront été vérifiées.

## Règles de suivi

- Chaque évolution doit avoir des critères d'acceptation et des tests adaptés.
- Ne pas publier de données personnelles dans le catalogue partagé ou les pages publiques.
- Préserver l'isolation des collections entre utilisateurs.
- Les numéros de version et l'ordre des étapes pourront évoluer selon les retours et les contraintes techniques.
- Les tâches sont suivies dans les [GitHub Issues](https://github.com/enabeteleazar/StockMonsters/issues).


## Tableau de suivi (workflow Kanban)

En attendant la création d'un GitHub Project, utiliser ces statuts comme colonnes du tableau :

| Statut | Signification |
|---|---|
| Backlog | Idée validée, pas encore planifiée |
| À faire | Sélectionnée pour le prochain cycle |
| En cours | Développement commencé |
| En test | Implémentation terminée, validation en cours |
| Terminé | Critères d'acceptation vérifiés et ticket fermé |

**Règle de flux :** limiter le nombre de tickets « En cours » à 1 ou 2 pour garder le projet focalisé. Un ticket ne passe à « Terminé » qu'après validation de ses critères d'acceptation.

## Ordre de priorité conseillé

1. **P0 — Sécurité immédiate :** #1 (secrets), puis #2 (abus d'inscription).
2. **P1 — Fiabilité et droits des utilisateurs :** #3, #4, #15 et #16.
3. **P2 — Expérience collection :** #5, #6, #7 et #11.
4. **P3 — Catalogue partagé :** #8, puis #9 et #10.
5. **P4 — Engagement et partage :** #12, #13 et #14.

## Jalons de livraison proposés

| Jalon | Tickets | Objectif |
|---|---|---|
| v0.2.0 — Consolidation | #1, #2, #3, #4, #15, #16 | Sécurité, comptes et fiabilité |
| v0.3.0 — Collection enrichie | #5, #6, #7, #11 | Fiches, photos, historique et scan |
| v0.4.0 — Catalogue mondial | #8, #9, #10 | Référentiel commun et contribution |
| v0.5.0 — Progression | #12, #13 | Statistiques, badges et niveaux |
| v0.6.0 — Communauté | #14 | Partage public maîtrisé |
| v1.0.0 — Version officielle | Stabilisation des jalons précédents | Qualité, sécurité et expérience cohérentes |

Ces jalons sont des objectifs de regroupement. Ils ne sont pas des milestones GitHub créés automatiquement.
