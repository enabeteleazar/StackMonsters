import { useState } from 'react'
import { Camera as CameraIcon, CheckCircle2, ImageOff, Sparkles, X } from 'lucide-react'
import { reduirePhoto } from '../photo'
import { CANETTE_VIDE, type Canette } from '../types'

type Props = {
  ean: string
  existante: Canette | null
  surEnregistrer: (c: Canette) => Promise<void>
  surSupprimer: (ean: string) => Promise<void>
  surFermeture: () => void
}

export default function Verdict(p: Props) {
  const [edition, setEdition] = useState(!p.existante)
  const [occupe, setOccupe] = useState(false)

  const connue = !!p.existante
  const titre = connue ? p.existante!.nom || 'Déjà dans la collection' : 'Nouvelle canette'

  const proteger = async (action: () => Promise<void>) => {
    setOccupe(true)
    try {
      await action()
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="verdict">
      <div className="photo-hero">
        {!edition && p.existante?.photo ? (
          <img src={p.existante.photo} alt="" />
        ) : (
          <div className="ph-vide">
            <ImageOff size={34} />
            <span>Pas de photo</span>
          </div>
        )}
        <button className="btn-icone fermer" onClick={p.surFermeture} aria-label="Fermer">
          <X size={20} />
        </button>
        {!edition && (
          <span className={`badge ${connue ? 'badge-possede' : 'badge-nouveau'} badge-etat`}>
            {connue ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
            {connue ? 'Possédée' : 'Nouvelle'}
          </span>
        )}
      </div>

      <div className="verdict-scroll">
        <div className="bandeau-info">
          <div className="ean">{p.ean}</div>
          <h2>{titre}</h2>
          {!edition && (
            <p>
              Ajoutée le {new Date(p.existante!.ajout).toLocaleDateString('fr-FR')}
            </p>
          )}
        </div>

        {edition ? (
          <Formulaire
            depart={p.existante ?? CANETTE_VIDE(p.ean)}
            occupe={occupe}
            libelle={connue ? 'Enregistrer' : 'Ajouter à la collection'}
            surValider={(c) => proteger(() => p.surEnregistrer(c))}
            surAnnuler={() => (connue ? setEdition(false) : p.surFermeture())}
          />
        ) : (
          <>
            <div className="meta-grille">
              <div className="meta-item">
                <span>Version</span>
                <b>{p.existante!.edition || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Volume</span>
                <b>{p.existante!.volume || '—'}</b>
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-fantome" onClick={() => setEdition(true)}>
                Modifier la fiche
              </button>
              <button className="btn btn-fantome" onClick={p.surFermeture}>
                Scanner la suivante
              </button>
              <button
                className="btn btn-fantome btn-danger"
                disabled={occupe}
                onClick={() => {
                  if (confirm('Retirer définitivement cette canette ?'))
                    proteger(() => p.surSupprimer(p.ean))
                }}
              >
                Retirer de la collection
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Formulaire({
  depart,
  occupe,
  libelle,
  surValider,
  surAnnuler,
}: {
  depart: Canette
  occupe: boolean
  libelle: string
  surValider: (c: Canette) => void
  surAnnuler: () => void
}) {
  const [c, setC] = useState<Canette>(depart)
  const champ = <K extends keyof Canette>(k: K, v: Canette[K]) =>
    setC((prec) => ({ ...prec, [k]: v }))

  return (
    <>
      <div className="champs">
        <div>
          <label htmlFor="f-nom">Nom</label>
          <input
            id="f-nom"
            value={c.nom}
            placeholder="Monster Mango Loco"
            onChange={(e) => champ('nom', e.target.value)}
          />
        </div>
        <div className="duo">
          <div>
            <label htmlFor="f-edition">Version</label>
            <input
              id="f-edition"
              value={c.edition}
              placeholder="Ultra White"
              onChange={(e) => champ('edition', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-volume">Volume</label>
            <input
              id="f-volume"
              value={c.volume}
              placeholder="500 ml"
              onChange={(e) => champ('volume', e.target.value)}
            />
          </div>
        </div>
        <div className="photo-zone">
          <CameraIcon size={22} />
          Photo de la canette (facultatif)
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Photo de la canette"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) champ('photo', await reduirePhoto(f))
            }}
          />
          {c.photo && <img src={c.photo} alt="" />}
        </div>
      </div>
      <div className="actions">
        <button className="btn btn-primaire actions-principal" disabled={occupe} onClick={() => surValider(c)}>
          {occupe ? 'Enregistrement…' : libelle}
        </button>
        <button className="btn btn-fantome" onClick={surAnnuler}>
          Annuler
        </button>
      </div>
    </>
  )
}
