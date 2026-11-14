import { useEffect, useState } from 'react'
import { BarChart3, Cpu, Database, Lock, MonitorSmartphone, Radio, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api, ErreurAPI, jeton, NonAutorise } from '../api'
import { CONTACT } from '../config'
import { consentement, definirConsentement, EVENEMENT_CONSENTEMENT } from '../suivi'
import { moteurNatif } from '../scanner'
import LienInstagram from './LienInstagram'

type Props = {
  emailUtilisateur: string
  joignable: boolean
  surVerrouiller: () => void
  surStats: () => void
}

export default function Settings({ emailUtilisateur, joignable, surVerrouiller, surStats }: Props) {
  const [sante, setSante] = useState<{ status: string; version: string; references: number } | null>(null)

  // Seul le propriétaire (OWNER_EMAIL) obtient une réponse : sinon l'API répond 403 et le bouton reste caché.
  // null tant que le serveur n'a pas répondu : le bouton de suppression n'apparaît qu'une fois la réponse connue
  // (sinon il s'affichait puis disparaissait pour le propriétaire, dont le compte ne peut pas être supprimé).
  const [proprietaire, setProprietaire] = useState<boolean | null>(null)
  const [erreurCompte, setErreurCompte] = useState<string | null>(null)
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

  const deconnecterPartout = async () => {
    if (!confirm('Se déconnecter de tous les appareils ? Il faudra redemander un code partout, ici compris.')) return
    setErreurCompte(null)
    try {
      await api.deconnexionPartout()
      quitter()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Déconnexion impossible, réessaie avec le réseau.')
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

        {/* Statistiques du service : réservées au propriétaire (OWNER_EMAIL). */}
        {proprietaire === true && (
          <>
            <h2 className="reglages-titre">Administration</h2>
            <div className="reglages-actions">
              <button className="accueil-co-secondaire" onClick={surStats}>
                <BarChart3 size={18} />
                Statistiques
              </button>
            </div>
          </>
        )}

        <h2 className="reglages-titre">Compte et confidentialité</h2>
        <div className="reglages-actions">
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
          <button className="accueil-co-secondaire" onClick={() => void deconnecterPartout()}>
            <MonitorSmartphone size={18} />
            Déconnecter tous les appareils
          </button>
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
          {proprietaire === false && !suppression && (
            <button className="accueil-co-secondaire reglages-danger" onClick={() => setSuppression(true)}>
              <Trash2 size={18} />
              Supprimer mon compte
            </button>
          )}
        </div>
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
