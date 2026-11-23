# StackMonsters

PWA de collection de canettes : scan du code-barres, fiche, compteur, photo.
Front React + TypeScript (Vite), API FastAPI (`api/index.py`), Postgres (Neon), Vercel.

## Suivi du projet
- [Roadmap produit](ROADMAP.md)
- [Tableau de suivi des tickets](PROJECT-BOARD.md)
- [Issues GitHub](https://github.com/enabeteleazar/StockMonsters/issues)

## Comptes
Connexion par **e-mail + code à 6 chiffres** (valable 10 min, 5 essais) ; un compte se crée à la
première vérification réussie. Les limites anti-abus sont détaillées plus bas. Pas de mot de passe. Sessions : voir plus bas.
La page d'accueil publique présente le service ; la collection privée n'est affichée qu'après
validation de la session par l'API.
Chaque utilisateur ne voit que sa collection (table `collection`, clé `user_id` + `ean`).

### Sessions
Modèle actuel (issue #4) : jeton aléatoire de 256 bits gardé dans `localStorage` (clé historique
`canstack-jeton`) et envoyé en `Authorization: Bearer`. La base ne garde que son empreinte SHA-256
(table `sessions` : `cree` = connexion, `emis` = émission du jeton, `remplacee`, `expire`).

| Règle | Valeur |
| --- | --- |
| Inactivité | expire après 30 jours sans utilisation ; chaque usage repousse l'échéance (réécrite au plus une fois par heure) |
| Durée maximale | 90 jours après la connexion, même en usage continu : un nouveau code est alors demandé |
| Rotation | `POST /api/auth/renouveler`, appelé à l'ouverture de l'application et à chaque retour au premier plan : au plus une fois par jour, un nouveau jeton remplace l'ancien (même date de connexion) |
| Délai de grâce | l'ancien jeton reste valable 10 minutes après son remplacement (requêtes en vol, autre onglet), sans être prolongé ni renouvelé |
| Déconnexion | « Se déconnecter » (`POST /api/auth/deconnexion`) : cet appareil seulement, cache hors ligne vidé |
| Révocation | `POST /api/auth/deconnexion-partout` (bouton retiré des Réglages, route conservée) : toutes les sessions du compte, jetons renouvelés compris |

Migration 12 : ajoute `cree`, `emis` et `remplacee`. Les sessions existantes sont datées de leur connexion
supposée (échéance - 30 jours) et gardent leur échéance : personne n'est déconnecté par la mise à jour, et
le plafond de 90 jours court à partir de cette date.

**Cible : cookie `HttpOnly` (prévue après la release du 16 novembre 2026).** Le jeton ne serait plus lisible
par JavaScript : une faille XSS ne pourrait plus le voler.
- Cookie `__Host-sm_session` : `HttpOnly; Secure; SameSite=Strict; Path=/`, durée calée sur l'échéance de
  la session, renvoyé à chaque prolongation et rotation (la rotation devient transparente pour le front).
  Possible sans configuration CORS : le site et l'API sont sur la même origine (`/api`, réécriture Vercel ;
  proxy Vite en développement).
- CSRF : `SameSite=Strict`, plus, sur toute requête qui modifie (POST, PUT, PATCH, DELETE), contrôle de
  l'en-tête `Origin` (même origine exigée) et d'un en-tête `X-StackMonsters: 1` que les formulaires d'un
  autre site ne peuvent pas poser.
- Migration sans reconnexion : pendant une période de transition, l'API accepte encore le `Bearer`. Au
  démarrage, le front qui trouve un ancien jeton appelle une route d'échange qui révoque ce jeton et pose
  le cookie (même date de connexion), puis efface `localStorage`.
- PWA : le front ne voit plus le jeton ; il garde dans `localStorage` un simple indicateur « session
  ouverte » (aucun secret) pour démarrer hors ligne et choisir l'écran d'accueil. Le service worker
  ne change pas : les requêtes `/api` de même origine emportent le cookie, et la liste mise en cache reste
  lisible hors ligne ; la déconnexion continue de vider ce cache. `GET /api/auth/moi` reste la seule
  vérification de session au démarrage.
- Sur iOS, une PWA installée a son propre stockage : la session y est déjà séparée de Safari, cookie ou
  non ; aucune différence pour l'utilisateur.

