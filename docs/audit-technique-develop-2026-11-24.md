# Audit technique StackMonsters — branche develop

- **Date :** 24 novembre 2026
- **Branche auditée :** `develop`
- **Révision examinée :** `e78571f9018e15f0539a3d4a2cd8c449ef925797`
- **Nature :** revue statique ciblée du code, de la configuration, de la documentation, des tests et des issues GitHub.
- **Limite :** aucun test n'a été exécuté contre une base ou un navigateur pendant cet audit. Les scénarios de risque ci-dessous doivent être confirmés par les tests de régression indiqués.

## Synthèse exécutive

StackMonsters possède des bases techniques solides pour un projet de cette taille : front React/TypeScript, API FastAPI, PostgreSQL, migrations numérotées, verrou de migration, tests API, tests Playwright et CI GitHub Actions.

Le projet entre cependant dans une phase où la priorité doit être la fiabilité et la confidentialité, avant l'ajout de nouvelles fonctionnalités communautaires.

**Décision recommandée : pas de nouvelle fonctionnalité majeure avant traitement du cache privé PWA et sécurisation du transfert d'échange.** Préparer les changements d'authentification et de sauvegarde en parallèle.

## Points positifs vérifiés

1. **Données :** séparation du catalogue partagé `wiki` et des lignes privées `collection`, avec clé par utilisateur et code.
2. **Migrations :** versions numérotées, transaction unique, verrou PostgreSQL consultatif et contrôle de version du schéma. Les migrations sont exécutées par `scripts/migrer_schema.py`, pas implicitement au démarrage de l'API en production.
3. **Authentification :** codes temporaires, limites anti-abus, jetons aléatoires de 256 bits, empreintes des jetons en base, expiration glissante/plafond de durée et rotation.
4. **Autorisations :** les routes protégées dépendent de l'utilisateur authentifié ; les opérations d'administration vérifient le compte propriétaire.
5. **Tests/CI :** `.github/workflows/tests.yml` lance tests front, tests API sur PostgreSQL, Playwright et build. `playwright.config.ts` exige une base E2E dédiée et appelle un script de remise à zéro protégé.
6. **Sécurité navigateur :** CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy et Permissions-Policy sont configurés dans `vercel.json`.

## Constats prioritaires

### P0 — Cache privé de la collection non isolé explicitement

**Fichiers :** `public/sw.js`, `api/index.py`, `src/api.ts`.

Le service worker place `GET /api/cans` dans le cache partagé `sm-donnees`, et utilise la même URL comme clé de cache. La réponse de liste examinée ne définit pas `Vary: Authorization` ni de politique explicite `Cache-Control`. À l'inverse, la route des photos de collection définit déjà `Vary: Authorization`.

Le Cache API utilise les en-têtes déclarés par `Vary` pour distinguer les variantes d'une même URL. Sans isolation, deux sessions qui utilisent le même profil navigateur peuvent potentiellement partager la même entrée de liste lors du fallback hors ligne.

