import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, ScanLine, UserRound, Wifi } from 'lucide-react'
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

  const tuiles = [
    { libelle: 'Utilisateurs', valeur: chiffres?.utilisateurs, Icone: UserRound },
    { libelle: 'Références', valeur: chiffres?.references, Icone: ScanLine },
    { libelle: 'Connexions uniques', valeur: chiffres?.connexions_uniques, Icone: Wifi },
  ]

  return (
    <section className="collec stats-page">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Statistiques <b>du service.</b>
          </h1>
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        {erreur && (
          <p className="reglages-alerte">Impossible de charger les statistiques (accès réservé au propriétaire).</p>
        )}

        <div className="stats-tuiles">
          {tuiles.map(({ libelle, valeur, Icone }) => (
            <div key={libelle} className="reglages-carte stats-tuile">
              <Icone size={20} />
              <b>{valeur ?? '—'}</b>
              <span>{libelle}</span>
            </div>
          ))}
        </div>

        <p className="page-note">
          Références : fiches distinctes par utilisateur. Les connexions uniques comptent les adresses IP
          ayant validé au moins une connexion depuis l’activation du suivi ; seule une empreinte HMAC est
          conservée. Plusieurs personnes partageant une IP comptent une fois, tandis qu’une IP dynamique
          peut compter plusieurs fois.
        </p>

        <div className="reglages-actions stats-actions">
          <button className="accueil-co-secondaire" onClick={charger} disabled={charge}>
            <RefreshCw size={18} />
            Actualiser
          </button>
          <button className="accueil-co-secondaire" onClick={surRetour}>
            <ArrowLeft size={18} />
            Retour
          </button>
        </div>
      </div>
    </section>
  )
}
