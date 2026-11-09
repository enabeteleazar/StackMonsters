import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { consentement, definirConsentement, EVENEMENT_CONSENTEMENT, initSuivi, type Consentement as Choix } from '../suivi'

/** Bandeau de consentement : la mesure d'audience ne se charge qu'après un « Accepter ». */
export default function Consentement() {
  const [choix, setChoix] = useState<Choix>(consentement)

  useEffect(() => {
    const maj = (e: Event) => {
      const valeur = (e as CustomEvent<'oui' | 'non'>).detail
      setChoix(valeur)
      if (valeur === 'oui') initSuivi()
      // Un retrait doit aussi arrêter la mesure déjà chargée dans la page.
      else if (choix === 'oui') window.location.reload()
    }
    window.addEventListener(EVENEMENT_CONSENTEMENT, maj)
    return () => window.removeEventListener(EVENEMENT_CONSENTEMENT, maj)
  }, [choix])

  if (!import.meta.env.PROD) return null
  if (choix === 'oui') return <Analytics />
  if (choix === 'non') return null
  return (
    <aside className="consentement" aria-label="Consentement à la mesure d'audience">
      <p>
        StackMonster aimerait mesurer son audience (visites, type d’appareil, provenance). Rien n’est envoyé sans ton
        accord. <a href="#confidentialite">En savoir plus</a>
      </p>
      <div>
        <button className="btn btn-fantome" onClick={() => definirConsentement('non')}>Refuser</button>
        <button className="btn btn-primaire" onClick={() => definirConsentement('oui')}>Accepter</button>
      </div>
    </aside>
  )
}
