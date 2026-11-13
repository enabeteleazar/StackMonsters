# STACKMONSTERS — Roadmap officielle

> Feuille de route produit proposée pour STACKMONSTERS. Les versions représentent des étapes de livraison et non des dates garanties. L'ordre pourra évoluer selon les retours, les contraintes techniques et les priorités de sécurité.

## Vision du produit

Construire une application fiable pour inventorier, organiser et enrichir une collection de canettes Monster Energy, avec un catalogue de références partagé et, à terme, des fonctions de progression et de partage communautaire.

Les fonctionnalités déjà présentes dans l'application ne sont pas recréées dans cette roadmap. Les tickets ci-dessous portent sur les évolutions et les chantiers de fiabilisation identifiés.

## Synthèse des priorités

| Priorité | Thème | Tickets |
|---|---|---|
| **P0 — Critique** | Sécurité immédiate | #1, #2 |
| **P1 — Haute** | Fiabilité, comptes et qualité | #3, #4, #15, #16 |
| **P2 — Moyenne** | Expérience de collection | #5, #6, #7, #11 |
| **P3 — Basse** | Catalogue partagé | #8, #9, #10 |
| **P4 — Future** | Progression et communauté | #12, #13, #14 |

## v0.2.0 — Consolidation et sécurité

**Objectif :** sécuriser les comptes et les données, fiabiliser les parcours critiques et préparer une exploitation durable.

- [ ] **P0 · #1 — Auditer et renouveler les secrets d'environnement**  
  Vérifier les secrets exposés ou mal configurés, les renouveler si nécessaire, contrôler leur présence dans l'historique Git et fiabiliser la configuration des environnements.
- [ ] **P0 · #2 — Ajouter une protection contre les créations de comptes abusives**  
  Mettre en place des protections contre l'inscription automatisée et les abus, avec des limites adaptées et une expérience utilisateur compréhensible.
- [ ] **P1 · #3 — Permettre la suppression complète d'un compte**  
  Donner à l'utilisateur un moyen sûr de supprimer son compte et les données personnelles associées, conformément aux règles de conservation définies.
- [ ] **P1 · #4 — Renforcer la gestion et la révocation des sessions**  
  Améliorer le contrôle des sessions, leur expiration et leur révocation, notamment en cas de déconnexion ou de suppression de compte.
- [ ] **P1 · #15 — Renforcer les tests de bout en bout**  
  Couvrir les parcours essentiels : authentification, gestion de la collection, recherche et opérations sensibles.
- [ ] **P1 · #16 — Mettre en place une sauvegarde et une restauration vérifiées**  
  Documenter les sauvegardes, tester la restauration et définir une procédure de reprise vérifiable.

**Critères de sortie :** les secrets sont maîtrisés, les parcours sensibles sont testés, les comptes disposent de contrôles renforcés et une restauration a été exécutée avec succès.

## v0.3.0 — Fiches et collection enrichies

**Objectif :** améliorer la qualité des informations sur chaque canette et les outils de gestion de collection.

- [ ] **P2 · #5 — Enrichir les fiches canettes (pays, parfum, gamme)**  
  Ajouter des informations structurées pour mieux décrire et différencier les références.
- [ ] **P2 · #6 — Gérer plusieurs photos par canette**  
  Autoriser plusieurs visuels pour documenter une canette sous différents angles ou dans différents états.
- [ ] **P2 · #7 — Ajouter un historique des opérations**  
  Conserver une trace utile des changements apportés à la collection, avec les informations nécessaires pour comprendre son évolution.
- [ ] **P2 · #11 — Améliorer le parcours après lecture du code-barres**  
  Rendre le parcours de scan plus clair, notamment lorsque le code-barres correspond à une référence connue ou inconnue.

**Dépendance :** stabiliser le modèle de données des fiches avant d'étendre les formulaires et l'historique.

**Critères de sortie :** les fiches sont plus complètes, les photos sont gérées correctement et le scan conduit à une action claire.

## v0.4.0 — Catalogue mondial partagé

**Objectif :** construire un référentiel commun de références Monster, distinct des exemplaires détenus par chaque collectionneur.

- [ ] **P3 · #8 — Créer un catalogue mondial partagé de références**  
  Définir un modèle de référence commun, indépendant des collections personnelles.
