import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Flag, Loader2, Plus, Search, SearchCheck, ShieldQuestion, SlidersHorizontal, WifiOff, X } from 'lucide-react'
import { api, NonAutorise } from '../api'
import { estCodeInterne, normaliserCodeBarres } from '../codeBarres'
import type { FicheWiki as Fiche, ResultatRechercheWiki, TriWiki } from '../types'
import FicheWiki from './FicheWiki'
import FiltresWiki, { libelleGamme, NOUVEAUTES, SANS_CATEGORIE, TRIS } from './FiltresWiki'
import PhotoWiki from './PhotoWiki'
import PropositionWiki from './PropositionWiki'

type Props = {
  surNonAutorise: () => void
}

type TypeCode = 'reel' | 'genere' | 'autre'

const LIBELLES_CODE: Record<TypeCode, string> = {
  reel: 'Code-barres réel',
  genere: 'Code-barres généré',
  autre: 'Autre texte',
}

/** Vert : vrai code-barres ; orange : code interne « 20… » tiré du nom ; rouge : tout autre texte. */
function typeCode(ean: string): TypeCode {
  if (estCodeInterne(ean)) return 'genere'
  return normaliserCodeBarres(ean) ? 'reel' : 'autre'
}

/**
 * Catalogue global : toutes les canettes répertoriées, tous comptes confondus. La recherche, les filtres,
 * le tri et la pagination se font côté serveur (le catalogue peut compter beaucoup de fiches).
 */
