import { Repeat2 } from 'lucide-react'

type Props = {
  texte: string
  surVoir: () => void
  surFermeture: () => void
}

/** Nouvelle notification d'échange, affichée une fois en popup dans l'appli (elle reste dans l'onglet Notifications). */
export default function PopupEchange({ texte, surVoir, surFermeture }: Props) {
  return (
    <div className="filtres-fond annonce-fond">
      <section className="annonce" role="dialog" aria-modal="true" aria-labelledby="popup-echange-titre">
        <span className="annonce-icone" aria-hidden="true">
          <Repeat2 size={26} />
        </span>
        <h2 id="popup-echange-titre">Échanges</h2>
        <p className="annonce-texte">{texte}</p>
        <div className="annonce-actions">
          <button className="btn btn-primaire" onClick={surVoir}>
            Voir
          </button>
          <button className="btn btn-fantome" onClick={surFermeture}>
            OK
          </button>
        </div>
      </section>
    </div>
  )
}
