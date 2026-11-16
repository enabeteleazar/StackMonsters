import { useMemo, useState } from 'react'
import { ChevronRight, PackageSearch, Search } from 'lucide-react'
import type { Canette } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  canettes: Canette[]
  surOuvrir: (ean: string) => void
}

type Tri = 'recent' | 'nom'

const TRIS: { valeur: Tri; libelle: string }[] = [
  { valeur: 'recent', libelle: 'Récentes' },
  { valeur: 'nom', libelle: 'A → Z' },
]

/** Collection du compte, en liste (photo à gauche, nom à droite), dans l'univers de la landing page. */
export default function Collection({ canettes, surOuvrir }: Props) {
  const [q, setQ] = useState('')
  const [tri, setTri] = useState<Tri>('recent')

  const vues = useMemo(() => {
    const t = q.trim().toLowerCase()
    const filtrees = canettes.filter((c) => !t || c.nom.toLowerCase().includes(t) || c.ean.includes(t))
    return filtrees.sort((a, b) => {
      if (tri === 'nom') return a.nom.localeCompare(b.nom)
      return b.ajout.localeCompare(a.ajout)
    })
  }, [canettes, q, tri])

  return (
    <section className="collec">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Ma collection <b>Monster.</b>
          </h1>
          <p className="collec-compte">
            <b>{canettes.length}</b> référence{canettes.length > 1 ? 's' : ''}
          </p>
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        <div className="collec-outils">
          <label className="collec-recherche">
            <Search size={18} />
            <input
              value={q}
              name="recherche"
              type="search"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Chercher un nom"
              aria-label="Chercher un nom"
            />
          </label>
          <div className="collec-tri" role="radiogroup" aria-label="Trier">
            {TRIS.map((t) => (
              <button
                key={t.valeur}
                role="radio"
                aria-checked={tri === t.valeur}
                onClick={() => setTri(t.valeur)}
              >
                {t.libelle}
              </button>
            ))}
          </div>
        </div>

        {vues.length ? (
          <ul className="collec-liste">
            {vues.map((c) => (
              <li key={c.ean}>
                <button className="collec-ligne" onClick={() => surOuvrir(c.ean)}>
                  <span className="collec-photo">
                    <PhotoWiki source="collection" ean={c.ean} version={c.photo_version} taille={20} />
                  </span>
                  <span className="collec-nom">{c.nom || 'Sans nom'}</span>
                  <ChevronRight size={20} className="collec-chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="collec-vide">
            <PackageSearch size={34} />
            {canettes.length
              ? 'Aucune canette ne correspond à cette recherche.'
              : "Rien ici pour l'instant. Scanne ta première canette."}
          </p>
        )}
      </div>
    </section>
  )
}
