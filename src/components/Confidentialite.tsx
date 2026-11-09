import { CONTACT, MISE_A_JOUR_CONFIDENTIALITE, RESPONSABLE } from '../config'
import Logo from './Logo'

const Bloc = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
  <div className="reglages-groupe">
    <div className="section-titre">
      <h2>{titre}</h2>
    </div>
    <div className="sous">{children}</div>
  </div>
)

const Contact = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>

/** Politique de confidentialité et mentions légales, rédigées selon les recommandations de la CNIL. */
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
          <p className="sous">Dernière mise à jour : {MISE_A_JOUR_CONFIDENTIALITE}.</p>

          <Bloc titre="Qui est responsable ?">
            <p>
              Le responsable du traitement est {RESPONSABLE}, éditeur de StackMonster à titre personnel. Pour toute
              question sur tes données ou pour exercer tes droits : <Contact />.
            </p>
          </Bloc>

          <Bloc titre="Quelles données, pourquoi, sur quelle base ?">
            <ul>
              <li>
                <b>Compte</b> — adresse e-mail, code de connexion temporaire, jeton de session. But : te connecter
                sans mot de passe. Base : exécution du service que tu demandes. L’e-mail est indispensable pour créer
                un compte.
              </li>
              <li>
                <b>Collection</b> — canettes, quantités, états, notes et photos. But : gérer ta collection privée,
                visible de toi seul. Base : exécution du service. Les photos sont réduites et leurs métadonnées
                (position, appareil) supprimées avant l’envoi.
              </li>
              <li>
                <b>Sécurité</b> — empreintes chiffrées (HMAC) des adresses IP, jamais l’adresse en clair. But :
                limiter les abus de connexion et compter les connexions uniques. Base : intérêt légitime à protéger le
                service.
              </li>
              <li>
                <b>Mesure d’audience</b>, seulement si tu l’acceptes — type de visite, d’appareil, provenance et
                identifiant aléatoire. But : savoir comment le service est utilisé. Base : ton consentement, que tu
                peux retirer à tout moment dans Réglages.
              </li>
            </ul>
            <p>Aucune décision automatisée n’est prise à partir de tes données, et elles ne sont ni vendues ni louées.</p>
          </Bloc>

          <Bloc titre="Le Wiki partagé">
            <p>
              Le nom, la version, le volume, la catégorie, la saveur, le statut et la région d’une canette avec
              code-barres alimentent un catalogue visible des comptes connectés, sans aucun lien avec ton compte. Tes
              photos, notes, quantités, états et canettes sans code-barres n’y sont jamais envoyés.
            </p>
          </Bloc>

          <Bloc titre="Combien de temps ?">
            <ul>
              <li>Compte et collection : jusqu’à la suppression du compte.</li>
              <li>Sessions : 30 jours au plus, ou jusqu’à la déconnexion.</li>
              <li>Codes de connexion et compteurs de limitation : une heure environ.</li>
              <li>Empreintes d’IP des connexions uniques : 13 mois.</li>
              <li>Ton choix sur la mesure d’audience : 6 mois s’il s’agit d’un refus, 13 mois pour un accord ; la
                question t’est ensuite reposée.</li>
            </ul>
          </Bloc>

          <Bloc titre="Ce qui est enregistré sur ton appareil">
            <p>StackMonster n’utilise pas de cookie. Il conserve dans le stockage de ton navigateur :</p>
            <ul>
              <li>ton jeton de session — indispensable pour rester connecté ;</li>
              <li>une copie de ta collection et des photos déjà affichées — pour l’usage hors ligne ;</li>
              <li>ton choix sur la mesure d’audience et sa date ;</li>
              <li>un identifiant aléatoire de mesure — seulement après ton accord, effacé si tu le retires.</li>
            </ul>
            <p>« Se déconnecter » efface le jeton et la copie hors ligne de ta collection.</p>
          </Bloc>

          <Bloc titre="Qui traite les données ?">
            <ul>
              <li>Vercel Inc. — hébergement du site et de l’API, mesure d’audience.</li>
              <li>Neon Inc. — base de données.</li>
              <li>Resend — envoi des codes de connexion par e-mail.</li>
              <li>ntfy.sh — réception des événements de mesure d’audience, si tu l’acceptes.</li>
            </ul>
            <p>
              La base de données et l’API sont hébergées aux États-Unis. Ces transferts hors de l’Union européenne
              s’appuient sur les garanties prévues par le RGPD : décision d’adéquation (Data Privacy Framework) pour
              les prestataires certifiés, ou clauses contractuelles types de la Commission européenne. Tu peux en
              obtenir le détail en écrivant à <Contact />.
            </p>
          </Bloc>

          <Bloc titre="Tes droits">
            <p>
              Tu peux accéder à tes données, les rectifier, les effacer, demander leur portabilité ou la limitation de
              leur traitement, t’opposer au traitement fondé sur l’intérêt légitime, retirer ton consentement et
              définir des directives sur le sort de tes données après ton décès.
            </p>
            <p>
              Dans Réglages, tu peux exporter ta collection, supprimer ton compte et changer ton choix sur la mesure
              d’audience. Pour le reste, écris à <Contact /> : une réponse est apportée dans un délai d’un mois.
            </p>
            <p>
              Si tu estimes que tes droits ne sont pas respectés, tu peux adresser une réclamation à la{' '}
              <a href="https://www.cnil.fr/fr/adresser-une-plainte" target="_blank" rel="noreferrer">CNIL</a>.
            </p>
          </Bloc>

          <Bloc titre="Mentions légales">
            <ul>
              <li>Éditeur et directeur de la publication : {RESPONSABLE}, particulier — <Contact />.</li>
              <li>Hébergeur : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.</li>
            </ul>
            <p>
              StackMonster est un projet indépendant, non affilié à Monster Energy. Les marques citées appartiennent à
              leurs propriétaires.
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
