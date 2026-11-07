import { ArrowRight, BarChart3, LibraryBig, ScanLine, ShieldCheck } from 'lucide-react'

type Props = {
  surConnexion: () => void
  serviceIndisponible: boolean
}

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
          <span className="eyebrow">Le compagnon des collectionneurs</span>
          <h1 className="accueil-public-titre">
            Chaque canette
            <span>raconte une histoire.</span>
          </h1>
          <p className="accueil-public-description">
            Garde toute ta collection Monster à portée de main. Scanne, organise et retrouve tes
            trouvailles où que tu sois.
          </p>
          {serviceIndisponible && (
            <p className="accueil-public-alerte" role="status">
              Le service est momentanément indisponible. Réessaie dans un instant.
            </p>
          )}
          <button className="btn btn-primaire accueil-public-cta" onClick={surConnexion}>
            Se connecter
            <ArrowRight size={19} />
          </button>
          <p className="accueil-public-note">Connexion simple et sécurisée par e-mail</p>
        </section>

        <section className="accueil-public-apercu" aria-label="Fonctionnalités de StackMonster">
          <div className="accueil-public-apercu-tete">
            <span className="accueil-public-pastille"><ScanLine size={17} /> Monster Mega</span>
            <span className="accueil-public-lueur" aria-hidden="true" />
          </div>
          <div className="accueil-public-galerie">
            <figure>
              <img src="/images/monster-mega.jpg" alt="Canette Monster Energy Mega sur fond noir" />
              <figcaption>
                <b>Monster Mega</b>
                <a href="https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg" target="_blank" rel="noreferrer">
                  Photo : DYVER
                </a>
              </figcaption>
            </figure>
          </div>
          <div className="accueil-public-apercu-pied">
            <div>
              <span>Ta prochaine trouvaille</span>
              <b>À ajouter à la collection</b>
            </div>
            <ScanLine size={21} />
          </div>
          <p className="accueil-public-licence">
            Photo sous licence{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
              CC BY-SA 4.0
            </a>
          </p>
        </section>

        <section className="accueil-public-fonctions">
          <article>
            <ScanLine size={22} />
            <h2>Scanne</h2>
            <p>Ajoute une canette en quelques secondes grâce au code-barres.</p>
          </article>
          <article>
            <LibraryBig size={22} />
            <h2>Organise</h2>
            <p>Retrouve tes références, variantes et notes dans un seul espace.</p>
          </article>
          <article>
            <BarChart3 size={22} />
            <h2>Progresse</h2>
            <p>Visualise ta collection et suis tes nouvelles trouvailles.</p>
          </article>
          <article>
            <ShieldCheck size={22} />
            <h2>Protège</h2>
            <p>Ta collection reste privée et accessible uniquement après connexion.</p>
          </article>
        </section>

        <p className="accueil-public-prive">
          <ShieldCheck size={17} />
          Ta collection reste privée et accessible uniquement après connexion.
        </p>

        <button className="accueil-public-cta-bas" onClick={surConnexion}>
          Accéder à ma collection <ArrowRight size={18} />
        </button>
        <p className="accueil-public-independance">
          StackMonster est un projet indépendant, non affilié à Monster Energy et non édité par la marque.
        </p>
      </main>
    </div>
  )
}
