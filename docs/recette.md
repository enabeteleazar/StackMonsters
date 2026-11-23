# Recette StackMonsters

Check-list réutilisable avant et après chaque version. Elle se remplit sur une copie (ticket ou message), pas dans ce fichier.
Ce fichier ne change que si un parcours, une règle ou un piège change.

Règles :
- Jamais de test qui écrit en prod sans l'accord d'Eleazar. En prod, on n'utilise que le compte `test-prod@stackmonsters.fr` (gardé).
- Jamais de code de connexion, de mot de passe ou de donnée personnelle d'un membre dans un ticket ou un message.
- Chaque bug corrigé reçoit un test (e2e de préférence) qui l'empêche de revenir.
- Avis final au chef de projet : **GO**, **GO avec réserves** ou **NO GO**, toujours avec la liste de ce qui n'a **pas** été vérifié.

## 1. Avant la version (branche `release/x.y.z`, révision figée)

Rien ne se modifie sur la branche pendant la recette. Les bases de test sont jetables et ne sont **jamais** la prod.

| Étape | Commande | Attendu |
|---|---|---|
| Tests front | `pnpm test` | tout passe |
| Types | `pnpm typecheck` | aucune erreur |
| Build | `pnpm build` | OK, `git status` reste propre |
| Tests API | `TEST_DATABASE_URL=… .venv/bin/python -m pytest tests` | tout passe |
| e2e (Pixel 7) | `E2E_DATABASE_URL=… pnpm exec playwright test --trace off` | tout passe |

Noter pour chaque ligne : relancé par la QA, ou repris d'un autre (qui, quand, quelle révision).

## 2. Parcours critiques (navigateur mobile émulé sur base locale, puis vrai téléphone)

| # | Parcours | Points à contrôler |
|---|---|---|
| P1 | Connexion | code reçu par e-mail (logo, lien), connexion, Réglages → Version = version seule (« x.y.z · service a.b » = déploiement incomplet ou cache) |
| P2 | Scan | nouvelle canette ; canette déjà possédée → « Doublon ajouté · … × N » ; annulation de l'ajout automatique depuis le Wiki |
| P3 | Possédées / Recherchées | onglets, recherche, panneau Filtres, pastilles des filtres actifs |
| P4 | Wiki | recherche, fiche, badge « Possédée », « Je la cherche » / « Je ne la cherche plus » (absent si la canette est possédée) |
| P5 | Échange à 2 comptes | voir § 4 |
| P6 | Signalement | fiche du Wiki (« Signaler une erreur ») ; membre (« Signaler » dans une conversation ouverte) → conversation fermée ; visible dans l'Administration |
| P7 | Réglages et notifications | partage des doublons coupé → bloc Échanges masqué ; Notifications (iPhone : appli installée uniquement) ; Confidentialité affiche contact@stackmonsters.fr |
| P8 | Administration | bloquer / débloquer ; fiches signalées et proposées ; membres signalés ; message à tous (voir § 5) |
| P9 | Contact | e-mail externe à contact@stackmonsters.fr → Gmail, objet « [Contact] … » |
| P10 | PWA hors ligne | installation, plein écran, collection visible en mode avion, barre du bas stable d'une page à l'autre |

## 3. Cas limites

- Double scan rapide de la même canette : un seul exemplaire de plus par scan, jamais de doublon fantôme.
- Réseau coupé pendant une synchronisation, puis rétabli : pas d'entrée en double dans la collection.
- Même compte sur 2 appareils : modifications visibles des deux côtés ; déconnexion « cet appareil seulement ».
- Champs vides et très longs : notes, motif de signalement, message (1 000 caractères), titre de message à tous (60), texte (1 000).
- Accès à la collection, aux échanges ou aux messages d'un autre membre : refus **côté serveur** (404 pour un échange qui n'est pas le sien, 401 sans connexion, 403 pour l'Administration hors propriétaire).
- API sans connexion : 401/403, jamais 5xx.

## 4. Échange de bout en bout (2 comptes, 2 appareils)

1. B choisit une canette X qu'il **n'a pas** → « Je la cherche ».
2. A a X en 2 exemplaires ou plus. Partage des doublons activé chez A **et** chez B (activé par défaut).
3. B (à l'ouverture, ou dans la minute si l'appli est ouverte) : popup « Un collectionneur a X en double. » → « Échange ».
4. A : popup « Un collectionneur est intéressé par ton double de X. » → « Échange » → la messagerie s'ouvre.
5. Un message de chaque côté : **pastille** sur Échanges, pas de popup (normal).
6. « Valider l'échange » d'un côté → popup « L'autre collectionneur a validé… » de l'autre → valider.
7. Attendu : A X − 1, B X + 1, X sort des Recherchées de B. Rien ne bouge après une seule validation.

Pièges :
- Une paire de comptes n'est **jamais** remise en relation sur la même canette : changer de canette à chaque test.
- Un signalement entre deux membres reste en base **pour toujours**, même traité, et bloque toute mise en relation entre eux. Ne jamais signaler `test-prod` depuis le compte d'Eleazar : utiliser un 3e compte, ou les e2e.

## 5. Notifications système

- Seule source : « Message à tous » (Administration). Les échanges ne déclenchent **pas** de notification système.
- Il part à **tous** les membres (popup une fois par compte, et notification sur les appareils abonnés). Irréversible.
- Les comptes créés après l'envoi ne voient jamais ce message.
- Bloquer un compte supprime ses abonnements aux notifications : le réabonner avant tout test de notification.
- Avant l'envoi : l'Administration doit indiquer « (N appareils abonnés) », N ≥ 1, et ne pas afficher « clés VAPID absentes ».
- Sur iPhone, autoriser d'abord StackMonsters dans les réglages iOS, sinon l'abonnement échoue (« Notifications refusées »).

## 6. Après la sortie (prod, lecture seule, sans compte)

- `main` = merge de la révision figée, tag `vX.Y.Z` présent.
- `/`, `/manifest.webmanifest`, `/sw.js` (version `sm-<hash>`, jamais `sm-dev`), icônes, `robots.txt` : 200.
- Version attendue présente dans le bundle ; `www` → 308 vers `https://stackmonsters.fr/`.
- API sans connexion (`/api/auth/moi`, `/api/health`, `/api/cans`, `/api/echanges`, `/api/admin/comptes`, `/api/stats`) : 401, aucun 5xx.
- En-têtes : CSP, HSTS, X-Frame-Options.
- Émulation iPhone et Android : page d'accueil sans erreur console, pas de défilement horizontal, service worker actif, confidentialité accessible, rechargement hors ligne OK.
- Tests connectés en prod : uniquement avec l'accord d'Eleazar, avec `test-prod`, puis remise en état.

## 7. Fiche de bug

Titre · étapes pour reproduire · résultat attendu · résultat obtenu · appareil et navigateur · version · gravité (bloquant / majeur / mineur) · capture.
Ouvrir une issue GitHub, puis prévenir le chef de projet. Bloquant pendant une sortie : chef de projet **et** Hedy tout de suite.

## Points ouverts

- 0.7.0 : réception réelle d'une notification système jamais vérifiée (envoi du 23/11 : 0 appareil abonné). Prévu : notification de test vers les seuls appareils du propriétaire (0.7.1).
- 0.7.0 : tests API et e2e non relancés par la QA faute de base de test dédiée. Une base jetable pour la QA est à décider avec Eleazar.
