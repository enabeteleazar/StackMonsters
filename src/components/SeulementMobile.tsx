import { Download, ScanLine, Smartphone } from 'lucide-react'
import PiedPublic from './PiedPublic'

/**
 * Écran des ordinateurs (souris, grand écran) : l'appli est faite pour le mobile et la tablette.
 * Même univers que l'accueil public : logo, accroche, canette mise en scène et pied de page.
 * Racine « .ordinateur » et non « .accueil-public » : ce bloc est présent (caché) sur tous les écrans, il ne
 * doit pas déclencher les règles de mise en page propres à l'accueil (html:has(.accueil-public)).
 */
export default function SeulementMobile() {
  const adresse = window.location.host
  return (
    <div className="ordinateur">
      <header className="accueil-public-entete">
        <div className="logo">
          <span className="accueil-public-marque">
            <img src="/favicon.svg" alt="" />
          </span>
          <div className="logo-marque">
            Stack<em>Monsters</em>
          </div>
        </div>
      </header>

      <main className="accueil-public-contenu">
        <section className="accueil-public-hero">
          <div className="accueil-public-texte">
            <h1 className="accueil-public-description">
              Site développé pour <b>mobile.</b>
            </h1>
            <span className="accueil-public-trait" aria-hidden="true" />
            <ul className="accueil-public-fonctions">
              <li>
                <Smartphone size={30} strokeWidth={1.8} />
                <span>
                  Ouvre <b>{adresse}</b> sur ton téléphone ou ta tablette
                </span>
              </li>
              <li>
                <Download size={30} strokeWidth={1.8} />
                Installe-le sur ton écran d’accueil, comme une appli
              </li>
              <li>
                <ScanLine size={30} strokeWidth={1.8} />
                Scanne tes canettes avec l’appareil photo
              </li>
            </ul>
          </div>

          <figure className="ordinateur-badge">
            <img src="/images/logo-badge.svg" alt="Logo StackMonsters" width={480} height={480} />
          </figure>
        </section>
      </main>

      <PiedPublic />
    </div>
  )
}
