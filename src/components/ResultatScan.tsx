import { useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, CheckCircle2, ImageOff, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import { estCodeInterne, normaliserCodeBarres } from '../codeBarres'
import { reduirePhoto } from '../photo'
import { suivre } from '../suivi'
import { CANETTE_VIDE, ETATS, type Canette, type FicheWiki } from '../types'
import { fichesCorrespondantes, trouverFicheParCodeBarres } from '../wiki'
import PhotoWiki from './PhotoWiki'

type Props = {
  ean: string
  /** Canette de la collection portant ce code, au moment du scan. */
  existante: Canette | null
  surCollectionChangee: () => Promise<void>
  /** Ouvre la fiche détaillée (canette possédée) ou le formulaire complet (canette nouvelle). */
  surFicheComplete: () => void
  surScanner: () => void
  surTermine: (message: string) => void
  surFermeture: () => void
  surNonAutorise: () => void
}

type Etape =
  | { nom: 'recherche' }
  | { nom: 'possedee' }
  | { nom: 'inconnue' }
  | { nom: 'creation' }
  | { nom: 'etat'; canette: Canette; apercu: string | null }
  | { nom: 'erreur' }

/**
 * Résultat d'un scan, sans cul-de-sac :
 * 1. déjà possédée : fiche miniature et « +1 » ;
 * 2. présente dans le Wiki : ajout immédiat, lueur de succès, choix rapide de l'état ;
 * 3. inconnue : invitation à créer la fiche, formulaire court (nom et photo). Si le nom correspond à une
 *    fiche du Wiki qui n'a qu'un code interne, le code scanné peut lui être associé.
 */
export default function ResultatScan(p: Props) {
  const [etape, setEtape] = useState<Etape>(p.existante ? { nom: 'possedee' } : { nom: 'recherche' })
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [nb, setNb] = useState(p.existante?.nb ?? 1)
  const [ajouts, setAjouts] = useState(0)
  // Canette possédée affichée : celle du scan, ou celle retrouvée après une association de code.
  const [connue, setConnue] = useState<Canette | null>(p.existante)
  const [fiches, setFiches] = useState<FicheWiki[]>([])
  const [info, setInfo] = useState<string | null>(null)
  const lance = useRef(false)
  const code = normaliserCodeBarres(p.ean) ?? p.ean
  const codeValide = p.ean.startsWith('LOCAL-') || normaliserCodeBarres(p.ean) !== null
  // Seul un vrai code-barres peut remplacer le code interne d'une fiche.
  const peutAssocier = codeValide && !p.ean.startsWith('LOCAL-') && !estCodeInterne(code)

  const echec = (e: unknown, message: string) => {
    if (e instanceof NonAutorise) p.surNonAutorise()
    else setErreur(e instanceof ErreurAPI ? `${message} — ${e.detail}` : message)
  }

  const proteger = async (action: () => Promise<void>, message: string) => {
    setOccupe(true)
    setErreur(null)
    try {
      await action()
    } catch (e) {
      echec(e, message)
    } finally {
      setOccupe(false)
    }
  }

  // L'ajout est enregistré tout de suite ; l'état se précise ensuite, et l'ajout reste annulable.
  const ajouter = async (canette: Canette) => {
    await api.enregistrer(canette)
    suivre('can_added')
    const sansPhoto: Canette = { ...canette }
    delete sansPhoto.photo // les mises à jour suivantes conservent la photo enregistrée
    setEtape({ nom: 'etat', canette: sansPhoto, apercu: canette.photo ?? null })
    void p.surCollectionChangee()
  }

  const ajouterDepuisFiche = async (fiche: FicheWiki) => {
    const photo = fiche.photo ? await api.wikiPhotoData(fiche.ean, fiche.photo).catch(() => null) : null
    await ajouter({
      ...CANETTE_VIDE(fiche.ean),
      nom: fiche.nom,
      edition: fiche.edition,
      volume: fiche.volume,
      categorie: fiche.categorie,
      flavor: fiche.flavor,
      status: fiche.status,
      region: fiche.region,
      photo,
    })
  }

  useEffect(() => {
    if (p.existante || lance.current) return
    lance.current = true
    void (async () => {
      try {
        const liste = codeValide ? (await api.wiki()).fiches : []
        setFiches(liste)
        const fiche = trouverFicheParCodeBarres(liste, code)
        if (!fiche) {
          setEtape({ nom: 'inconnue' })
          return
        }
        // Code supplémentaire d'une fiche : la canette est peut-être déjà possédée sous le code principal.
        if (fiche.ean !== code && (await montrerSiPossedee(fiche.ean))) return
        await ajouterDepuisFiche(fiche)
      } catch (e) {
        if (e instanceof NonAutorise) p.surNonAutorise()
        else setEtape({ nom: 'erreur' })
      }
    })()
    // Une seule recherche par scan : le composant est recréé pour chaque code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Affiche la canette possédée sous ce code, le cas échéant ; faux si elle n'est pas dans la collection. */
  const montrerSiPossedee = async (ean: string) => {
    try {
      const deja = await api.lire(ean)
      setConnue(deja)
      setNb(deja.nb)
      setEtape({ nom: 'possedee' })
      return true
    } catch (e) {
      if (e instanceof ErreurAPI && e.status === 404) return false
      throw e
    }
  }

  // Le code scanné rejoint la fiche (pour tous) : code principal si elle n'avait qu'un code interne,
  // code supplémentaire sinon. La canette rejoint ensuite la collection, sans écraser un exemplaire existant.
  const associer = (fiche: FicheWiki) =>
    proteger(async () => {
      const question = estCodeInterne(fiche.ean)
        ? `Donner le code-barres ${code} à « ${fiche.nom} » ? Il servira à tous les collectionneurs.`
        : `Ajouter ${code} comme autre code-barres de « ${fiche.nom} » ? Il servira à tous les collectionneurs.`
      if (!confirm(question)) return
      const maj = await api.wikiAssocierCode(fiche.ean, code)
      setInfo(`Code-barres associé à « ${maj.nom} » dans le Wiki. Merci, pionnier !`)
      if (await montrerSiPossedee(maj.ean)) {
        await p.surCollectionChangee()
        return
      }
      await ajouterDepuisFiche(maj)
    }, 'Association impossible')

  const plusUn = () =>
    proteger(async () => {
      setNb((await api.ajuster(connue?.ean ?? p.ean, 1)).nb)
      setAjouts((n) => n + 1)
      await p.surCollectionChangee()
    }, 'Quantité non modifiée')

  const choisirEtat = (canette: Canette, etat: string) =>
    proteger(async () => {
      await api.enregistrer({ ...canette, etat })
      await p.surCollectionChangee()
      p.surTermine(`Ajoutée à ta collection · ${etat}`)
    }, 'État non enregistré')

  const annulerAjout = (canette: Canette) =>
    proteger(async () => {
      await api.supprimer(canette.ean)
      await p.surCollectionChangee()
      p.surTermine('Ajout annulé')
    }, 'Annulation impossible')

  return (
    <div className="verdict" role="dialog" aria-modal="true" aria-label="Résultat du scan">
      <div className="scan-entete">
        <span className="ean">{p.ean}</span>
        <button className="btn-icone" onClick={p.surFermeture} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      <div className="verdict-scroll" aria-live="polite">
        {etape.nom === 'recherche' && (
          <div className="vide">
            <Loader2 size={30} className="anim-tourne" />
            Recherche dans le Wiki…
          </div>
        )}

        {info && <p className="scan-info" role="status">{info}</p>}

        {etape.nom === 'possedee' && connue && (
          <>
            <span className="badge badge-possede scan-badge">
              <CheckCircle2 size={13} /> Déjà dans ta collection
            </span>
            <CarteMini
              titre={connue.nom || 'Sans nom'}
              detail={[connue.edition, connue.volume].filter(Boolean).join(' · ')}
              photo={<PhotoWiki source="collection" ean={connue.ean} version={connue.photo_version} />}
            >
              <span key={ajouts} className={`scan-quantite${ajouts ? ' scan-quantite-plus' : ''}`}>
                Quantité : <b>{nb}</b>
              </span>
            </CarteMini>
            <p className="sous">Un exemplaire de plus pour tes échanges ?</p>
            <div className="actions">
              <button className="btn btn-primaire actions-principal" disabled={occupe} onClick={() => void plusUn()}>
                <Plus size={19} /> Ajouter un doublon / +1
              </button>
              <button className="btn btn-fantome" onClick={p.surFicheComplete}>Voir la fiche</button>
              <button className="btn btn-fantome" onClick={p.surScanner}>Scanner la suivante</button>
            </div>
          </>
        )}

        {etape.nom === 'etat' && (
          <>
            <span className="badge badge-possede scan-badge">
              <Sparkles size={13} /> Ajoutée à ta collection
            </span>
            <CarteMini
              succes
              titre={etape.canette.nom || 'Nouvelle canette'}
              detail={[etape.canette.edition, etape.canette.volume].filter(Boolean).join(' · ')}
              photo={etape.apercu ? <img src={etape.apercu} alt="" /> : <ImageOff size={26} />}
            />
            <div className="scan-etat" role="group" aria-labelledby="titre-etat">
              <h3 id="titre-etat">Dans quel état est-elle ?</h3>
              <div className="choix-etat">
                {ETATS.map((etat) => (
                  <button key={etat} disabled={occupe} onClick={() => void choisirEtat(etape.canette, etat)}>
                    {etat}
                  </button>
                ))}
              </div>
              <button className="scan-annuler" disabled={occupe} onClick={() => void annulerAjout(etape.canette)}>
                Annuler l’ajout
              </button>
            </div>
          </>
        )}

        {etape.nom === 'inconnue' && (
          <>
            <div className="scan-inconnu">
              <Sparkles size={42} />
              <h2>Canette inconnue&nbsp;!</h2>
              <p>
                {codeValide
                  ? 'Sois le premier pionnier à l’ajouter au Wiki Monster.'
                  : 'Ce code-barres n’a pas pu être lu correctement. Vérifie-le dans le formulaire complet.'}
              </p>
            </div>
            <div className="actions">
              {codeValide && (
                <button className="btn btn-primaire actions-principal" onClick={() => setEtape({ nom: 'creation' })}>
                  Ajouter au Wiki
                </button>
              )}
              <button className="btn btn-fantome" onClick={p.surFicheComplete}>Formulaire complet</button>
              <button className="btn btn-fantome" onClick={p.surScanner}>Scanner une autre canette</button>
            </div>
          </>
        )}

        {etape.nom === 'creation' && (
          <CreationRapide
            occupe={occupe}
            fichesExistantes={peutAssocier ? fiches : []}
            surAssocier={(fiche) => void associer(fiche)}
            surValider={(champs) =>
              void proteger(() => ajouter({ ...CANETTE_VIDE(code), ...champs }), 'Ajout impossible')
            }
            surAnnuler={() => setEtape({ nom: 'inconnue' })}
          />
        )}

        {etape.nom === 'erreur' && (
          <>
            <div className="vide">
              Le Wiki est injoignable. Tu peux réessayer avec le réseau ou remplir la fiche toi-même.
            </div>
            <div className="actions">
              <button className="btn btn-primaire actions-principal" onClick={p.surFicheComplete}>
                Formulaire complet
              </button>
              <button className="btn btn-fantome" onClick={p.surFermeture}>Fermer</button>
            </div>
          </>
        )}

        {erreur && <p className="suggestions-wiki-erreur" role="alert">{erreur}</p>}
      </div>
    </div>
  )
}

function CarteMini({
  titre,
  detail,
  photo,
  succes = false,
  children,
}: {
  titre: string
  detail: string
  photo: React.ReactNode
  succes?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`carte-scan${succes ? ' succes' : ''}`}>
      <div className="carte-scan-photo">{photo}</div>
      <div className="carte-scan-texte">
        <h3>{titre}</h3>
        {detail && <p>{detail}</p>}
        {children}
      </div>
    </div>
  )
}

type ChampsCreation = Pick<Canette, 'nom' | 'photo'>

function CreationRapide({
  occupe,
  fichesExistantes,
  surAssocier,
  surValider,
  surAnnuler,
}: {
  occupe: boolean
  /** Fiches du Wiki : celles dont le nom correspond peuvent recevoir le code scanné. */
  fichesExistantes: FicheWiki[]
  surAssocier: (fiche: FicheWiki) => void
  surValider: (champs: ChampsCreation) => void
  surAnnuler: () => void
}) {
  const [champs, setChamps] = useState<ChampsCreation>({ nom: '', photo: null })
  const [erreurPhoto, setErreurPhoto] = useState<string | null>(null)
  const maj = <K extends keyof ChampsCreation>(k: K, v: ChampsCreation[K]) => setChamps((c) => ({ ...c, [k]: v }))
  const propositions = fichesCorrespondantes(fichesExistantes, champs.nom)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        surValider({ ...champs, nom: champs.nom.trim() })
      }}
    >
      <div className="bandeau-info">
        <h2>Nouvelle fiche</h2>
        <p>Le nom rejoint le Wiki ; la photo reste dans ta collection.</p>
      </div>
      <div className="champs">
        <div>
          <label htmlFor="s-nom">Nom de la boisson</label>
          <input
            id="s-nom"
            required
            maxLength={200}
            placeholder="Monster Mango Loco"
            value={champs.nom}
            onChange={(e) => maj('nom', e.target.value)}
          />
        </div>
        {propositions.length > 0 && (
          <div className="suggestions-wiki" aria-live="polite">
            <div className="suggestions-wiki-titre">Déjà dans le Wiki ?</div>
            <p className="sous">
              C’est la même canette ? Associe-lui le code que tu viens de scanner plutôt que de créer un doublon.
            </p>
            <div className="suggestions-wiki-liste">
              {propositions.map((fiche) => (
                <div className="suggestion-wiki" key={fiche.ean}>
                  <span>
                    <b>{fiche.nom}{fiche.edition ? ` - ${fiche.edition}` : ''}</b>
                    <small>
                      {[fiche.volume, estCodeInterne(fiche.ean) ? 'sans code-barres' : null].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                  <button
                    className="btn btn-fantome"
                    type="button"
                    disabled={occupe}
                    onClick={() => surAssocier(fiche)}
                  >
                    Associer ce code-barres
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="photo-zone">
          <CameraIcon size={22} />
          Prendre une photo (facultatif)
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Prendre une photo de la canette"
            onChange={async (e) => {
              const fichier = e.target.files?.[0]
              if (!fichier) return
              setErreurPhoto(null)
              try {
                maj('photo', await reduirePhoto(fichier))
              } catch {
                setErreurPhoto('Photo illisible, essaie une autre image.')
              }
            }}
          />
          {champs.photo && <img src={champs.photo} alt="" />}
        </div>
        {erreurPhoto && <p className="suggestions-wiki-erreur" role="alert">{erreurPhoto}</p>}
      </div>
      <div className="actions">
        <button className="btn btn-primaire actions-principal" type="submit" disabled={occupe || !champs.nom.trim()}>
          {occupe ? 'Ajout…' : 'Ajouter'}
        </button>
        <button className="btn btn-fantome" type="button" onClick={surAnnuler}>
          Retour
        </button>
      </div>
    </form>
  )
}
