import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, PackageSearch, Search, SearchCheck, SlidersHorizontal, X } from 'lucide-react'
import { api, NonAutorise } from '../api'
import type { Canette, FicheWiki as Fiche } from '../types'
import FicheWiki from './FicheWiki'
import FiltresWiki, { libelleGamme } from './FiltresWiki'
import PhotoWiki from './PhotoWiki'

type Props = {
  canettes: Canette[]
  surOuvrir: (ean: string) => void
  surNonAutorise: () => void
}

type Onglet = 'possedees' | 'recherchees'

type Tri = 'recent' | 'nom'

const TRIS: { valeur: Tri; libelle: string }[] = [
  { valeur: 'recent', libelle: 'Récentes' },
  { valeur: 'nom', libelle: 'A → Z' },
]

/** Champs communs aux canettes possédées et aux fiches recherchées, pour la recherche et les filtres. */
type Filtrable = { nom: string; ean: string; flavor?: string; categorie: string; region: string; variante?: string }

/** Chaque mot saisi doit apparaître dans le nom, la saveur, le pays, la gamme ou le code-barres (sans accents). */
const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function correspond(c: Filtrable, mots: string[], gamme: string, region: string, variante: string) {
  if (gamme && c.categorie !== gamme) return false
  if (region && c.region !== region) return false
  if (variante && (c.variante || 'Standard') !== variante) return false
  const texte = sansAccents([c.nom, c.flavor, c.region, c.categorie, c.ean].filter(Boolean).join(' '))
  return mots.every((m) => texte.includes(m))
}

