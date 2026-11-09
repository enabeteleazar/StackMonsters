import { useState } from 'react'
import { api, ErreurAPI, jeton, NonAutorise } from '../api'
import { suivre } from '../suivi'

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
        setMessage('Trop de demandes. Réessaie dans une heure.')
      } else if (
        err instanceof ErreurAPI &&
        err.status === 503 &&
        (err.detail.includes('Resend') || err.detail.includes("d'e-mail non configuré"))
      ) {
        setMessage(
          "L'envoi e-mail n'est pas configuré correctement. Le site doit utiliser un expéditeur vérifié ; onboarding@resend.dev ne livre qu'à l'adresse du compte Resend.",
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
            ? 'Trop de tentatives. Réessaie dans une heure.'
            : 'Service injoignable.',
      )
      setCode('')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <section className="tableau-bord">
      <span className="eyebrow">StackMonster</span>
      <h1 className="tb-titre">
        Connexion
        <span>par e-mail</span>
      </h1>
      <p className="sous">
        {message ||
          (etape === 'email'
            ? refuse
              ? 'Ta session a expiré. Reconnecte-toi avec ton e-mail.'
              : 'Entre ton e-mail : tu recevras un code à 6 chiffres.'
            : `Code envoyé à ${email}. Il est valable 10 minutes.`)}
      </p>
      <div className="champs">
        {etape === 'email' ? (
          <div>
            <label htmlFor="f-email">E-mail</label>
            <input
              id="f-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && demander()}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="f-code">Code</label>
            <input
              id="f-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && verifier()}
            />
          </div>
        )}
      </div>
      <div className="actions">
        <button
          className="btn btn-primaire actions-principal"
          disabled={occupe}
          onClick={etape === 'email' ? demander : verifier}
        >
          {etape === 'email' ? 'Recevoir le code' : 'Se connecter'}
        </button>
        {etape === 'code' && (
          <button className="btn" onClick={() => { setEtape('email'); setCode(''); setMessage('') }}>
            Changer d&rsquo;e-mail
          </button>
        )}
        <button className="btn btn-retour-accueil" onClick={surRetour}>
          Retour à l&rsquo;accueil
        </button>
      </div>
    </section>
  )
}
