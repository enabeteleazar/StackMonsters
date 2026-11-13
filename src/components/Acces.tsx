import { useState } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, Mail } from 'lucide-react'
import { api, ErreurAPI, jeton, NonAutorise } from '../api'
import { suivre } from '../suivi'

/** Message unique pour toutes les limites (demandes de code, essais, adresse IP). */
function messageLimite(err: ErreurAPI): string {
  if (!err.attente) return 'Trop de tentatives. Réessaie dans une heure.'
  const minutes = Math.ceil(err.attente / 60)
  return `Trop de tentatives. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
}

type Props = {
  /** Appelé après connexion : le parent recharge la collection. */
  surValider: (email: string) => void
  surRetour: () => void
  /** Vrai quand une session existante a été rejetée (expirée, révoquée). */
  refuse: boolean
}

export default function Acces({ surValider, surRetour, refuse }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [etape, setEtape] = useState<'email' | 'code'>('email')
  const [message, setMessage] = useState('')
  const [occupe, setOccupe] = useState(false)

  const demander = async () => {
    const e = email.trim().toLowerCase()
    if (!e || occupe) return
    setOccupe(true)
    setMessage('')
    try {
      await api.demande(e)
      setEmail(e)
      setEtape('code')
    } catch (err) {
      if (err instanceof ErreurAPI && err.status === 429) {
        setMessage(messageLimite(err))
      } else if (
        err instanceof ErreurAPI &&
        err.status === 503 &&
        (err.detail.includes('Resend') || err.detail.includes("d'e-mail non configuré"))
      ) {
        setMessage(
          "L'envoi e-mail n'est pas configuré correctement. Le site doit utiliser un expéditeur vérifié ; onboarding@resend.dev ne livre qu'à l'adresse du compte Resend.",
        )
      } else if (err instanceof ErreurAPI && err.status === 422) {
        setMessage("Adresse e-mail refusée. Vérifie l'adresse et réessaie.")
      } else {
        setMessage("Envoi impossible. Vérifie l’adresse et réessaie.")
      }
    } finally {
      setOccupe(false)
    }
  }

  const verifier = async () => {
    const c = code.trim()
    if (!c || occupe) return
    setOccupe(true)
    setMessage('')
    try {
      const r = await api.verification(email, c)
      jeton.ecrire(r.token)
      suivre('connection')
      surValider(r.email)
    } catch (err) {
      setMessage(
        err instanceof NonAutorise
          ? 'Code invalide ou expiré.'
          : err instanceof ErreurAPI && err.status === 429
            ? messageLimite(err)
            : 'Service injoignable.',
      )
      setCode('')
    } finally {
      setOccupe(false)
    }
  }

  const etapeCode = etape === 'code'
  const information =
    message ||
    (etapeCode
      ? `Code envoyé à ${email}. Il est valable 10 minutes.`
      : refuse
        ? 'Ta session a expiré. Reconnecte-toi avec ton e-mail.'
        : 'Entre ton e-mail : tu recevras un code à 6 chiffres.')

  return (
    <div className="connexion">
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

      <main className="connexion-contenu">
        <span className="connexion-fumee" aria-hidden="true" />
        <h1 className="connexion-titre">
          Connexion <b>par e-mail.</b>
        </h1>
        <span className="accueil-public-trait" aria-hidden="true" />

        <ol className="connexion-etapes" aria-label="Étapes de connexion">
          <li aria-current={!etapeCode ? 'step' : undefined}>
            <Mail size={16} /> E-mail
          </li>
          <li aria-current={etapeCode ? 'step' : undefined}>
            <KeyRound size={16} /> Code
          </li>
        </ol>

        <div className="connexion-carte">
          <p className={message ? 'connexion-info connexion-info-alerte' : 'connexion-info'} role={message ? 'alert' : undefined}>
            {information}
          </p>
          {etapeCode ? (
            <div className="connexion-champ">
              <label htmlFor="f-code">Code reçu</label>
              <input
                id="f-code"
                className="connexion-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && verifier()}
              />
            </div>
          ) : (
            <div className="connexion-champ">
              <label htmlFor="f-email">E-mail</label>
              <input
                id="f-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                placeholder="toi@exemple.fr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && demander()}
              />
            </div>
          )}

          <button
            className="accueil-public-cta connexion-cta"
            disabled={occupe}
            onClick={etapeCode ? verifier : demander}
          >
            {etapeCode ? <KeyRound size={22} strokeWidth={1.8} /> : <Mail size={22} strokeWidth={1.8} />}
            <span className="accueil-public-cta-separateur" aria-hidden="true" />
            {occupe ? 'Patiente…' : etapeCode ? 'Se connecter' : 'Recevoir le code'}
            <ArrowRight size={22} />
          </button>

          {etapeCode && (
            <button className="connexion-lien" onClick={() => { setEtape('email'); setCode(''); setMessage('') }}>
              Changer d&rsquo;e-mail
            </button>
          )}
        </div>

        <button className="connexion-lien connexion-retour" onClick={surRetour}>
          <ArrowLeft size={16} /> Retour à l&rsquo;accueil
        </button>
      </main>
    </div>
  )
}
