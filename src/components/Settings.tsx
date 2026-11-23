import { useEffect, useState } from 'react'
import { Bell, Cpu, Database, Eraser, Lock, Radio, Repeat2, ShieldCheck, UserCog, Trash2, UserRound } from 'lucide-react'
import { api, ErreurAPI, jeton, NonAutorise } from '../api'
import { CONTACT } from '../config'
import { consentement, definirConsentement, EVENEMENT_CONSENTEMENT } from '../suivi'
import { moteurNatif } from '../scanner'
import { activerNotifications, desactiverNotifications, notificationsActives, notificationsPossibles } from '../notifications'
import LienInstagram from './LienInstagram'
import { oublierDonneesLocales } from '../notificationsVues'

type Props = {
  emailUtilisateur: string
  joignable: boolean
  surVerrouiller: () => void
  /** Propriétaire : page Administration (comptes, fiches, membres signalés, message à tous). */
  surAdministration: () => void
  /** Nombre de canettes de la collection (pour la confirmation du vidage). */
  nbCanettes: number
  surCollectionVidee: (retirees: number) => void
  /** Après un changement de réglage qui touche la collection (partage des doublons) : la recharger. */
  surPreferencesChangees: () => Promise<void>
}


export default function Settings({
  emailUtilisateur, joignable, surVerrouiller, surAdministration, nbCanettes, surCollectionVidee, surPreferencesChangees,
}: Props) {
  const [sante, setSante] = useState<{ status: string; version: string; references: number } | null>(null)

  // Seul le propriétaire (OWNER_EMAIL) obtient une réponse : sinon l'API répond 403 et le bouton reste caché.
  // null tant que le serveur n'a pas répondu : le bouton de suppression n'apparaît qu'une fois la réponse connue
  // (sinon il s'affichait puis disparaissait pour le propriétaire, dont le compte ne peut pas être supprimé).
  const [proprietaire, setProprietaire] = useState<boolean | null>(null)
  const [erreurCompte, setErreurCompte] = useState<string | null>(null)
  // Vidage de la collection : panneau de confirmation, puis appel à l'API.
  const [vidage, setVidage] = useState(false)
  const [vidageEnCours, setVidageEnCours] = useState(false)
  // Panneau de confirmation de la suppression : conséquences, puis adresse du compte à saisir.
  const [suppression, setSuppression] = useState(false)
  const [saisieSuppression, setSaisieSuppression] = useState('')
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const adresseConfirmee = saisieSuppression.trim().toLowerCase() === emailUtilisateur.toLowerCase()
  const [mesure, setMesure] = useState(consentement)

  useEffect(() => {
    const maj = () => setMesure(consentement())
    window.addEventListener(EVENEMENT_CONSENTEMENT, maj)
    return () => window.removeEventListener(EVENEMENT_CONSENTEMENT, maj)
  }, [])

  const quitter = () => {
    jeton.effacer()
    surVerrouiller()
  }

  const supprimerCompte = async () => {
    if (!adresseConfirmee || suppressionEnCours) return
    setErreurCompte(null)
    setSuppressionEnCours(true)
    try {
      await api.supprimerCompte(saisieSuppression)
      oublierDonneesLocales(emailUtilisateur) // rien ne reste du compte sur cet appareil
      quitter()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Suppression impossible, réessaie avec le réseau. Ton compte n’a pas été supprimé.')
    } finally {
      setSuppressionEnCours(false)
    }
  }

  const fermerSuppression = () => {
    setSuppression(false)
    setSaisieSuppression('')
    setErreurCompte(null)
  }

  const viderCollection = async () => {
    setErreurCompte(null)
    setVidageEnCours(true)
    try {
      const { retirees } = await api.viderCollection()
      setVidage(false)
      surCollectionVidee(retirees)
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Vidage impossible, réessaie avec le réseau. Ta collection n’a pas été modifiée.')
    } finally {
      setVidageEnCours(false)
    }
  }

  // Partage des doublons (réglage du compte) : null tant que le serveur n'a pas répondu.
  const [partage, setPartage] = useState<boolean | null>(null)
  const [partageOccupe, setPartageOccupe] = useState(false)
  useEffect(() => {
    api.moi().then((m) => setPartage(m.partage_doubles ?? true)).catch(() => setPartage(null))
  }, [joignable])

  const basculerPartage = async () => {
    if (partage === null) return
    setErreurCompte(null)
    setPartageOccupe(true)
    try {
      setPartage((await api.reglerPartageDoubles(!partage)).partage_doubles)
      await surPreferencesChangees()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Réglage non modifié, réessaie avec le réseau.')
    } finally {
      setPartageOccupe(false)
    }
  }

  // Notifications système de cet appareil (messages du service) : null tant que l'état n'est pas connu.
  const possibles = notificationsPossibles()
  const [notifs, setNotifs] = useState<boolean | null>(null)
  const [notifsOccupe, setNotifsOccupe] = useState(false)
  useEffect(() => {
    if (possibles) notificationsActives().then(setNotifs).catch(() => setNotifs(false))
  }, [possibles])

  const basculerNotifs = async () => {
    setErreurCompte(null)
    setNotifsOccupe(true)
    try {
      if (notifs) {
        await desactiverNotifications()
        setNotifs(false)
      } else {
        const r = await activerNotifications()
        setNotifs(r === 'active')
        if (r === 'refusee') setErreurCompte('Notifications refusées : autorise-les dans les réglages du téléphone.')
        if (r === 'indisponible') setErreurCompte('Notifications indisponibles pour le moment.')
        if (r === 'sans-service-worker') {
          setErreurCompte('Notifications indisponibles ici : elles fonctionnent sur le site en ligne, dans l’appli installée.')
        }
      }
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Notifications non modifiées, réessaie avec le réseau.')
    } finally {
      setNotifsOccupe(false)
    }
  }

  useEffect(() => {
    api.sante().then(setSante).catch(() => setSante(null))
    api
      .stats()
      .then(() => setProprietaire(true))
      // 403 : compte ordinaire. Autre erreur (hors ligne…) : on ne sait pas, rien n'est affiché.
      .catch((e) => setProprietaire(e instanceof ErreurAPI && e.status === 403 ? false : null))
  }, [joignable])

  return (
    <section className="collec reglages">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Mes <b>réglages.</b>
          </h1>
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        {/* Compte : adresse du compte connecté, en tête. */}
        <div className="reglages-carte reglages-compte">
          <span className="reglages-avatar" aria-hidden="true">
            <UserRound size={24} />
          </span>
          <div className="reglages-compte-texte">
            <span className="reglages-etiquette">Compte</span>
            <b>{emailUtilisateur || '—'}</b>
          </div>
        </div>

        <h2 className="reglages-titre">Service</h2>
        <div className="reglages-carte">
          <div className="reglages-info">
            <span className="libelle">
              <Database size={17} />
              Fiches en base
            </span>
            <span className="valeur">{sante ? sante.references : '—'}</span>
          </div>
          <div className="reglages-info">
            <span className="libelle">
              <Radio size={17} />
              Version
            </span>
            <span className="valeur">
              {/* Une version d'API différente signale un déploiement incomplet ou un cache périmé. */}
              {!sante || sante.version === __VERSION_APP__ ? __VERSION_APP__ : `${__VERSION_APP__} · service ${sante.version}`}
            </span>
          </div>
          <div className="reglages-info">
            <span className="libelle">
              <Cpu size={17} />
              Lecteur de code-barres
            </span>
            <span className="valeur">{moteurNatif() ? 'Natif' : 'ZXing'}</span>
          </div>
        </div>

        {/* Administration : réservée au propriétaire (OWNER_EMAIL). */}
        {proprietaire === true && (
          <div className="reglages-actions reglages-admin">
            <button className="accueil-co-secondaire" onClick={surAdministration}>
              <UserCog size={18} />
              Administration
            </button>
          </div>
        )}

        <h2 className="reglages-titre">Compte et confidentialité</h2>
        <div className="reglages-actions">
          {/* Seul réglage du partage : activé, toutes les canettes en 2 exemplaires ou plus comptent comme doubles. */}
          <button
            className={`accueil-co-secondaire reglages-bascule${partage ? ' actif' : ''}`}
            role="switch"
            aria-checked={partage === true}
            disabled={partage === null || partageOccupe}
            onClick={() => void basculerPartage()}
          >
            <Repeat2 size={18} />
            Partage des doublons
            <span className="reglages-bascule-etat">{partage === null ? '…' : partage ? 'Activé' : 'Désactivé'}</span>
          </button>
          {/* Notifications système : sur iPhone, seulement dans l'appli installée (sinon le bouton n'apparaît pas). */}
          {possibles && (
            <button
              className={`accueil-co-secondaire reglages-bascule${notifs ? ' actif' : ''}`}
              role="switch"
              aria-checked={notifs === true}
              disabled={notifs === null || notifsOccupe}
              onClick={() => void basculerNotifs()}
            >
              <Bell size={18} />
              Notifications
              <span className="reglages-bascule-etat">{notifs === null ? '…' : notifs ? 'Activées' : 'Désactivées'}</span>
            </button>
          )}
          <button className="accueil-co-secondaire" onClick={() => { window.location.hash = 'confidentialite' }}>
            <ShieldCheck size={18} />
            Confidentialité
          </button>
          {import.meta.env.PROD && (
            <button className="accueil-co-secondaire" onClick={() => definirConsentement(mesure === 'oui' ? 'non' : 'oui')}>
              <Radio size={18} />
              {mesure === 'oui' ? 'Refuser la mesure d’audience' : 'Accepter la mesure d’audience'}
            </button>
          )}
          <span className="reglages-espace" aria-hidden="true" />
          {/* Réservé au propriétaire : masqué pour les comptes ordinaires. */}
          {proprietaire === true && !vidage && (
            <button
              className="accueil-co-secondaire reglages-danger"
              disabled={nbCanettes === 0}
              onClick={() => {
                setSuppression(false)
                setVidage(true)
              }}
            >
              <Eraser size={18} />
              {nbCanettes === 0 ? 'Collection déjà vide' : 'Vider ma collection'}
            </button>
          )}
          <button
            className="accueil-co-secondaire"
            onClick={() => {
              void api.deconnexion().catch(() => {})
              jeton.effacer()
              surVerrouiller()
            }}
          >
            <Lock size={18} />
            Se déconnecter
          </button>
          {/* Suppression du compte par le membre lui-même (#3) ; jamais pour le compte propriétaire. */}
          {proprietaire === false && !suppression && (
            <button
              className="accueil-co-secondaire reglages-danger"
              onClick={() => {
                setVidage(false)
                setSuppression(true)
              }}
            >
              <Trash2 size={18} />
              Supprimer mon compte
            </button>
          )}
        </div>
        {vidage && (
          <div className="reglages-suppression" role="region" aria-labelledby="titre-vidage">
            <h3 id="titre-vidage">
              <Eraser size={18} /> Vider ta collection ?
            </h3>
            <p>
              {nbCanettes > 1 ? `Les ${nbCanettes} canettes` : 'La canette'} de ta collection {nbCanettes > 1 ? 'seront retirées' : 'sera retirée'}{' '}
              définitivement, avec leurs quantités, états, notes et photos. Impossible de revenir en arrière.
            </p>
            <p>Ton compte reste ouvert, et les fiches du Wiki ne changent pas : tu pourras rescanner tes canettes.</p>
            <div className="reglages-suppression-actions">
              <button type="button" className="accueil-co-secondaire" onClick={() => setVidage(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="accueil-co-secondaire reglages-danger"
                disabled={vidageEnCours}
                onClick={() => void viderCollection()}
              >
                <Eraser size={18} />
                {vidageEnCours ? 'Vidage…' : 'Vider'}
              </button>
            </div>
          </div>
        )}
        {proprietaire === false && suppression && (
          <form
            className="reglages-suppression"
            aria-labelledby="titre-suppression"
            onSubmit={(e) => {
              e.preventDefault()
              void supprimerCompte()
            }}
          >
            <h3 id="titre-suppression">
              <Trash2 size={18} /> Supprimer ton compte ?
            </h3>
            <p>Effacé définitivement, sans retour possible :</p>
            <ul>
              <li>ta collection : canettes, quantités, états, notes et photos ;</li>
              <li>ton compte et ton adresse e-mail ;</li>
              <li>tes sessions : tu seras déconnecté de tous tes appareils ;</li>
              <li>la copie hors ligne gardée sur cet appareil.</li>
            </ul>
            <p>
              Reste dans le Wiki, sans aucun lien avec toi : les fiches que tu as créées ou complétées, les photos
              devenues celles d’une fiche, tes propositions et tes signalements. Ils n’ont jamais été rattachés à ton
              compte ; le responsable du Wiki peut retirer une photo sur demande.
            </p>
            <p>
              Pour garder une copie de tes données, écris d’abord à <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </p>
            <label htmlFor="confirmation-suppression">
              Pour confirmer, saisis ton adresse : <b>{emailUtilisateur}</b>
            </label>
            <input
              id="confirmation-suppression"
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={saisieSuppression}
              onChange={(e) => setSaisieSuppression(e.target.value)}
            />
            <div className="reglages-suppression-actions">
              <button type="button" className="accueil-co-secondaire" onClick={fermerSuppression}>
                Annuler
              </button>
              <button
                type="submit"
                className="accueil-co-secondaire reglages-danger"
                disabled={!adresseConfirmee || suppressionEnCours}
              >
                <Trash2 size={18} />
                {suppressionEnCours ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </form>
        )}
        {erreurCompte && <p className="reglages-alerte" role="alert">{erreurCompte}</p>}

        <LienInstagram />
      </div>
    </section>
  )
}
