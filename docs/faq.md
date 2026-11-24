# FAQ support StackMonsters

Réponses prêtes à envoyer aux membres (e-mail à contact@, commentaires sur les réseaux). Chaque réponse est
vérifiée dans le code de la version indiquée. Ne jamais demander de mot de passe, de code de connexion ni de
donnée personnelle.

À proposer au chef de projet : ajouter les questions les plus fréquentes dans l'appli.

## Échanges

**Je reçois une notification quand on me répond ?** (0.7.0)
Pas de notification sur le téléphone pour les échanges. Dans l'appli, une popup t'avertit quand un collectionneur
a une canette que tu cherches ou te propose un échange, et une pastille sur Échanges signale tes nouveaux messages.
La popup s'affiche quand l'appli est ouverte (à l'ouverture, ou dans la minute).

**Comment je propose un échange ?** (0.7.0)
Sur la fiche Wiki de la canette qui te manque, touche « Je la cherche ». Quand un collectionneur l'a en double, une
popup te prévient : tu touches « Échange », il accepte, puis vous discutez dans la messagerie.

**Mes doubles sont visibles par tout le monde ?** (0.7.0)
Personne ne voit ta collection. Seul un membre qui cherche une canette que tu as en double est prévenu, et il ne
voit ni ton nom ni ton adresse : juste « un collectionneur ». Tu peux couper le partage de tes doublons dans les
Réglages, mais tu ne pourras alors plus faire d'échanges.

**Comment ma collection se met à jour après un échange ?** (0.7.0)
Quand vous avez validé l'échange tous les deux, la canette part de la collection de l'un (−1) et arrive dans
celle de l'autre (+1), automatiquement. Rien ne change tant qu'un seul a validé.

**Ma conversation a disparu.** (0.7.1)
Une conversation peut disparaître si l'autre membre a supprimé son compte : ses messages sont effacés avec lui.
Ta collection n'est pas touchée.

**Une conversation est fermée, je ne peux plus écrire.** (0.7.0)
L'un de vous deux a signalé l'autre : la conversation reste lisible, mais plus personne n'y écrit, et l'équipe
examine le signalement.

## Wiki

**Je ne vois pas le bouton « Je la cherche ».** (0.7.0)
Il n'apparaît pas pour une canette qui est déjà dans ta collection.

## Compte

**Comment je supprime mon compte ?** (0.7.1)
Réglages → « Supprimer mon compte », puis recopie ton adresse pour confirmer. Ton compte, ta collection et tes
sessions sur tous tes appareils sont effacés immédiatement. Tu peux aussi écrire à contact@stackmonsters.fr.
(En 0.7.0, le bouton n'existe pas : écrire à contact@stackmonsters.fr.)

**La suppression de mon compte est refusée.** (0.7.1)
L'appli affiche : « Un signalement te concernant est en cours d'examen : écris à contact@stackmonsters.fr pour
supprimer ton compte. »
Réponse : « Bien reçu : ta demande de suppression est enregistrée. Elle sera traitée dès la fin de l'examen en
cours, et au plus tard dans un mois. On te confirme par e-mail quand c'est fait. »
(Support : ne pas détailler le signalement, ni dire qui l'a fait. Suivre la demande comme indiqué ci-dessous.)

## Appli et notifications

**Comment j'installe l'appli ?** (0.7.0, vérifié en émulation seulement)
Va sur https://stackmonsters.fr/ puis, sur iPhone dans Safari : Partager → « Sur l'écran d'accueil » ; sur
Android : menu du navigateur (⋮) → « Installer l'application » ou « Ajouter à l'écran d'accueil ».

**Je ne trouve pas le bouton Notifications.** (0.7.0)
Sur iPhone, il n'apparaît que dans l'appli installée sur l'écran d'accueil (iOS 16.4 ou plus), pas dans Safari.

**J'ai activé les notifications mais l'appli dit « Notifications refusées ».** (0.7.0)
Autorise d'abord StackMonsters dans les réglages du téléphone (Notifications), puis réessaie dans l'appli.

## Bug ou problème de compte

> Merci ! Peux-tu nous écrire à contact@stackmonsters.fr avec une capture et le modèle de ton téléphone ? On
> regarde vite.

(Ne jamais demander le code de connexion.)

## Processus support

### Demandes de suppression de compte reçues à contact@

Délai légal : **un mois** à compter de la réception de l'e-mail (droit à l'effacement). Cas typique : membre
visé par un signalement non traité, pour qui l'appli refuse la suppression (0.7.1).

1. **Jour 0, à réception** (Eleazar, ou Dennis qui transmet) : répondre avec le texte ci-dessus et noter la
   demande dans un suivi tenu par Eleazar, hors du dépôt (date de réception, adresse du compte ; aucune autre
   donnée). Jamais dans une issue GitHub.
2. **Examen** : Eleazar traite le signalement dans l'Administration (« Marquer comme traité », ou blocage).
3. **Suppression** : une fois le signalement traité, le membre peut supprimer son compte lui-même depuis les
   Réglages ; sinon Eleazar le supprime depuis Administration → Comptes. Confirmer au membre par e-mail.
4. **Relance** : si la demande est ouverte depuis plus de **3 semaines**, la QA prévient le chef de projet pour
   qu'elle soit close avant la fin du mois.

Ne jamais faire circuler l'adresse du membre ni le contenu du signalement entre agents : seulement « une demande
de suppression reçue le JJ/MM ».