/** Collection du compte, en liste (photo à gauche, nom à droite), dans l'univers de la landing page. */
export default function Collection({ canettes, surOuvrir, surNonAutorise }: Props) {
  const [q, setQ] = useState('')
  const [tri, setTri] = useState<Tri>('recent')
  const [gamme, setGamme] = useState('')
  const [region, setRegion] = useState('')
  const [variante, setVariante] = useState('')
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [onglet, setOnglet] = useState<Onglet>('possedees')
  // Canettes marquées « Je la cherche » (fiches du Wiki) ; null : pas encore chargées ou injoignables.
  const [recherchees, setRecherchees] = useState<Fiche[] | null>(null)
  const [erreurRecherchees, setErreurRecherchees] = useState(false)
  const [ouverte, setOuverte] = useState<string | null>(null)

  const chargerRecherchees = useCallback(async () => {
    try {
      const toutes: Fiche[] = []
      for (let page = 1; ; page++) {
        const r = await api.wikiRecherche({ je_cherche: true, tri: 'recent', page, par_page: 60 })
        toutes.push(...r.fiches)
        if (page >= r.pages) break
      }
      setRecherchees(toutes)
      setErreurRecherchees(false)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurRecherchees(true)
    }
  }, [surNonAutorise])

  // Rechargées quand la collection change : une canette ajoutée n'est plus recherchée.
  useEffect(() => {
    void chargerRecherchees()
  }, [chargerRecherchees, canettes.length])

  const fermer = useCallback(() => {
    setOuverte(null)
    // Une canette décochée « Je la cherche » dans la fiche quitte la liste à la fermeture.
    setRecherchees((liste) => liste?.filter((f) => f.je_cherche) ?? null)
  }, [])
  const ficheOuverte = ouverte ? (recherchees?.find((f) => f.ean === ouverte) ?? null) : null

  const mots = useMemo(() => sansAccents(q).split(/\s+/).filter(Boolean), [q])

  const rechercheesVues = useMemo(() => {
    const filtrees = (recherchees ?? []).filter((f) => correspond(f, mots, gamme, region, variante))
    return tri === 'nom' ? [...filtrees].sort((a, b) => a.nom.localeCompare(b.nom)) : filtrees
  }, [recherchees, mots, gamme, region, variante, tri])

  const vues = useMemo(() => {
    const filtrees = canettes.filter((c) => correspond(c, mots, gamme, region, variante))
    return filtrees.sort((a, b) => (tri === 'nom' ? a.nom.localeCompare(b.nom) : b.ajout.localeCompare(a.ajout)))
  }, [canettes, mots, gamme, region, variante, tri])

  const pastilles = [
    gamme && { cle: 'gamme', libelle: libelleGamme(gamme), retirer: () => setGamme('') },
    region && { cle: 'region', libelle: region, retirer: () => setRegion('') },
    variante && { cle: 'variante', libelle: variante, retirer: () => setVariante('') },
    tri !== 'recent' && { cle: 'tri', libelle: TRIS.find((t) => t.valeur === tri)?.libelle ?? tri, retirer: () => setTri('recent') },
  ].filter((p): p is { cle: string; libelle: string; retirer: () => void } => !!p)
  const effacerFiltres = () => {
    setGamme('')
    setRegion('')
    setVariante('')
    setTri('recent')
  }
  const filtresActifs = !!(mots.length || gamme || region || variante)
  const affichees = onglet === 'possedees' ? vues : rechercheesVues

  return (
    <section className="collec">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        {/* En-tête compact, comme le Wiki : titre et nombre de canettes sur une ligne. */}
        <div className="wiki-tete">
          <h1 className="collec-titre">
            Ma collection <b>Monster.</b>
          </h1>
          <p className="collec-compte">
            <b>{canettes.length}</b> canette{canettes.length > 1 ? 's' : ''}
          </p>
        </div>

        <div className="collec-tri collec-onglets" role="tablist" aria-label="Partie de la collection">
          <button role="tab" aria-selected={onglet === 'possedees'} onClick={() => setOnglet('possedees')}>
            Possédées · {canettes.length}
          </button>
          <button role="tab" aria-selected={onglet === 'recherchees'} onClick={() => setOnglet('recherchees')}>
            <SearchCheck size={16} aria-hidden="true" />
            Recherchées{recherchees ? ` · ${recherchees.length}` : ''}
          </button>
        </div>

        {/* Recherche et bouton Filtres, collés en haut de l'écran quand on fait défiler. */}
        <div className="wiki-barre">
          <label className="collec-recherche wiki-recherche">
            <Search size={18} />
            <input
              value={q}
              name="recherche"
              type="search"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, saveur, pays, gamme, code"
              aria-label="Chercher un nom"
            />
          </label>
          <button
            className={`wiki-filtres${pastilles.length ? ' actif' : ''}`}
            aria-haspopup="dialog"
            aria-label={pastilles.length ? `Filtres, ${pastilles.length} actif${pastilles.length > 1 ? 's' : ''}` : 'Filtres'}
            onClick={() => setFiltresOuverts(true)}
          >
            <SlidersHorizontal size={18} />
            <span>Filtres</span>
            {!!pastilles.length && <b>{pastilles.length}</b>}
          </button>
        </div>
        {!!pastilles.length && (
          <div className="wiki-pastilles" aria-label="Filtres actifs">
            {pastilles.map((p) => (
              <button key={p.cle} onClick={p.retirer} aria-label={`Retirer le filtre ${p.libelle}`}>
                {p.libelle}
                <X size={14} aria-hidden="true" />
              </button>
            ))}
            {pastilles.length > 1 && (
              <button className="wiki-pastilles-effacer" onClick={effacerFiltres}>
                Tout effacer
              </button>
            )}
          </div>
        )}
        {filtresActifs && (
          <p className="wiki-resultats" aria-live="polite">
            {affichees.length} résultat{affichees.length > 1 ? 's' : ''}
          </p>
        )}

        {onglet === 'possedees' ? (
          vues.length ? (
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
                ? 'Aucune canette ne correspond à ces critères.'
                : "Rien ici pour l'instant. Scanne ta première canette."}
            </p>
          )
        ) : rechercheesVues.length ? (
          <ul className="collec-liste">
            {rechercheesVues.map((f) => (
              <li key={f.ean}>
                <button className="collec-ligne" onClick={() => setOuverte(f.ean)}>
                  <span className="collec-photo">
                    <PhotoWiki ean={f.ean} version={f.photo} taille={20} />
                  </span>
                  <span className="collec-nom">{f.nom || 'Sans nom'}</span>
                  <ChevronRight size={20} className="collec-chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="collec-vide">
            <SearchCheck size={34} />
            {erreurRecherchees && recherchees === null
              ? 'Liste des canettes recherchées indisponible hors ligne.'
              : recherchees === null
                ? 'Chargement…'
                : recherchees.length
                  ? 'Aucune canette ne correspond à ces critères.'
                  : 'Aucune canette recherchée. Dans le Wiki, ouvre une fiche et touche « Je la cherche ».'}
          </p>
        )}
      </div>
      {filtresOuverts && (
        <FiltresWiki
          gamme={gamme}
          region={region}
          variante={variante}
          tri={tri}
          jeCherche={false}
          doubles={false}
          nbJeCherche={0}
          proprietaire={false}
          echanges={false}
          nouveautes={false}
          tris={TRIS}
          total={affichees.length}
          surChange={(f) => {
            if (f.gamme !== undefined) setGamme(f.gamme)
            if (f.region !== undefined) setRegion(f.region)
            if (f.variante !== undefined) setVariante(f.variante)
            if (f.tri !== undefined) setTri(f.tri as Tri)
          }}
          surEffacer={effacerFiltres}
          surFermeture={() => setFiltresOuverts(false)}
        />
      )}
      {ficheOuverte && (
        <FicheWiki
          fiche={ficheOuverte}
          peutEditer={false}
          surFermeture={fermer}
          surNonAutorise={surNonAutorise}
          surEnregistree={(eanOriginal, maj) =>
            setRecherchees((liste) => liste?.map((f) => (f.ean === eanOriginal ? { ...f, ...maj } : f)) ?? null)
          }
          surSupprimee={(ean) => {
            setRecherchees((liste) => liste?.filter((f) => f.ean !== ean) ?? null)
            setOuverte(null)
          }}
        />
      )}
    </section>
  )
}
