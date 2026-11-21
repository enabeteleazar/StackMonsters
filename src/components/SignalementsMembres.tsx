import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Flag, RefreshCw } from 'lucide-react'
import { api, NonAutorise } from '../api'
import type { SignalementMembre } from '../types'

type Props = {
  surRetour: () => void
  surNonAutorise: () => void
}

const dateCourte = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Propriétaire : signalements de membres envoyés depuis la messagerie, avec la conversation concernée.
 * Les membres n'y sont désignés que par leur rôle et un numéro interne, jamais par leur adresse.
 */
export default function SignalementsMembres({ surRetour, surNonAutorise }: Props) {
  const [liste, setListe] = useState<SignalementMembre[] | null>(null)
  const [erreur, setErreur] = useState(false)
  const [occupe, setOccupe] = useState<number | null>(null)

  const charger = useCallback(async () => {
    try {
      setListe(await api.signalementsMembres())
      setErreur(false)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(true)
    }
  }, [surNonAutorise])

  useEffect(() => {
    void charger()
  }, [charger])

  const traite = async (id: number) => {
    setOccupe(id)
    try {
      await api.signalementMembreTraite(id)
      setListe((l) => l?.filter((s) => s.id !== id) ?? null)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(true)
    } finally {
      setOccupe(null)
    }
  }

  return (
    <section className="collec stats-page">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Signalements <b>de membres.</b>
          </h1>
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        {erreur && <p className="reglages-alerte">Impossible de charger les signalements (accès réservé au propriétaire).</p>}
        {liste === null && !erreur && <p className="collec-vide">Chargement…</p>}
        {liste?.length === 0 && (
          <p className="collec-vide">
            <Flag size={34} />
            Aucun signalement à examiner.
          </p>
        )}

        <ul className="echanges-liste">
          {liste?.map((s) => (
            <li key={s.id} className="reglages-carte signalement-membre">
              <p className="signalement-membre-tete">
                <b>{s.motif}</b> · {s.canette} · {dateCourte(s.cree)}
              </p>
              {s.detail && <p className="signalement-membre-detail">« {s.detail} »</p>}
              <p className="sous">
                Membre signalé n° {s.membre_signale} ({s.signalements_du_membre} signalement
                {s.signalements_du_membre > 1 ? 's' : ''} en tout)
              </p>
              <div className="conversation-fil signalement-membre-fil">
                {s.messages.length ? (
                  s.messages.map((m, i) => (
                    <p key={i} className={`bulle${m.de === 'auteur' ? ' moi' : ''}`}>
                      <span className="sr-only">{m.de === 'auteur' ? 'Auteur du signalement : ' : 'Membre signalé : '}</span>
                      {m.texte}
                    </p>
                  ))
                ) : (
                  <p className="conversation-note">Aucun message dans cette conversation.</p>
                )}
              </div>
              <p className="conversation-note">À droite : l’auteur du signalement. À gauche : le membre signalé.</p>
              <button className="accueil-co-secondaire" disabled={occupe === s.id} onClick={() => void traite(s.id)}>
                <Check size={18} /> Marquer comme traité
              </button>
            </li>
          ))}
        </ul>

        <div className="reglages-actions stats-actions">
          <button className="accueil-co-secondaire" onClick={() => void charger()}>
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
