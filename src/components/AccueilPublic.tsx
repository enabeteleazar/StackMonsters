import { ArrowRight, BarChart3, ScanLine, Trophy, UserRound } from 'lucide-react'
import PiedPublic from './PiedPublic'

type Props = {
  surConnexion: () => void
  serviceIndisponible: boolean
}

/** Page d'accueil des visiteurs sans session : accroche, canette mise en scène, puis inscription. */
export default function AccueilPublic({ surConnexion, serviceIndisponible }: Props) {
  return (
    <div className="accueil-public">
      <header className="accueil-public-entete">
        <div className="logo">
          <span className="accueil-public-marque">
            <img src="/favicon.svg" alt="" />
          </span>
          <div className="logo-marque">
            Stack<em>Monster</em>
          </div>
        </div>
      </header>

      <main className="accueil-public-contenu">
        <section className="accueil-public-hero">
          <div className="accueil-public-texte">
            <h1 className="accueil-public-description">
              Compte, scanne et explore ta collection <b>Monster.</b>
            </h1>
            <span className="accueil-public-trait" aria-hidden="true" />
            <ul className="accueil-public-fonctions">
              <li>
                <ScanLine size={30} strokeWidth={1.8} />
                Scanne tes canettes
              </li>
              <li>
                <BarChart3 size={30} strokeWidth={1.8} />
                Découvre ta collection
              </li>
              <li>
                <Trophy size={30} strokeWidth={1.8} />
                Suis tes statistiques
              </li>
            </ul>
          </div>

          <figure className="accueil-public-canette" aria-hidden="true">
            <span className="accueil-public-fumee" />
            <span className="accueil-public-canette-cadre">
              <img src="/images/monster-mega-detouree.webp" alt="" width={200} height={579} />
            </span>
            <span className="accueil-public-sol" />
          </figure>
        </section>

        {serviceIndisponible && (
          <p className="accueil-public-alerte" role="status">
            Le service est momentanément indisponible. Réessaie dans un instant.
          </p>
        )}

        <div className="accueil-public-action">
          <button className="accueil-public-cta" onClick={surConnexion}>
            <UserRound size={26} strokeWidth={1.8} />
            <span className="accueil-public-cta-separateur" aria-hidden="true" />
            Entrez
            <ArrowRight size={24} />
          </button>
        </div>

      </main>

      <PiedPublic />
    </div>
  )
}