export default function Wiki({ surNonAutorise }: Props) {
  const [resultat, setResultat] = useState<ResultatRechercheWiki | null>(null)
  const [fiches, setFiches] = useState<Fiche[]>([])
  const [erreur, setErreur] = useState(false)
  const [chargement, setChargement] = useState(false)
  const [q, setQ] = useState('')
  const [qEnvoyee, setQEnvoyee] = useState('')
  const [gamme, setGamme] = useState('')
  const [region, setRegion] = useState('')
  const [variante, setVariante] = useState('')
  const [tri, setTri] = useState<TriWiki>('pertinence')
  // Propriétaire : n'afficher que les fiches qui ont des erreurs signalées.
  const [signaleesSeules, setSignaleesSeules] = useState(false)
  // Échanges : mes canettes recherchées, ou celles dont quelqu'un a des doubles.
  const [jeChercheSeules, setJeChercheSeules] = useState(false)
  const [doublesSeules, setDoublesSeules] = useState(false)
  // Propriétaire : n'afficher que les fiches à vérifier (créées par des membres).
  const [aVerifierSeules, setAVerifierSeules] = useState(false)
  const [propositionOuverte, setPropositionOuverte] = useState(false)
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const [ouverte, setOuverte] = useState<string | null>(null)
  const requeteEnCours = useRef(0)

  // La saisie part au serveur après une courte pause, pas à chaque touche.
  useEffect(() => {
    const t = window.setTimeout(() => setQEnvoyee(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])

  const charger = useCallback(
    async (page: number) => {
      const numero = ++requeteEnCours.current
      setChargement(true)
      setErreur(false)
      try {
        const r = await api.wikiRecherche({
          q: qEnvoyee,
          ...(gamme === SANS_CATEGORIE
            ? { sans_categorie: true }
            : gamme === NOUVEAUTES
              ? { nouveautes: true }
              : { categorie: gamme }),
          region, variante, tri, page, signalees: signaleesSeules, a_verifier: aVerifierSeules,
          je_cherche: jeChercheSeules, doubles: doublesSeules,
        })
        if (numero !== requeteEnCours.current) return // une recherche plus récente a pris le relais
        setResultat(r)
        setFiches((avant) => (page === 1 ? r.fiches : [...avant, ...r.fiches]))
      } catch (e) {
        if (numero !== requeteEnCours.current) return
        if (e instanceof NonAutorise) surNonAutorise()
        else setErreur(true)
      } finally {
        if (numero === requeteEnCours.current) setChargement(false)
      }
    },
    [qEnvoyee, gamme, region, variante, tri, signaleesSeules, aVerifierSeules, jeChercheSeules, doublesSeules, surNonAutorise],
  )

  useEffect(() => {
    void charger(1)
  }, [charger])

  const peutEditer = resultat?.peut_editer ?? false
  const filtresActifs = !!(qEnvoyee || gamme || region || variante || signaleesSeules || aVerifierSeules || jeChercheSeules || doublesSeules)
  // Filtres du panneau en cours, affichés en pastilles sous la recherche (le tri par défaut n'en est pas un).
  const pastilles = [
    gamme && { cle: 'gamme', libelle: libelleGamme(gamme), retirer: () => setGamme('') },
    region && { cle: 'region', libelle: region, retirer: () => setRegion('') },
    variante && { cle: 'variante', libelle: variante, retirer: () => setVariante('') },
    jeChercheSeules && { cle: 'je-cherche', libelle: 'Je cherche', retirer: () => setJeChercheSeules(false) },
    doublesSeules && { cle: 'doubles', libelle: 'Doubles dispo', retirer: () => setDoublesSeules(false) },
    tri !== 'pertinence' && {
      cle: 'tri', libelle: TRIS.find((t) => t.valeur === tri)?.libelle ?? tri, retirer: () => setTri('pertinence'),
    },
  ].filter((p): p is { cle: string; libelle: string; retirer: () => void } => !!p)
  const effacerFiltres = () => {
    setGamme('')
    setRegion('')
    setVariante('')
    setTri('pertinence')
    setJeChercheSeules(false)
    setDoublesSeules(false)
  }
  const fiche = ouverte ? (fiches.find((f) => f.ean === ouverte) ?? null) : null
  const fermer = useCallback(() => setOuverte(null), [])
  const toutEffacer = () => {
    setQ('')
    setGamme('')
    setRegion('')
    setVariante('')
    setSignaleesSeules(false)
    setAVerifierSeules(false)
    setJeChercheSeules(false)
    setDoublesSeules(false)
  }

  return (
    <section className="collec wiki">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu wiki-contenu">
        {/* En-tête compact : titre et nombre de canettes sur une ligne. */}
        <div className="wiki-tete">
          <h1 className="collec-titre">
            Le Wiki <b>Monster.</b>
          </h1>
          {resultat && (
            <p className="collec-compte">
              <b>{resultat.total_catalogue}</b> canettes
            </p>
          )}
        </div>

        {/* Recherche et bouton Filtres, collés en haut de l'écran quand on fait défiler. */}
        <div className="wiki-barre">
          <label className="collec-recherche wiki-recherche">
            <Search size={18} />
            <input
              value={q}
              name="recherche-wiki"
              type="search"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, saveur, pays, gamme, code"
              aria-label="Chercher dans le Wiki"
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

        {peutEditer && (resultat?.a_verifier ?? 0) > 0 && (
          <button
            className={`wiki-signalees wiki-a-verifier${aVerifierSeules ? ' actif' : ''}`}
            aria-pressed={aVerifierSeules}
            onClick={() => setAVerifierSeules((v) => !v)}
          >
            <ShieldQuestion size={16} />
            {resultat!.a_verifier} fiche{resultat!.a_verifier > 1 ? 's' : ''} à vérifier
            <span>{aVerifierSeules ? 'Tout afficher' : 'Voir'}</span>
          </button>
        )}

        {peutEditer && (resultat?.signalees ?? 0) > 0 && (
          <button
            className={`wiki-signalees${signaleesSeules ? ' actif' : ''}`}
            aria-pressed={signaleesSeules}
            onClick={() => setSignaleesSeules((v) => !v)}
          >
            <Flag size={16} />
            {resultat!.signalees} fiche{resultat!.signalees > 1 ? 's' : ''} signalée{resultat!.signalees > 1 ? 's' : ''}
            <span>{signaleesSeules ? 'Tout afficher' : 'Voir'}</span>
          </button>
        )}

        {erreur && (
          <div className="collec-vide">
            <WifiOff size={34} />
            Le Wiki a besoin de la connexion.
            <button className="accueil-co-secondaire wiki-reessayer" onClick={() => void charger(1)}>
              Réessayer
            </button>
          </div>
        )}

        {!erreur && resultat === null && <p className="collec-vide">Chargement du Wiki…</p>}

        {!erreur && resultat &&
          (fiches.length ? (
            <>
              {filtresActifs && (
                <p className="wiki-resultats" aria-live="polite">
                  {resultat.total} résultat{resultat.total > 1 ? 's' : ''}
                </p>
              )}
              {/* Provenance des codes-barres : réservée au propriétaire, comme les codes eux-mêmes. */}
              {peutEditer && (
                <p className="legende-codes" aria-hidden="true">
                  {(['reel', 'genere', 'autre'] as const).map((t) => (
                    <span key={t}>
                      <span className={`point-code point-code-${t}`} />
                      {LIBELLES_CODE[t]}
                    </span>
                  ))}
                </p>
              )}
              <div className="wiki-grille">
                {fiches.map((f) => (
                  <button key={f.ean} className="carte-wiki wiki-carte" onClick={() => setOuverte(f.ean)}>
                    <span className="wiki-photo">
                      <PhotoWiki ean={f.ean} version={f.photo} />
                      {f.status === 'Nouveauté' && <span className="bandeau-nouveaute">Nouveauté</span>}
                      {peutEditer && f.moderation === 'en_attente' && <span className="badge-moderation">À vérifier</span>}
                      {peutEditer && f.moderation === 'refusee' && <span className="badge-moderation refusee">Refusée</span>}
                      {f.je_cherche && (
                        <span className="wiki-cherche" role="img" aria-label="Tu la cherches">
                          <SearchCheck size={13} />
                        </span>
                      )}
                      {!!f.signalements?.length && (
                        <span className="wiki-signale" role="img" aria-label="Erreur signalée">
                          <Flag size={12} />
                        </span>
                      )}
                      {peutEditer && (
                        <span
                          className={`point-code point-code-${typeCode(f.ean)}`}
                          title={LIBELLES_CODE[typeCode(f.ean)]}
                          role="img"
                          aria-label={LIBELLES_CODE[typeCode(f.ean)]}
                        />
                      )}
                    </span>
                    <span className="wiki-nom">{f.nom || 'Sans nom'}</span>
                  </button>
                ))}
              </div>
              {resultat.page < resultat.pages && (
                <button
                  className="accueil-co-secondaire wiki-plus"
                  disabled={chargement}
                  onClick={() => void charger(resultat.page + 1)}
                >
                  {chargement ? <Loader2 size={18} className="anim-tourne" /> : null}
                  Afficher plus ({resultat.total - fiches.length} restante{resultat.total - fiches.length > 1 ? 's' : ''})
                </button>
              )}
            </>
          ) : resultat.total_catalogue === 0 ? (
            <p className="collec-vide">
              <BookOpen size={34} />
              Le Wiki est vide pour l'instant : il se remplit avec les canettes ajoutées à l'application.
            </p>
          ) : (
            <div className="collec-vide wiki-vide">
              <BookOpen size={34} />
              <span>
                {jeChercheSeules && !qEnvoyee && !gamme && !region && !variante && !doublesSeules
                  ? 'Tu ne cherches aucune canette pour l’instant : ouvre une fiche et touche « Je la cherche ».'
                  : 'Aucune canette ne correspond à cette recherche.'}
              </span>
              {resultat.suggestions.length > 0 && (
                <div className="wiki-suggestions">
                  <span>Tu cherchais :</span>
                  {resultat.suggestions.map((nom) => (
                    <button key={nom} onClick={() => setQ(nom)}>
                      {nom}
                    </button>
                  ))}
                </div>
              )}
              {filtresActifs && (
                <button className="accueil-co-secondaire wiki-reessayer" onClick={toutEffacer}>
                  Effacer la recherche et les filtres
                </button>
              )}
            </div>
          ))}
      </div>

      {/* Proposer une canette : bouton rond flottant, au-dessus de la barre de navigation. */}
      <button className="wiki-fab" aria-label="Proposer une canette" title="Proposer une canette" onClick={() => setPropositionOuverte(true)}>
        <Plus size={26} />
      </button>

      {filtresOuverts && (
        <FiltresWiki
          gamme={gamme}
          region={region}
          variante={variante}
          tri={tri}
          jeCherche={jeChercheSeules}
          doubles={doublesSeules}
          nbJeCherche={resultat?.je_cherche ?? 0}
          proprietaire={peutEditer}
          total={chargement ? null : (resultat?.total ?? null)}
          surChange={(f) => {
            if (f.gamme !== undefined) setGamme(f.gamme)
            if (f.region !== undefined) setRegion(f.region)
            if (f.variante !== undefined) setVariante(f.variante)
            if (f.tri !== undefined) setTri(f.tri)
            if (f.jeCherche !== undefined) setJeChercheSeules(f.jeCherche)
            if (f.doubles !== undefined) setDoublesSeules(f.doubles)
          }}
          surEffacer={effacerFiltres}
          surFermeture={() => setFiltresOuverts(false)}
        />
      )}

      {propositionOuverte && (
        <PropositionWiki
          proprietaire={peutEditer}
          surFermeture={() => setPropositionOuverte(false)}
          surProposee={() => void charger(1)}
          surNonAutorise={surNonAutorise}
        />
      )}

      {fiche && (
        <FicheWiki
          fiche={fiche}
          peutEditer={peutEditer}
          surFermeture={fermer}
          surNonAutorise={surNonAutorise}
          surEnregistree={(eanOriginal, maj) => {
            // Une modification par le propriétaire ne renvoie pas les marques du compte : on garde les précédentes.
            setFiches((liste) => liste.map((f) => (f.ean === eanOriginal ? { ...f, ...maj } : f)))
            setOuverte(maj.ean)
          }}
          surSupprimee={(ean) => {
            setFiches((liste) => liste.filter((f) => f.ean !== ean))
            fermer()
          }}
        />
      )}
    </section>
  )
}