- [ ] **P3 · #9 — Permettre de proposer une nouvelle référence au catalogue**  
  Donner aux utilisateurs un moyen de contribuer au catalogue avec un processus de validation adapté.
- [ ] **P3 · #10 — Rechercher dans le catalogue global**  
  Permettre de retrouver une référence dans le catalogue partagé et de l'utiliser pour enrichir sa collection.

**Dépendance :** le modèle du catalogue (#8) doit être défini avant la contribution (#9) et la recherche globale (#10).

**Point de vigilance :** les données personnelles des collections doivent rester isolées du catalogue partagé.

**Critères de sortie :** le catalogue possède une structure commune, les contributions sont contrôlées et la recherche globale est exploitable.

## v0.5.0 — Statistiques et progression

**Objectif :** mieux visualiser sa collection et encourager sa découverte.

- [ ] **P4 · #12 — Ajouter des statistiques avancées de collection**  
  Fournir des indicateurs utiles sur la collection et son évolution.
- [ ] **P4 · #13 — Ajouter des badges et des niveaux de collection**  
  Introduire une progression ludique basée sur des objectifs compréhensibles et vérifiables.

**Critères de sortie :** les statistiques sont cohérentes avec les données réelles et les règles de progression sont documentées.

## v0.6.0 — Communauté et partage

**Objectif :** permettre aux collectionneurs de présenter leur collection sans exposer leurs informations privées.

- [ ] **P4 · #14 — Partager sa collection en lecture seule**  
  Créer une page publique partageable, avec un contrôle explicite des informations visibles et sans possibilité de modifier la collection.

**Critères de sortie :** le partage est désactivable, les informations privées restent protégées et la page publique est strictement en lecture seule.

## v1.0.0 — Version officielle

La version 1.0 sera envisagée lorsque les étapes précédentes auront été stabilisées.

Conditions générales de passage en v1.0 :

- Les parcours principaux sont fiables et couverts par des tests adaptés.
- La gestion des comptes, des sessions et des données est sécurisée.
- Les sauvegardes et restaurations ont été vérifiées.
- Le catalogue partagé respecte l'isolation des données personnelles.
- Les fonctionnalités publiques et communautaires respectent les règles de confidentialité.
- La documentation et les procédures d'exploitation sont à jour.

## Ordre de priorité recommandé

1. **P0 — Sécurité immédiate :** #1, puis #2.
2. **P1 — Fiabilité et droits des utilisateurs :** #3, #4, #15 et #16.
3. **P2 — Expérience de collection :** #5, #6, #7 et #11.
4. **P3 — Catalogue partagé :** #8, puis #9 et #10.
5. **P4 — Progression et communauté :** #12, #13 et #14.

## Workflow de suivi

Les tickets sont suivis dans les [GitHub Issues](https://github.com/enabeteleazar/StockMonsters/issues).

| Statut | Signification |
|---|---|
| Backlog | Idée validée, pas encore planifiée |
| À faire | Sélectionnée pour le prochain cycle |
| En cours | Développement commencé |
| En test | Implémentation terminée, validation en cours |
| Terminé | Critères d'acceptation vérifiés et ticket fermé |

**Règle de flux :** limiter le nombre de tickets « En cours » à un ou deux. Un ticket ne passe à « Terminé » qu'après validation de ses critères d'acceptation.

## Règles de gestion de la roadmap

- Chaque évolution doit être suivie par une issue GitHub avec une description et des critères d'acceptation.
- Les priorités indiquent l'ordre recommandé, pas une date de livraison.
- Les versions sont des jalons de regroupement proposés ; elles ne constituent pas des milestones GitHub créés automatiquement.
- La sécurité, la confidentialité et l'isolation des collections restent des exigences transversales.
- La roadmap peut être révisée lorsque de nouveaux besoins ou risques sont identifiés.

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

## Liens utiles

- [Dépôt STACKMONSTERS](https://github.com/enabeteleazar/StockMonsters)
- [Toutes les issues](https://github.com/enabeteleazar/StockMonsters/issues)
- [Tableau de suivi](https://github.com/enabeteleazar/StockMonsters/blob/develop/PROJECT-BOARD.md)
