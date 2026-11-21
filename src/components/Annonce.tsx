import { useEffect, useState } from 'react'
import { Bell, Megaphone } from 'lucide-react'
import { activerNotifications, notificationsActives, notificationsPossibles } from '../notifications'

type Props = {
  annonce: { id: number; texte: string; cree: number }
  surFermeture: () => void
}

/** Popup du message du propriétaire à tous, affichée une fois par compte à l'ouverture de l'appli. */
export default function Annonce({ annonce, surFermeture }: Props) {
  // Proposer les notifications sur un appareil qui peut les recevoir et ne les a pas encore activées.
  const [proposer, setProposer] = useState(false)
  useEffect(() => {
    if (notificationsPossibles() && Notification.permission === 'default') {
      notificationsActives().then((a) => setProposer(!a)).catch(() => {})
    }
  }, [])

  return (
    <div className="filtres-fond annonce-fond">
      <section className="annonce" role="dialog" aria-modal="true" aria-labelledby="annonce-titre">
        <span className="annonce-icone" aria-hidden="true">
          <Megaphone size={26} />
        </span>
        <h2 id="annonce-titre">Message de StackMonsters</h2>
        <p className="annonce-texte">{annonce.texte}</p>
        <div className="annonce-actions">
          {proposer && (
            <button
              className="btn btn-fantome"
              onClick={() => {
                void activerNotifications().finally(surFermeture)
              }}
            >
              <Bell size={17} /> Recevoir les prochains en notification
            </button>
          )}
          <button className="btn btn-primaire" onClick={surFermeture}>
            OK
          </button>
        </div>
      </section>
    </div>
  )
}
