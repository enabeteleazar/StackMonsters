import { useState } from 'react'
import { reduirePhoto } from '../photo'
import { CANETTE_VIDE, ETATS, type Canette } from '../types'

type Props = {
  ean: string
  existante: Canette | null
  surEnregistrer: (c: Canette) => Promise<void>
  surIncrementer: (ean: string, delta: number) => Promise<void>
  surSupprimer: (ean: string) => Promise<void>
  surFermeture: () => void
}

export default function Verdict(p: Props) {
  const [edition, setEdition] = useState(!p.existante)
  const [occupe, setOccupe] = useState(false)

  const connue = !!p.existante
  const titre = connue ? 'Déjà dans la collection' : 'Nouvelle canette'
  const sous = connue
    ? `Ajoutée le ${new Date(p.existante!.ajout).toLocaleDateString('fr-FR')}`
    : 'Elle ne figure pas encore dans ta collection.'

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
      <div className={`bandeau ${connue ? 'connue' : 'nouvelle'}`}>
        <div className="ean">{p.ean}</div>
        <h2>{titre}</h2>
        <p>{sous}</p>
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
          <div className="fiche">
            {p.existante!.photo ? <img src={p.existante!.photo} alt="" /> : <img alt="" />}
            <div>
              <h3>{p.existante!.nom || 'Sans nom'}</h3>
              <small>
                {p.existante!.edition || '—'} · {p.existante!.volume || '—'} ·{' '}
                {p.existante!.etat}
              </small>
              <small>
                Tu en as {p.existante!.nb} exemplaire{p.existante!.nb > 1 ? 's' : ''}
              </small>
              {p.existante!.notes && <small>{p.existante!.notes}</small>}
            </div>
          </div>
          <div className="actions">
            <button
              className="primaire"
              disabled={occupe}
              onClick={() => proteger(() => p.surIncrementer(p.ean, 1))}
            >
              +1 exemplaire
            </button>
            <button className="neutre" onClick={() => setEdition(true)}>
              Modifier la fiche
            </button>
            <button className="neutre" onClick={p.surFermeture}>
              Scanner la suivante
            </button>
            <button
              className="neutre danger"
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
            <label htmlFor="f-edition">Édition</label>
            <input
              id="f-edition"
              value={c.edition}
              placeholder="France"
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
        <div className="duo">
          <div>
            <label htmlFor="f-etat">État</label>
            <select id="f-etat" value={c.etat} onChange={(e) => champ('etat', e.target.value)}>
              {ETATS.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-nb">Exemplaires</label>
            <input
              id="f-nb"
              type="number"
              min={1}
              value={c.nb}
              onChange={(e) => champ('nb', Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>
        <div>
          <label htmlFor="f-notes">Notes</label>
          <textarea
            id="f-notes"
            rows={2}
            value={c.notes}
            placeholder="Trouvée à Berlin, série 2024…"
            onChange={(e) => champ('notes', e.target.value)}
          />
        </div>
        <div className="photo-zone">
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
        <button className="primaire" disabled={occupe} onClick={() => surValider(c)}>
          {occupe ? 'Enregistrement…' : libelle}
        </button>
        <button className="neutre" onClick={surAnnuler}>
          Annuler
        </button>
      </div>
    </>
  )
}