### Limites anti-abus
Toutes appliquées par l'API (fenêtres fixes, table `limites_ip` : empreintes HMAC, jamais l'IP en clair,
purgées après 24 h). Au-delà : réponse `429` avec `Retry-After` (secondes avant de pouvoir réessayer).

| Limite | Seuil | Fenêtre |
| --- | --- | --- |
| Demandes de code par adresse e-mail | 5 | 1 h |
| Essais par code | 5 | durée du code (10 min) |
| Demandes de code par IP | 20 / 60 (`SM_DEMANDES_MAX_IP`, `SM_DEMANDES_MAX_IP_JOUR`) | 1 h / 24 h |
| Vérifications de code par IP | 60 | 1 h |
| Nouveaux comptes par IP | 5 (`SM_COMPTES_MAX_IP_JOUR`) | 24 h |
| Nouveaux comptes, tous visiteurs | 30 (`SM_COMPTES_MAX_HEURE`) | 1 h |
| Demandes de code, tous visiteurs | 300 (`SM_DEMANDES_MAX_HEURE`) | 1 h |
| Signalements / propositions au Wiki par IP | 20 / 30 | 1 h |

Une IPv6 compte pour son /64. Les réponses ne révèlent pas si une adresse a déjà un compte : la demande
de code répond toujours `{"ok": true}` et ses limites ne dépendent pas de l'existence du compte. Les limites
de création ne s'appliquent qu'après un code valide (seul le titulaire de l'adresse l'apprend, `429`
« inscriptions limitées ») et ne bloquent jamais la connexion d'un membre existant ; un refus ne consomme
pas le code, utilisable depuis une autre IP ou plus tard tant qu'il n'a pas expiré.

