import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import type { FicheWiki as Fiche, ModifFicheWiki } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  fiche: Fiche
  peutEditer: boolean
  surFermeture: () => void
  surEnregistree: (eanOriginal: string, f: Fiche) => void
  surSupprimee: (ean: string) => void
  surNonAutorise: () => void
}

export default function FicheWiki({
  fiche,
  peutEditer,
  surFermeture,
  surEnregistree,
  surSupprimee,
  surNonAutorise,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [suppressionOccupe, setSuppressionOccupe] = useState(false)
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null)

  const supprimer = async () => {
    if (!confirm(`Supprimer la fiche « ${fiche.nom || fiche.ean} » du Wiki ? Cette action ne supprime pas les canettes des collections.`)) return
    setSuppressionOccupe(true)
    setErreurSuppression(null)
    try {
      await api.wikiSupprimer(fiche.ean)
      surSupprimee(fiche.ean)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurSuppression(
        e instanceof ErreurAPI ? `Suppression refusée — ${e.detail}` : 'Suppression impossible, réessaie.',
      )
      setSuppressionOccupe(false)
    }
  }

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermeture()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  return (
    <div className="verdict" role="dialog" aria-modal="true" aria-label={fiche.nom || 'Fiche de canette'}>
      <div className="photo-hero">
        <PhotoWiki ean={fiche.ean} version={fiche.photo} taille={34} legende="Pas de photo" />
        <button className="btn-icone fermer" onClick={surFermeture} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      <div className="verdict-scroll">
        <div className="bandeau-info">
          <div className="ean">{fiche.ean}</div>
          <h2>{fiche.nom || 'Sans nom'}</h2>
        </div>

        {edition ? (
          <Formulaire
            fiche={fiche}
            surAnnuler={() => setEdition(false)}
            surEnregistree={(f) => {
              surEnregistree(fiche.ean, f)
              setEdition(false)
            }}
            surNonAutorise={surNonAutorise}
          />
        ) : (
          <>
            <div className="meta-grille">
              <div className="meta-item">
                <span>Version</span>
                <b>{fiche.edition || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Volume</span>
                <b>{fiche.volume || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Pays de sortie</span>
                <b>{fiche.pays || '—'}</b>
              </div>
            </div>

            <div className="fiche-description">
              <span className="etiquette">Description</span>
              {fiche.description ? (
                <p>{fiche.description}</p>
              ) : (
                <p className="fiche-description-vide">Pas encore de description pour cette canette.</p>
              )}
            </div>

            {peutEditer && (
              <div className="actions">
                <button className="btn btn-fantome" disabled={suppressionOccupe} onClick={() => setEdition(true)}>
                  Modifier la fiche
                </button>
                <button
                  className="btn btn-fantome btn-danger"
                  disabled={suppressionOccupe}
                  onClick={() => void supprimer()}
                >
                  <Trash2 size={17} />
                  {suppressionOccupe ? 'Suppression…' : 'Supprimer la fiche du Wiki'}
                </button>
                {erreurSuppression && <p className="sous" role="alert">{erreurSuppression}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Formulaire({
  fiche,
  surAnnuler,
  surEnregistree,
  surNonAutorise,
}: {
  fiche: Fiche
  surAnnuler: () => void
  surEnregistree: (f: Fiche) => void
  surNonAutorise: () => void
}) {
  const [f, setF] = useState<ModifFicheWiki>({
    ean: fiche.ean,
    nom: fiche.nom,
    edition: fiche.edition,
    volume: fiche.volume,
    pays: fiche.pays,
    description: fiche.description,
  })
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const champ = <K extends keyof ModifFicheWiki>(k: K, v: ModifFicheWiki[K]) => setF((p) => ({ ...p, [k]: v }))

  const valider = async () => {
    setOccupe(true)
    setErreur(null)
    try {
      surEnregistree(await api.wikiModifier(fiche.ean, f))
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(e instanceof ErreurAPI ? `Enregistrement refusé — ${e.detail}` : 'Enregistrement impossible, réessaie.')
      setOccupe(false)
    }
  }

  return (
    <>
      <div className="champs">
        <div>
          <label htmlFor="w-edition">Version</label>
          <input
            id="w-edition"
            value={f.edition}
            maxLength={200}
            placeholder="Ultra White"
            onChange={(e) => champ('edition', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="w-ean">Code-barres</label>
          <input
            id="w-ean"
            value={f.ean}
            maxLength={64}
            required
            onChange={(e) => champ('ean', e.target.value.trim())}
          />
        </div>
        <div>
          <label htmlFor="w-nom">Nom</label>
          <input id="w-nom" value={f.nom} maxLength={200} onChange={(e) => champ('nom', e.target.value)} />
        </div>
        <div className="duo">
          <div>
            <label htmlFor="w-volume">Volume</label>
            <input
              id="w-volume"
              value={f.volume}
              maxLength={40}
              placeholder="500 ml"
              onChange={(e) => champ('volume', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="w-pays">Pays de sortie</label>
            <input
              id="w-pays"
              value={f.pays}
              maxLength={80}
              placeholder="États-Unis"
              onChange={(e) => champ('pays', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label htmlFor="w-description">Description</label>
          <textarea
            id="w-description"
            rows={7}
            value={f.description}
            maxLength={4000}
            onChange={(e) => champ('description', e.target.value)}
          />
        </div>
      </div>
      {erreur && (
        <p className="sous" role="alert">
          {erreur}
        </p>
      )}
      <div className="actions">
        <button className="btn btn-primaire actions-principal" disabled={occupe} onClick={valider}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn btn-fantome" disabled={occupe} onClick={surAnnuler}>
          Annuler
        </button>
      </div>
    </>
  )
}
