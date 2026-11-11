import { useMemo, useState } from 'react'
import { PackageSearch, Search } from 'lucide-react'
import type { Canette } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  canettes: Canette[]
  surOuvrir: (ean: string) => void
}

type Tri = 'recent' | 'nom'

export default function Collection({ canettes, surOuvrir }: Props) {
  const [q, setQ] = useState('')
  const [tri, setTri] = useState<Tri>('recent')

  const vues = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtrees = canettes
      .filter((c) => !t || c.nom.toLowerCase().includes(t) || c.ean.includes(t))
    return filtrees.sort((a, b) => {
      if (tri === 'nom') return a.nom.localeCompare(b.nom)
      return b.ajout.localeCompare(a.ajout)
    })
  }, [canettes, q, tri])

  return (
    <section>
      <span className="eyebrow">Collection</span>
      <div className="stats">
        <div className="stat">
          <b>{canettes.length}</b>
          <span>Références</span>
        </div>
      </div>

      <div className="filtres">
        <div className="recherche">
          <Search size={16} />
          <input
            value={q}
            name="recherche"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher un nom"
            aria-label="Chercher un nom"
          />
        </div>
        <select value={tri} name="tri" onChange={(e) => setTri(e.target.value as Tri)} aria-label="Trier">
          <option value="recent">Plus récentes</option>
          <option value="nom">Nom A→Z</option>
        </select>
      </div>

      {vues.length ? (
        <div className="grille-collection">
          {vues.map((c) => (
            <button key={c.ean} className="carte-canette" onClick={() => surOuvrir(c.ean)}>
              <div className="carte-photo">
                <PhotoWiki source="collection" ean={c.ean} version={c.photo_version} />
              </div>
              <div className="carte-corps">
                <span className="nom">{c.nom || 'Sans nom'}</span>
                <span className="meta">
                  {[c.volume, c.categorie].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="vide">
          <PackageSearch size={30} />
          Rien ici pour l'instant. Scanne ta première canette.
        </p>
      )}
    </section>
  )
}
