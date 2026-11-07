import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { api } from '../api'

type Chiffres = { utilisateurs: number; references: number; connexions_uniques: number }

type Props = {
  surRetour: () => void
}

export default function Stats({ surRetour }: Props) {
  const [chiffres, setChiffres] = useState<Chiffres | null>(null)
  const [erreur, setErreur] = useState(false)
  const [charge, setCharge] = useState(false)

  const charger = () => {
    setCharge(true)
    api
      .stats()
      .then((c) => {
        setChiffres(c)
        setErreur(false)
      })
      .catch(() => setErreur(true))
      .finally(() => setCharge(false))
  }

  useEffect(charger, [])

  return (
    <section>
      <span className="eyebrow">StackMonster</span>
      <h1 className="tb-titre" style={{ fontSize: 'clamp(26px,7vw,34px)' }}>
        Statistiques
      </h1>

      {erreur && (
        <p className="sous">Impossible de charger les statistiques (accès réservé au propriétaire).</p>
      )}

      <div className="stats">
        <div className="stat">
          <b>{chiffres ? chiffres.utilisateurs : '—'}</b>
          <span>Utilisateurs</span>
        </div>
        <div className="stat">
          <b>{chiffres ? chiffres.references : '—'}</b>
          <span>Références</span>
        </div>
        <div className="stat">
          <b>{chiffres ? chiffres.connexions_uniques : '—'}</b>
          <span>Connexions uniques</span>
        </div>
      </div>

      <p className="sous">
        Références : fiches distinctes par utilisateur. Les connexions uniques comptent les adresses IP
        ayant validé au moins une connexion depuis l’activation du suivi ; seule une empreinte HMAC est
        conservée. Plusieurs personnes partageant une IP comptent une fois, tandis qu’une IP dynamique
        peut compter plusieurs fois.
      </p>

      <div className="outils">
        <button onClick={surRetour}>
          <ArrowLeft size={15} />
          Retour
        </button>
        <button onClick={charger} disabled={charge}>
          <RefreshCw size={15} />
          Actualiser
        </button>
      </div>
    </section>
  )
}
