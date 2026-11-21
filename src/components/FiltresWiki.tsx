import { useEffect } from 'react'
import { X } from 'lucide-react'
import { CATEGORIES, REGIONS, VARIANTES } from '../categories'
import type { TriWiki } from '../types'

/** Valeur du filtre de gamme pour les fiches sans catégorie (aucune catégorie ne porte ce nom). */
export const SANS_CATEGORIE = '__sans__'
/** Valeur du filtre de gamme pour les fiches au statut Nouveauté (30 jours), toutes catégories confondues. */
export const NOUVEAUTES = '__nouveautes__'

export const TRIS: { valeur: TriWiki; libelle: string }[] = [
  { valeur: 'pertinence', libelle: 'Pertinence' },
  { valeur: 'nom', libelle: 'Nom A → Z' },
  { valeur: 'recent', libelle: 'Plus récentes' },
]

export const libelleGamme = (g: string) => (g === SANS_CATEGORIE ? 'Sans catégorie' : g === NOUVEAUTES ? 'Nouveautés' : g)

export type Filtres = { gamme: string; region: string; variante: string; tri: TriWiki }

type Props = Filtres & {
  /** Propriétaire : la gamme « Sans catégorie » est proposée. */
  proprietaire: boolean
  /** Nombre de fiches qui correspondent (mis à jour à chaque choix) ; null pendant le chargement. */
  total: number | null
  surChange: (f: Partial<Filtres>) => void
  surEffacer: () => void
  surFermeture: () => void
}

/** Une rangée de pastilles à choix unique (gamme, pays, variante, tri). */
function Choix({ titre, valeurs, valeur, libelle, surChoix }: {
  titre: string
  valeurs: readonly string[]
  valeur: string
  libelle: (v: string) => string
  surChoix: (v: string) => void
}) {
  return (
    <fieldset className="filtres-groupe">
      <legend>{titre}</legend>
      <div role="radiogroup" aria-label={titre}>
        {valeurs.map((v) => (
          <button key={v || 'tous'} type="button" role="radio" aria-checked={valeur === v} onClick={() => surChoix(v)}>
            {libelle(v)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Panneau des filtres du Wiki, qui monte du bas de l'écran : gamme, pays, variante et tri. */
export default function FiltresWiki({ gamme, region, variante, tri, proprietaire, total, surChange, surEffacer, surFermeture }: Props) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermeture()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  return (
    <div className="filtres-fond" onClick={surFermeture}>
      <section
        className="filtres-panneau"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filtres-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="filtres-tete">
          <h2 id="filtres-titre">Filtres</h2>
          <button type="button" className="filtres-fermer" aria-label="Fermer les filtres" onClick={surFermeture}>
            <X size={20} />
          </button>
        </div>

        <div className="filtres-corps">
          <Choix
            titre="Gamme"
            valeurs={['', NOUVEAUTES, ...CATEGORIES, ...(proprietaire ? [SANS_CATEGORIE] : [])]}
            valeur={gamme}
            libelle={(v) => (v ? libelleGamme(v) : 'Toutes')}
            surChoix={(v) => surChange({ gamme: v })}
          />
          <Choix
            titre="Pays"
            valeurs={['', ...REGIONS]}
            valeur={region}
            libelle={(v) => v || 'Tous'}
            surChoix={(v) => surChange({ region: v })}
          />
          <Choix
            titre="Variante"
            valeurs={['', ...VARIANTES]}
            valeur={variante}
            libelle={(v) => v || 'Toutes'}
            surChoix={(v) => surChange({ variante: v })}
          />
          <Choix
            titre="Tri"
            valeurs={TRIS.map((t) => t.valeur)}
            valeur={tri}
            libelle={(v) => TRIS.find((t) => t.valeur === v)?.libelle ?? v}
            surChoix={(v) => surChange({ tri: v as TriWiki })}
          />
        </div>

        <div className="filtres-actions">
          <button type="button" className="accueil-co-secondaire" onClick={surEffacer}>
            Effacer
          </button>
          <button type="button" className="filtres-voir" onClick={surFermeture}>
            {total === null ? 'Voir les résultats' : `Voir ${total} résultat${total > 1 ? 's' : ''}`}
          </button>
        </div>
      </section>
    </div>
  )
}
