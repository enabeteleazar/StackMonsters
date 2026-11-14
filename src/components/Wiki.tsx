import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Flag, Loader2, PlusCircle, Search, ShieldQuestion, WifiOff } from 'lucide-react'
import { api, NonAutorise } from '../api'
import { CATEGORIES, REGIONS } from '../categories'
import { estCodeInterne, normaliserCodeBarres } from '../codeBarres'
import type { FicheWiki as Fiche, ResultatRechercheWiki, TriWiki } from '../types'
import FicheWiki from './FicheWiki'
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

const TRIS: { valeur: TriWiki; libelle: string }[] = [
  { valeur: 'pertinence', libelle: 'Pertinence' },
  { valeur: 'nom', libelle: 'Nom A → Z' },
  { valeur: 'recent', libelle: 'Plus récentes' },
]

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
  const [tri, setTri] = useState<TriWiki>('pertinence')
  // Propriétaire : n'afficher que les fiches qui ont des erreurs signalées.
  const [signaleesSeules, setSignaleesSeules] = useState(false)
  // Propriétaire : n'afficher que les fiches à vérifier (créées par des membres).
  const [aVerifierSeules, setAVerifierSeules] = useState(false)
  const [propositionOuverte, setPropositionOuverte] = useState(false)
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
          q: qEnvoyee, categorie: gamme, region, tri, page, signalees: signaleesSeules, a_verifier: aVerifierSeules,
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
    [qEnvoyee, gamme, region, tri, signaleesSeules, aVerifierSeules, surNonAutorise],
  )

  useEffect(() => {
    void charger(1)
  }, [charger])

  const peutEditer = resultat?.peut_editer ?? false
  const filtresActifs = !!(qEnvoyee || gamme || region || signaleesSeules || aVerifierSeules)
  const fiche = ouverte ? (fiches.find((f) => f.ean === ouverte) ?? null) : null
  const fermer = useCallback(() => setOuverte(null), [])
  const toutEffacer = () => {
    setQ('')
    setGamme('')
    setRegion('')
    setSignaleesSeules(false)
    setAVerifierSeules(false)
  }

  return (
    <section className="collec wiki">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu wiki-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Le Wiki <b>Monster.</b>
          </h1>
          {resultat && (
            <p className="collec-compte">
              <b>{resultat.total_catalogue}</b> Canettes répertoriées
            </p>
          )}
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        <button className="accueil-co-secondaire wiki-proposer" onClick={() => setPropositionOuverte(true)}>
          <PlusCircle size={20} />
          Proposer une canette
        </button>

        <label className="collec-recherche wiki-recherche">
          <Search size={18} />
          <input
            value={q}
            name="recherche-wiki"
            type="search"
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom, saveur, pays, gamme ou code-barres"
            aria-label="Chercher dans le Wiki"
          />
        </label>
        <div className="wiki-gammes" role="radiogroup" aria-label="Filtrer par gamme">
          {['', ...CATEGORIES].map((categorie) => (
            <button
              key={categorie || 'toutes'}
              role="radio"
              aria-checked={gamme === categorie}
              onClick={() => setGamme(categorie)}
            >
              {categorie || 'Toutes'}
            </button>
          ))}
        </div>
        <div className="wiki-options">
          <label>
            <span>Pays</span>
            <select name="pays-wiki" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filtrer par pays">
              <option value="">Tous</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Tri</span>
            <select name="tri-wiki" value={tri} onChange={(e) => setTri(e.target.value as TriWiki)} aria-label="Trier">
              {TRIS.map((t) => (
                <option key={t.valeur} value={t.valeur}>{t.libelle}</option>
              ))}
            </select>
          </label>
        </div>

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
              <span>Aucune canette ne correspond à cette recherche.</span>
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
            setFiches((liste) => liste.map((f) => (f.ean === eanOriginal ? maj : f)))
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
