import { useEffect, useState } from 'react'
import { Download, EllipsisVertical, Share, SquarePlus, X } from 'lucide-react'
import { installationDirecte, installer, marquerInvitationVue, plateforme, suivreInstallation } from '../installation'

type Props = { surFermeture: () => void }

/** Fenêtre affichée une seule fois par appareil, après la première connexion : installer l'appli. */
export default function InvitationInstallation({ surFermeture }: Props) {
  const ios = plateforme() === 'ios'
  const [directe, setDirecte] = useState(installationDirecte)

  useEffect(() => suivreInstallation(() => setDirecte(installationDirecte())), [])

  const fermer = () => {
    marquerInvitationVue()
    surFermeture()
  }

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fermer()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  })

  return (
    <div className="invitation-fond" onClick={fermer}>
      <section
        className="invitation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invitation-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="invitation-fermer" aria-label="Fermer" onClick={fermer}>
          <X size={20} />
        </button>
        <img className="invitation-logo" src="/favicon.svg" alt="" width={72} height={72} />
        <h2 id="invitation-titre">
          Installe <b>StackMonsters.</b>
        </h2>
        <p className="invitation-intro">
          L’appli sur ton écran d’accueil : ouverture en un geste, plein écran, et ta collection lisible hors ligne.
        </p>

        {ios ? (
          <ol className="invitation-etapes">
            <li>
              <Share size={22} />
              <span>
                Touche <b>Partager</b> dans la barre de Safari.
              </span>
            </li>
            <li>
              <SquarePlus size={22} />
              <span>
                Choisis <b>Sur l’écran d’accueil</b>.
              </span>
            </li>
            <li>
              <Download size={22} />
              <span>
                Touche <b>Ajouter</b> : l’icône apparaît sur ton écran d’accueil.
              </span>
            </li>
          </ol>
        ) : directe ? null : (
          <ol className="invitation-etapes">
            <li>
              <EllipsisVertical size={22} />
              <span>
                Ouvre le <b>menu</b> du navigateur (⋮).
              </span>
            </li>
            <li>
              <Download size={22} />
              <span>
                Choisis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.
              </span>
            </li>
          </ol>
        )}

        <div className="invitation-actions">
          {!ios && directe && (
            <button
              className="btn btn-primaire"
              onClick={() => {
                void installer().finally(fermer)
              }}
            >
              <Download size={18} /> Installer
            </button>
          )}
          <button className="btn btn-fantome" onClick={fermer}>
            {ios || !directe ? 'Compris' : 'Plus tard'}
          </button>
        </div>
      </section>
    </div>
  )
}