**Débloquer** (membre légitime bloqué, pic d'inscriptions attendu) :
- attendre la fin de la fenêtre (`Retry-After`, message affiché à l'écran) ;
- ou effacer les compteurs avec `scripts/debloquer.py`, lancé avec la `DATABASE_URL` **et** le
  `SESSION_SECRET` de l'environnement visé (les clés sont des HMAC). Sans `--appliquer`, simple aperçu :
  ```bash
  python scripts/debloquer.py --ip 203.0.113.7           # toutes les limites de cette IP
  python scripts/debloquer.py --email membre@exemple.fr  # ses demandes et essais de code
  python scripts/debloquer.py --inscriptions --demandes --appliquer   # limites globales
  ```
  Le script n'efface que des compteurs et des codes, jamais un compte ;
- ou relever un seuil dans Vercel (`SM_DEMANDES_MAX_IP`, `SM_DEMANDES_MAX_IP_JOUR`, `SM_COMPTES_MAX_IP_JOUR`,
  `SM_COMPTES_MAX_HEURE`, `SM_DEMANDES_MAX_HEURE`),
  puis redéployer.
  Les autres seuils sont des constantes de `api/index.py`.

### Suppression du compte
Réglages → « Supprimer mon compte » (membres seulement, jamais le compte propriétaire ; réaffiché en 0.7.1, #3) ouvre un panneau qui détaille les conséquences ; il faut y saisir
l'adresse du compte. L'API (`DELETE /api/auth/compte`, corps `{"confirmation": "<adresse>"}`) vérifie elle
aussi cette adresse (422 sinon) et refuse le compte `OWNER_EMAIL` (403). Un membre visé par un signalement
**non traité** (Administration → Membres) reçoit 409 avec un message qui l'invite à écrire à l'adresse de contact :
la suppression effacerait le signalement et la conversation avant l'examen (décision d'Eleazar, 23/11 ; politique
de confidentialité à jour). Une fois le signalement traité, la suppression redevient possible. Effacés immédiatement, dans une
transaction : le compte, la collection (notes et photos comprises), toutes les sessions (tous les appareils)
et les codes de connexion en cours ; le front vide ensuite la copie hors ligne de l'appareil.
Le Wiki n'est pas touché : ses fiches, photos données, propositions et signalements n'ont jamais été liés
à un compte (aucun auteur enregistré), ils restent donc, anonymes. Ne sont pas non plus liés au compte : les
compteurs anti-abus (empreintes d'IP, 24 h) et les empreintes d'IP des connexions uniques (13 mois).
Une nouvelle inscription avec la même adresse repart de zéro.

### Invitation à installer l'appli
Juste après la première connexion sur un téléphone ou une tablette, une fenêtre invite à installer l'appli
(`src/installation.ts`, `InvitationInstallation.tsx`), une seule fois par appareil (`localStorage`,
`sm_invitation_installation`) et jamais si l'appli est déjà ouverte depuis l'écran d'accueil. Android : bouton
« Installer » quand le navigateur le permet (`beforeinstallprompt`), sinon le chemin par son menu. iOS : aucune
API, la fenêtre montre le geste Partager → « Sur l'écran d'accueil » → « Ajouter ».

## Collection
- Après un scan (ou un code saisi à la main) : canette déjà possédée → un exemplaire est ajouté d'office et une notification « Doublon ajouté · nom × N » le dit (sans réseau : fiche miniature et « +1 ») ;
  présente dans le Wiki → ajout immédiat, choix rapide de l'état, ajout annulable ; inconnue → invitation à
  créer la fiche (nom et photo). Le nom rejoint le Wiki sans écraser une valeur existante ; la photo reste
  dans la collection. Si le nom saisi correspond à une fiche du Wiki qui n'a qu'un code interne (préfixe `20`,
  voir `convert.py`), l'utilisateur peut lui associer le code scanné (`POST /api/wiki/{ean}/code-barres`) : la
  fiche et les collections prennent le vrai code, l'ancien n'est plus recréé. Si la fiche a déjà un vrai code, le
  code scanné devient un **code supplémentaire** (table `wiki_codes`, autre pays ou autre format) : le scanner
  retrouve la fiche, sans doublon. Le propriétaire retire un code associé par erreur depuis la fiche.
  Les codes-barres ne sont affichés dans les fiches du Wiki que pour `OWNER_EMAIL` (l'application les reçoit
  quand même : ils servent à reconnaître une canette scannée).
  La correspondance des noms se fait mot par mot, sans tenir compte de « Monster », « Energy » ni du volume.
- Codes acceptés à la création : EAN-13, EAN-8, UPC-A et UPC-E, clé de contrôle vérifiée (client et serveur).
  Un UPC-A est enregistré sur 13 chiffres (`0` en tête) pour éviter les doublons, un UPC-E est développé par
  le scanner. Une fiche déjà en base reste modifiable même si son code est ancien.
- `GET /api/cans` ne transporte pas les photos, seulement `photo_version` ; l'image se charge à la demande
  (`GET /api/cans/{ean}/photo`). Un `PUT /api/cans` sans champ `photo` conserve la photo existante.

## Échanges, étape 1 : doubles et recherchées
Branche `market` (idée 1 des échanges entre collectionneurs ; suite dans le [tableau GitHub](https://github.com/users/enabeteleazar/projects/6), tickets #26, #28, #29). Aucun contact entre membres :
seulement des compteurs anonymes.
- **Doubles** : toute canette de la collection en 2 exemplaires ou plus compte comme double, sans rien
  proposer canette par canette ; seul l'interrupteur des Réglages décide (voir plus bas). La colonne
  `collection.echange` (migration 16) n'est plus lue et la route `PATCH /api/cans/{ean}/echange` a été retirée.
- **Recherchées** : sur une fiche du Wiki qu'on n'a pas, « Je la cherche » (`POST` / `DELETE
  /api/wiki/{ean}/recherche`, table `recherches`). Refusé (409) si la canette est déjà dans la collection ;
  retirée automatiquement quand on l'ajoute.
- **Affichage** : chaque fiche du Wiki porte `doubles` (collectionneurs qui en ont des doubles, partage
  activé, codes secondaires compris) et `recherches` (collectionneurs qui la cherchent), plus `je_cherche` et `je_possede` pour le compte
  connecté ; la fiche de collection montre combien la cherchent. Badge « Tu la cherches » sur les cartes du Wiki (plus de badge des doubles), filtres
  « Je cherche » (`je_cherche=true`) et « Doubles dispo » (`doubles=true`) dans le panneau Filtres (groupe
  « Échanges »), affichés ensuite en pastilles sous la recherche. Bloc « Échanges » : sur la fiche du Wiki, seulement
  le bouton « Je la cherche » (aucun compteur, absent si la canette est déjà possédée) ; sur la fiche de collection,
  les doubles partagés et le nombre de collectionneurs qui la cherchent.
- **Réglages** (ordre : Partage des doublons, Confidentialité, mesure d'audience, espace, Vider ma collection
  — propriétaire seulement —, Se déconnecter) : interrupteur « Partage des doublons » (`PATCH /api/auth/partage-doubles`, colonne
  `users.partage_doubles`, activé par défaut ; `GET /api/auth/moi` le renvoie). Coupé, aucun des doubles du compte
  n'est compté ni filtré, et le bloc « Échanges » est masqué sur les fiches (collection et Wiki ; les fiches
  du Wiki portent `partage_doubles`, le réglage du compte connecté).
- **Données** : migrations 16 et 17. Tout part avec le compte (`ON DELETE CASCADE`) ; une recherche suit la fiche si
  son code-barres change et disparaît avec elle.

## Échanges, étape 2 : mise en relation et messagerie
Branche `messagerie`. Table `echanges` (une ligne par fiche, chercheur et possesseur) et table `messages`
(migration 18) ; tout part avec le compte de l'un ou l'autre (`ON DELETE CASCADE`).
- **Repérage** : à chaque lecture de `GET /api/echanges` (à la connexion, au retour au premier plan, puis chaque
  minute), le serveur crée les paires de ce compte comme chercheur : une canette qu'il cherche, qu'un autre membre a
  en 2 exemplaires ou plus, partage des doublons activé des deux côtés. Une paire n'est jamais recréée, même annulée.
- **Notifications** (bouton de l'en-tête, avec pastille) : le chercheur voit « Un collectionneur a X en double »
  (une seule à la fois par canette) → « Échange » (`POST /api/echanges/{id}/accepter`, statut `demandee`) ou
  « Annuler » (`…/annuler`, rien n'est dit à l'autre). Le possesseur voit alors « Un collectionneur est intéressé
  par ton double de X » → « Échange » (statut `acceptee`) ou « Annuler ». Une mise en relation en attente est
  masquée dès que les conditions ne tiennent plus (canette trouvée, plus de double, partage coupé).
- **Messagerie** : ouverte quand les deux ont choisi « Échange » (`GET` / `POST /api/echanges/{id}/messages`,
  texte de 1 000 caractères au plus, 60 messages par heure et par compte, `SM_MESSAGES_MAX_HEURE`). Relue toutes les
  5 s quand la conversation est affichée. Jamais d'adresse ni de nom : « Toi » et « un collectionneur ».
- **Valider l'échange** (`POST /api/echanges/{id}/valider`, migration 19) : chacun valide ; au second, dans la
  même transaction, -1 chez le possesseur (refusé en 409 s'il n'a plus de double) et +1 chez le chercheur
  (canette ajoutée depuis la fiche du Wiki si besoin, retirée des recherchées). Statut `terminee` : la conversation
  reste ouverte. La pastille compte aussi « l'autre a validé, à toi ».
- **Signaler** (`POST /api/echanges/{id}/signaler`, motif parmi une liste fermée, précisions de 500 caractères,
  10 par jour et par compte) : table `signalements_membres`, conversation `fermee` pour les deux (lisible, plus
  d'envoi) et paire bloquée pour toujours, dans les deux sens. Le propriétaire les examine dans Réglages →
  Administration → « Signalements de membres » (`GET /api/admin/signalements-membres`, conversation comprise,
  membres désignés par leur rôle et un numéro), puis « Marquer comme traité ».

## Wiki (catalogue partagé)
### Champs d'une fiche (issue #5)
| Champ | Règle | Valeurs |
| --- | --- | --- |
| Nom | obligatoire | texte, majuscule à chaque mot |
| Code-barres | obligatoire (sinon code « 20… » tiré du nom) | EAN-8/13, UPC-A, codes supplémentaires |
| Volume | facultatif | nombre de ml entre 50 et 3000, enregistré « 500 ml » ; formats proposés : 250, 355, 443, 473, 500, 550, 568, 710 ml, ou « Autre » (« 16 oz » est converti) |
| Saveur | facultative | 60 caractères au plus, saveurs déjà connues proposées (`GET /api/wiki/saveurs`) ; les détails vont dans la description |
| Catégorie (gamme) | facultative | `CATEGORIES` |
| Pays / marché | facultatif | `REGIONS` |
| Variante | facultative | `VARIANTES` : Standard, Zero Sugar, Shot, Édition limitée, Collaboration |
| Statut | facultatif | Active, Stop, Nouveauté (30 jours, propriétaire seulement) |
| Description | facultative | texte libre, propriétaire seulement |

Les listes contrôlées sont dans `src/categories.ts` et `api/index.py` (un test vérifie qu'elles sont identiques).
L'API refuse (422, message lisible) une valeur hors liste dans une fiche ou une proposition. L'ajout d'une
canette à sa collection reste souple pour les anciennes versions de l'appli : volume mis au format s'il est
lisible, variante inconnue ignorée. La variante est remplie depuis le nom à la création, comme la catégorie
(`varianteDuNom`, dans cet ordre) : « Shot » → Shot, « Zero » → Zero Sugar, collaboration connue (VR46, Lando
Norris, McLaren, « … X … ») → Collaboration, « Limited » / « Édition limitée » → Édition limitée, sinon
Standard. Un choix fait à la main ou venu du Wiki n'est jamais écrasé. Elle se filtre dans le Wiki et entre
dans la recherche.

Migration 14 : copie d'abord les valeurs d'avant dans `sauvegarde_migration_14`, puis met les volumes au
format « 500 ml » (Wiki et collections), remplace le statut historique « Discontinued » par « Stop », déplace
une saveur de plus de 60 caractères dans la description si celle-ci est vide, et remplit la variante depuis le
nom. Ce qui ne peut pas être converti (volume illisible, saveur longue avec une description déjà remplie,
valeur hors liste) reste tel quel : la fiche reste valide et le propriétaire la voit « à reprendre ».
Migration 15 : complète les variantes encore vides des fiches nommées (Édition limitée ou Standard), sans
toucher une variante déjà remplie.

Menu **Wiki** : toutes les canettes répertoriées dans l'application, tous comptes confondus. Une vignette
(photo + nom) ouvre la fiche : nom, version, volume, catégorie, saveur, statut et région.
- Catégories et régions proposées dans le formulaire propriétaire : elles proviennent des valeurs distinctes
  du catalogue source. Le statut est `Active`, `Stop` ou `Nouveauté` ; une Nouveauté s'affiche `Active` 30 jours
  après avoir été choisie (calcul à la lecture, colonne `nouveaute_depuis`).
- Table `wiki` (une ligne par `ean`), séparée des collections : elle ne contient ni propriétaire, ni
  quantité, ni état, ni notes. Elle est alimentée à l'ajout d'une canette (champs descriptifs) et ne
  prend que ce qui manque : un compte ne peut pas écraser une fiche existante. Une photo envoyée devient
  celle de la fiche si elle n'en a pas encore ; les canettes sans code-barres (`LOCAL-…`) n'y sont jamais envoyées. Retirer une canette de sa
  collection ne la retire pas du Wiki. À la première création de la table, elle est amorcée depuis les
  collections existantes (une seule fois). Une fiche supprimée ou dont le code-barres a changé est notée
  dans `wiki_exclus` et n'est plus recréée ; un changement de code-barres est reporté dans les collections.
- La description ne vient pas des utilisateurs : elle est saisie par `OWNER_EMAIL` depuis la
  fiche (« Modifier la fiche », `PUT /api/wiki/{ean}`, 403 pour tout autre compte).
- Les photos du Wiki sont ajoutées, remplacées ou retirées par `OWNER_EMAIL` depuis la fiche
  (`PUT` et `DELETE /api/wiki/{ean}/photo`, 403 pour tout autre compte).
- Routes : `GET /api/wiki` (liste sans photos), `GET /api/wiki/{ean}/photo` (image, chargée à la demande
  quand la vignette approche de l'écran), toutes derrière la session. Le Wiki exige la connexion réseau.

## Référencement
`public/robots.txt` autorise l'indexation du site, sauf l'API et la page de maintenance, et annonce
`public/sitemap.xml`, qui ne liste que la page d'accueil publique (le reste exige une connexion). Les deux
visent le domaine `stackmonsters.fr`, l'adresse publique du site : relié au projet Vercel (Settings → Domains ;
chez IONOS, `@` en A vers Vercel et `www` en CNAME, redirigé vers `stackmonsters.fr`). Les liens et images des
e-mails utilisent la même adresse (`SITE_URL`, par défaut `https://stackmonsters.fr`). Mettre à jour `<lastmod>` quand la page d'accueil change.

## Photos de la page d'accueil
La photo de canette dans `public/images/` provient de Wikimedia Commons et est affichée avec attribution :
- [Monster Energy Mega can](https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg), DYVER.

Photos sous licence [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

## Boîte de contact (e-mails des clients)
Tout le courrier de `stackmonsters.fr` (dont **`contact@stackmonsters.fr`, l'adresse affichée par l'appli**, `CONTACT`
dans `src/config.ts`) et de `mail.stackmonsters.fr` (dont `contact@mail.stackmonsters.fr`, l'ancienne) arrive chez Resend. DNS chez IONOS :
- `mail.stackmonsters.fr` (envoi et réception) : **MX** `mail` → `inbound-smtp.eu-west-1.amazonaws.com` (priorité 10) ;
- `stackmonsters.fr` (réception seule dans Resend, aucune boîte IONOS) : **MX** `@` → `receive-euw1.forge.rmta.net`
  (priorité 9, les MX IONOS ont été retirés) et **TXT** `resend._domainkey` (DKIM). Le SPF IONOS reste en place.
- Les e-mails reçus sont visibles dans Resend → Emails → **Receiving**.
- Transfert automatique : Resend appelle `POST /api/mail/entrant` (webhook, événement `email.received`). La route
  vérifie la signature Svix (`RESEND_WEBHOOK_SECRET`, `whsec_…`, 5 minutes de tolérance), relit le contenu et les
  pièces jointes par l'API Receiving, puis renvoie l'e-mail à `MAIL_TRANSFERT` depuis `MAIL_CONTACT` (par défaut
  `StackMonsters Contact <contact@mail.stackmonsters.fr>`), sujet préfixé « [Contact] », l'adresse du client en
  « Répondre à ». Une clé d'idempotence (`svix-id`) évite les doublons quand Resend renvoie le webhook. Pièces jointes
  recopiées jusqu'à 30 Mo ; au-delà, le message le signale.
- Webhook à créer dans Resend (Webhooks → Add) vers `https://stackmonsters.fr/api/mail/entrant`, événement
  `email.received` ; son secret va dans la variable Vercel `RESEND_WEBHOOK_SECRET`.
- Répondre depuis l'adresse de contact : dans Gmail, « Envoyer des e-mails en tant que » avec le SMTP de Resend
  (`smtp.resend.com`, port 465, utilisateur `resend`, mot de passe : une clé d'API Resend dédiée à l'envoi).

## Administration (propriétaire)
Réglages → **Administration** (visible seulement pour `OWNER_EMAIL`, routes `/api/admin/*` en 403 pour les autres),
migration 20 :
- **Comptes** (`GET /api/admin/comptes`) : adresse, création, dernière activité (échéance de session moins
  30 jours), canettes, signalements reçus. **Bloquer** (`POST …/{id}/blocage`, colonne `users.bloque`) : sessions
  et abonnements aux notifications effacés, plus aucun code de connexion envoyé (même réponse qu'avant, rien n'est
  révélé) et un code déjà reçu est refusé (403 « compte bloqué ») ; **Débloquer** rétablit l'accès.
  **Supprimer** (`DELETE …/{id}`, adresse à recopier) : comme la suppression par le membre lui-même. Le compte
  propriétaire ne peut être ni bloqué ni supprimé.
- **Fiches** : fiches signalées et fiches proposées (« à vérifier »), ouvertes dans la fiche du Wiki avec les outils
  de modération habituels.
- **Membres** : signalements envoyés depuis la messagerie (voir Échanges, étape 2).
- **Message** (`POST /api/admin/annonces`, titre facultatif de 60 caractères, texte de 1 000, migration 21) : popup à l'ouverture de l'appli, une fois par compte
  (`GET /api/annonce`, `POST /api/annonce/{id}/vue`, colonne `users.annonce_vue` ; jamais pour l'auteur ni pour un
  compte créé après ; les 20 derniers restent aussi dans Échanges → Notifications, hors pastille), et notification système sur les appareils abonnés (Réglages → **Notifications** ;
  `POST /api/push/abonnement`, table `abonnements_push`). Les abonnements expirés (404/410) sont effacés à l'envoi.
- **Notification de test** (onglet Message, « M'envoyer une notification de test », `POST /api/admin/push/test`) :
  envoyée uniquement aux appareils abonnés du compte propriétaire, rien dans `annonces` (ni popup ni historique chez
  les membres). Résultat affiché : nombre d'appareils atteints, services en échec avec leur code (Apple, Google,
  Mozilla…), abonnements expirés retirés ; « Aucun appareil abonné sur ce compte » s'il n'y en a pas.
- **Notifications (Web Push)** : dépendance `pywebpush`, clés VAPID dans `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (secrète) et `VAPID_SUBJECT`. `scripts/generer_vapid.py` les crée dans `.env.local` sans les afficher ; les copier
  ensuite dans les variables d'environnement Vercel. Sans clés, seule la popup est envoyée. Sur iPhone, les
  notifications ne marchent que dans l'appli installée (iOS 16.4 et plus).

## Statistiques
Réglages → Administration → **Statistiques** (visible seulement pour `OWNER_EMAIL`) : nombre d'utilisateurs, nombre de
Références et nombre d'adresses IP uniques ayant validé une connexion sur les 13 derniers mois. Les
adresses sont conservées sous forme d'empreintes HMAC avec `SESSION_SECRET`, jamais en clair. Le compteur
est glissant (empreintes effacées après 13 mois) : plusieurs personnes partageant une IP comptent une fois et les IP dynamiques peuvent
compter plusieurs fois.
Route `GET /api/stats`, réponse 403 pour tout autre compte.

## Suivi du trafic facultatif
Rien n'est envoyé (dashboard de suivi et Vercel Analytics) sans un « Accepter » dans le bandeau de consentement ; le choix se
change dans Réglages. La politique de confidentialité est à `/#confidentialite` (responsable et contact :
`src/config.ts`). Les polices sont servies par le site, sans appel à Google.
En production, `src/suivi.ts` envoie les événements `visit`, `connection` et `can_added` au dashboard
StackMonsters (`https://stackmonster-dashboard.vercel.app/api/collect`, modifiable avec `VITE_TRACK_URL` ; l'adresse
doit figurer dans `connect-src` de `vercel.json`). Le dashboard n'accepte que les envois venant des domaines du site.
Les événements contiennent un identifiant aléatoire persistant dans le navigateur, le type d'appareil
et la provenance approximative (référent/source UTM) ; ils sont conservés 25 mois.
`localStorage.setItem('sm_ignore', '1')` permet de désactiver le suivi dans un navigateur.

## Migrations de la base
L'API ne modifie jamais le schéma : les migrations sont listées dans `MIGRATIONS` (`api/index.py`), dans
l'ordre, et appliquées une seule fois par `DATABASE_URL=… python scripts/migrer_schema.py`. **À lancer sur
chaque base avant de déployer une version qui ajoute une migration** : sinon l'API répond 503. Ne jamais
modifier une migration déjà déployée, en ajouter une nouvelle, et ne jamais réattribuer un numéro, même
retiré avant livraison (une base de développement a pu l'enregistrer).

Mise à jour automatique **seulement avec `SM_MIGRATION_AUTO=1`** : une Preview Vercel (`VERCEL_ENV=preview`)
se migre alors elle-même, et `./dev.sh` lance le script au démarrage. Sans cette variable (cas par défaut,
obligatoire quand la Preview ou `.env.local` désignent la base de production), le schéma ne change que par
le script : la base de production ne doit passer à une nouvelle version qu'au déploiement du code qui va avec.
Exemple : le 14 novembre 2026, la base de production est passée en version 12 alors que le site était en
v0.4.1, qui ne savait plus créer de session ; la migration 13 rend ces colonnes compatibles avec l'ancien code.

## Déployer
1. Vercel → Storage → **Neon** (injecte `DATABASE_URL`).
2. Dans Vercel → Settings → Environment Variables, configure `STATUS_APP` avec `MAINTENANCE`
   pour afficher la page de maintenance ou `PRODUCTION` pour afficher l'application (valeur par
   défaut si la variable est absente). La valeur est lue au build : après chaque changement, il faut
   redéployer. `scripts/maintenance.sh` fait les deux d'un coup : il propose MAINTENANCE ou PRODUCTION,
   enregistre `STATUS_APP` en Production puis reconstruit le dernier déploiement de production
   (`vercel redeploy` : même code, nouveau mode ; le dossier local n'est pas envoyé). `SIMULATION=1`
   affiche les commandes sans rien modifier ; `SANS_REDEPLOIEMENT=1` change seulement la variable
   (jour de release, avant `vercel --prod`). En local, le même réglage se fait dans `.env.local`.
3. Variables d'environnement (voir `.env.example`) : `SESSION_SECRET`, `RESEND_API_KEY`,
   `MAIL_FROM`, `OWNER_EMAIL`. Supprime `API_TOKEN`, devenu inutile.
   La page de maintenance n'affiche ni date ni compte à rebours : `VITE_MAINTENANCE_START_DATE` et
   `VITE_MAINTENANCE_TARGET_DATE` ne servent plus.
4. Compte **Resend** pour l'envoi des codes. Configure `MAIL_FROM` avec une adresse d'un
   domaine vérifié dans Resend. L'expéditeur de test (`onboarding@resend.dev`) ne livre
   qu'à l'adresse e-mail du compte Resend.
5. `vercel --prod`, puis connecte-toi avec `OWNER_EMAIL` : l'ancienne collection (table
   `canettes`) est copiée dans ton compte, une seule fois, à la création de ton utilisateur.

Import d'anciennes données : `scripts/migrer.py` écrit dans `canettes` ; fais-le **avant** la
première connexion du propriétaire.
Restauration d'une ancienne « Sauvegarde JSON » (export retiré de l'appli) dans un compte existant :
`python scripts/migrer.py sauvegarde.json --email moi@exemple.fr`.

## Développer
```bash
export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:55432/postgres
pnpm install && ./dev.sh      # http://localhost:5273 ; ./dev.sh --migrer applique d'abord les migrations
```
Si Vite s'arrête sur `ENOSPC: System limit for number of file watchers reached`, la limite de fichiers surveillés du
système est atteinte (VS Code et les autres outils ouverts en consomment beaucoup). Solution durable :
```bash
echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/90-inotify.conf && sudo sysctl --system
```
En attendant : `SM_POLLING=1 ./dev.sh` (les fichiers sont relus régulièrement au lieu d'être surveillés).
Si tu utilises Neon, configure `DATABASE_URL` avec la chaîne de connexion actuelle de la branche choisie
(Neon → **Connect**). `./dev.sh` vérifie la connexion avant de démarrer et signale les identifiants refusés.

**Jamais la production en local.** Le 23/11/2026, `./dev.sh --migrer` lancé avec un `.env.local` qui pointait sur
la production a appliqué une migration encore en cours d'écriture. Depuis, `./dev.sh` refuse de démarrer, et donc
de migrer, sur la base de production (`scripts/garde_prod.py`, lancé avant toute connexion) :
- sans déclaration, seules les bases **locales** passent : `localhost`, `127.x`, `::1`, socket Unix, nom de
  conteneur sans point (`db`). Toute base distante est refusée ;
- pour travailler sur une base distante (branche Neon de prévisualisation), déclare l'hôte de la prod dans
  `.env.local`, jamais dans le dépôt : `SM_PROD_DB_HOST=ep-….eu-central-1.aws.neon.tech` (plusieurs hôtes possibles,
  séparés par des virgules). La base est alors acceptée si aucun de ses hôtes n'est celui de la prod. Pour Neon et
  Vercel Postgres (`*.vercel-storage.com`), la comparaison porte sur l'identifiant d'endpoint (`ep-…`), avec ou
  sans `-pooler` ;
- les hôtes sont lus dans l'URL (plusieurs hôtes, `?host=`, `?hostaddr=`), dans la forme mots-clés
  (`host=… dbname=…`) et, à défaut, dans `PGHOST` / `PGHOSTADDR` ; une `DATABASE_URL` illisible est refusée ;
- exception volontaire et ponctuelle : `SM_JE_VEUX_LA_PROD=1 ./dev.sh` (avertissement en rouge).
Les migrations de production passent par `scripts/migrer_schema.py`, avec le feu vert d'Eleazar, pas par `./dev.sh`.
En local, saisis un e-mail : le code s'affiche dans le terminal (ligne `[dev]`).
Tests : `pnpm test` ; `TEST_DATABASE_URL=… python -m pytest tests` (jamais sur la production).
Bout en bout : `pnpm exec playwright install chromium`, migrer une base **jetable**, puis
`E2E_DATABASE_URL=… E2E_PYTHON=.venv/bin/python pnpm exec playwright test`.

## Limites assumées
- Les limites par IP ralentissent l'inscription en masse sans l'empêcher (réseaux de nombreuses IP) ; pas de
  CAPTCHA. Plusieurs personnes derrière la même IP (CGNAT mobile, école) partagent les compteurs.
- Session stockée dans `localStorage`, envoyée en `Bearer`, donc lisible par un script injecté (XSS) ; le passage
  au cookie `HttpOnly` est décrit dans « Sessions ».
- Pas de partage de collection.
- Hors ligne : lecture seule de la dernière liste ; « Se déconnecter » vide ce cache.
