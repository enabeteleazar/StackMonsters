import { CONTACT, RESPONSABLE } from '../config'
import Logo from './Logo'

const Bloc = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
  <div className="reglages-groupe">
    <div className="section-titre">
      <h2>{titre}</h2>
    </div>
    <div className="sous">{children}</div>
  </div>
)

export default function Confidentialite() {
  return (
    <>
      <header>
        <div className="logo">
          <Logo />
          <div className="logo-marque">
            Stack<em>Monster</em>
          </div>
        </div>
      </header>
      <main>
        <section>
          <span className="eyebrow">StackMonster</span>
          <h1 className="tb-titre" style={{ fontSize: 'clamp(26px,7vw,34px)' }}>
            Confidentialité
          </h1>

          <Bloc titre="Responsable du traitement">
            <p>{RESPONSABLE} — <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
          </Bloc>

          <Bloc titre="Données traitées et finalités">
            <ul>
              <li>Adresse e-mail et code de connexion : créer le compte et te connecter.</li>
              <li>Jeton de session, enregistré dans ton navigateur : te garder connecté.</li>
              <li>Canettes, quantités, états, notes et photos : gérer ta collection privée.</li>
              <li>Empreintes d’adresses IP : limiter les abus et compter les connexions uniques, sans IP en clair.</li>
              <li>Mesure d’audience, seulement si tu l’acceptes : visites, type d’appareil, provenance et identifiant aléatoire.</li>
            </ul>
            <p>
              Les données de compte et de collection sont traitées pour fournir le service que tu demandes, les
              empreintes d’IP pour assurer sa sécurité, et la mesure d’audience sur ton consentement.
            </p>
          </Bloc>

          <Bloc titre="Wiki partagé">
            <p>
              Le nom, la version, le volume et les champs descriptifs d’une canette avec code-barres alimentent un
              catalogue visible par les comptes connectés, sans lien avec ton compte. Tes photos, notes, quantités et
              canettes sans code-barres n’y sont pas envoyées.
            </p>
          </Bloc>

          <Bloc titre="Durées de conservation">
            <ul>
              <li>Compte et collection : jusqu’à la suppression du compte.</li>
              <li>Sessions : 30 jours au plus, ou jusqu’à la déconnexion.</li>
              <li>Codes de connexion et compteurs de limitation : une heure environ.</li>
              <li>Empreintes d’IP des connexions uniques : conservées pour le compteur cumulé.</li>
            </ul>
          </Bloc>

          <Bloc titre="Prestataires">
            <p>
              Vercel (hébergement et mesure d’audience), Neon (base de données), Resend (envoi des codes par e-mail) et,
              si tu acceptes la mesure d’audience, ntfy.sh. Certains peuvent traiter des données hors de l’Union européenne.
            </p>
          </Bloc>

          <Bloc titre="Tes droits">
            <p>
              Tu peux accéder à tes données, les rectifier, les exporter, t’opposer à leur traitement ou demander leur
              effacement en écrivant à <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Réglages permet d’exporter ta collection, de
              supprimer ton compte et de changer ton choix sur la mesure d’audience. Tu peux aussi saisir la{' '}
              <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noreferrer">CNIL</a>.
            </p>
          </Bloc>

          <div className="actions">
            <button className="btn btn-fantome" onClick={() => { window.location.hash = '' }}>
              Retour
            </button>
          </div>
        </section>
      </main>
    </>
  )
}