**Ticket :** [#38 — Isoler le cache hors ligne de /api/cans entre comptes](https://github.com/enabeteleazar/StackMonsters/issues/38)

**Validation attendue :** test E2E avec deux comptes dans le même navigateur, consultation en ligne sous A, changement de compte vers B, passage hors ligne et vérification qu'aucune donnée de A n'est affichée. Tester aussi expiration, déconnexion et reconnexion.

### P1 — Transfert d'échange concurrent non idempotent

**Fichier :** `api/index.py`, route `POST /echanges/{echange_id}/valider`.

La route lit la ligne d'échange sans verrou explicite, vérifie `statut == 'acceptee'`, puis réalise le transfert lorsque les deux validations sont vraies. Le transfert et le passage à `terminee` sont dans une transaction, ce qui est positif, mais le contrôle initial n'est pas sérialisé par verrou de ligne.

Deux appels concurrents répétés peuvent lire le même état `acceptee` avant que l'un des deux ait finalisé la transaction et peuvent tous deux tenter le transfert.

**Ticket :** [#39 — Rendre la validation d'un échange atomique et idempotente](https://github.com/enabeteleazar/StackMonsters/issues/39)

**Validation attendue :** verrouiller la ligne `echanges` avec `SELECT ... FOR UPDATE`, vérifier le statut après verrouillage, ne transférer qu'une fois, protéger le décrément par une condition SQL et tester deux requêtes simultanées alors que l'autre participant a déjà validé.

### P1 — Jeton de session conservé dans localStorage

**Fichiers :** `src/api.ts`, `src/config.ts`, README « Sessions ».

Le jeton Bearer est conservé dans `localStorage`. Le README décrit déjà une cible cookie `HttpOnly`, `Secure`, `SameSite` et une protection CSRF ; l'issue #4 a couvert l'étude/documentation, mais le front et l'API utilisent encore le modèle Bearer.

**Ticket :** [#40 — Implémenter la migration des sessions vers un cookie HttpOnly](https://github.com/enabeteleazar/StackMonsters/issues/40)

**Validation attendue :** migration sans reconnexion lorsque possible, suppression du secret côté JavaScript, protections CSRF, tests de rotation/révocation/déconnexion et vérification PWA iOS/hors ligne.

## Chantiers déjà suivis — ne pas dupliquer

- [#1 — Auditer et renouveler les secrets d'environnement](https://github.com/enabeteleazar/StackMonsters/issues/1) : reste à vérifier le dépôt et son historique, les artefacts et les logs ; renouveler les identifiants qui auraient pu être exposés. Cet audit statique n'a pas constitué un scan exhaustif de secrets.
- [#16 — Mettre en place sauvegarde et restauration vérifiées](https://github.com/enabeteleazar/StackMonsters/issues/16) : définir RPO/RTO, rétention, chiffrement et copie indépendante ; effectuer une restauration réelle et documentée.
- [#4 — Renforcer la gestion et la révocation des sessions](https://github.com/enabeteleazar/StackMonsters/issues/4) : conception de la cible documentée ; l'implémentation est désormais suivie dans #40.
- [#36] : instabilité E2E déjà documentée ; le workflow CI et les traces Playwright sont en place.
- [#37] : mesurer les performances de l'accueil/connexion sur un téléphone modeste.

## Observations complémentaires

- Les migrations sont nombreuses (22 versions actuellement décrites dans `api/index.py`). Conserver la règle : ne jamais modifier une migration livrée ; ajouter une nouvelle version et la tester sur une copie de base.
- La recette documente déjà les parcours essentiels, notamment l'échange à deux comptes, les accès inter-comptes, l'administration et le mode hors ligne. Il faut y ajouter les cas de concurrence et d'isolation de cache des tickets #38 et #39.
- Les tests Playwright réduisent les animations et utilisent un profil Pixel 7. Cela stabilise les tests, mais ne remplace pas une mesure réelle sur appareil mobile modeste.
- La CI est configurée pour `main` et `develop`, avec PostgreSQL 16, tests front, tests API, E2E Chromium et build. La présence du workflow ne prouve pas à elle seule que le dernier commit est vert : vérifier le statut du run correspondant à chaque PR/merge.

## Plan d'action recommandé

| Ordre | Action | Responsable proposé | Dépendance |
|---|---|---|---|
| 1 | Traiter #38 : isolation du cache privé | Frontend + QA | Aucune |
| 2 | Traiter #39 : transfert atomique/idempotent | Backend + QA | Aucune |
| 3 | Exécuter #1 : audit secrets et rotation si nécessaire | DevOps + propriétaire | Accès fournisseurs |
| 4 | Exécuter #16 : sauvegarde et restauration | DevOps + propriétaire | Accès base et stockage |
| 5 | Implémenter #40 : cookie HttpOnly + CSRF | Backend + Frontend + QA | Conception #4 |
| 6 | Rejouer la recette complète sur révision figée | QA | 1 à 5 |

## Règles de livraison proposées

- Aucun agent ne pousse directement en production.
- Un agent propriétaire par ticket ; les autres interviennent en revue.
- Une base isolée par suite de test ; aucune suite destructive sur la production.
- Toute correction de bug critique inclut un test de régression.
- Toute livraison est bloquée si tests API, E2E, typecheck ou build échouent.
- Le rapport de recette indique explicitement ce qui a été exécuté, ce qui a été relu et ce qui reste non vérifié.

## Conclusion

Le projet n'a pas besoin d'être réécrit. Ses fondations sont cohérentes et plusieurs garde-fous sont déjà présents. Le meilleur investissement à court terme est de traiter les risques de confidentialité hors ligne et d'intégrité des échanges, puis de terminer le durcissement des sessions et la stratégie de reprise après incident.
