import { useEffect, useState } from 'react'
import { BarChart3, Cpu, Database, Lock, Radio, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api, ErreurAPI, jeton, NonAutorise } from '../api'
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
    const saisie = prompt(
      `Suppression définitive du compte et de toute ta collection.\n\nPour confirmer, saisis ${emailUtilisateur} :`,
    )
    if (saisie === null) return
    if (saisie.trim().toLowerCase() !== emailUtilisateur.toLowerCase()) {
      setErreurCompte('Adresse différente : le compte n’a pas été supprimé.')
      return
    }
    setErreurCompte(null)
    try {
      await api.supprimerCompte()
      quitter()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Suppression impossible, réessaie avec le réseau.')
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
          {proprietaire === false && (
            <button className="accueil-co-secondaire reglages-danger" onClick={() => void supprimerCompte()}>
              <Trash2 size={18} />
              Supprimer mon compte
            </button>
          )}
        </div>
        {erreurCompte && <p className="reglages-alerte" role="alert">{erreurCompte}</p>}

        <LienInstagram />
      </div>
    </section>
  )
}
