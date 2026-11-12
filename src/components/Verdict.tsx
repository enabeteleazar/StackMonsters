import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Camera as CameraIcon, CheckCircle2, ImageOff, ImagePlus, Sparkles, X } from 'lucide-react'
import { api, NonAutorise } from '../api'
import { CATEGORIES, libelleStatut, REGIONS, STATUTS_COLLECTION } from '../categories'
import { normaliserCodeBarres } from '../codeBarres'
import { reduirePhoto } from '../photo'
import { CANETTE_VIDE, ETATS, type Canette, type FicheWiki } from '../types'
import { suggererFiches, trouverFicheParCodeBarres } from '../wiki'
import PhotoWiki from './PhotoWiki'

type Props = {
  ean: string
  existante: Canette | null
  canettes: Canette[]
  surNonAutorise: () => void
  surEnregistrer: (c: Canette) => Promise<void>
  surSupprimer: (ean: string) => Promise<void>
  surFermeture: () => void
}

export default function Verdict(p: Props) {
  const [edition, setEdition] = useState(!p.existante)
  const [occupe, setOccupe] = useState(false)
  const [erreurPhoto, setErreurPhoto] = useState<string | null>(null)
  const [eanAffiche, setEanAffiche] = useState(p.ean)
  const photoInput = useRef<HTMLInputElement>(null)

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

  const remplacerPhoto = async (fichier: File) => {
    setErreurPhoto(null)
    setOccupe(true)
    try {
      const photo = await reduirePhoto(fichier)
      await p.surEnregistrer({ ...p.existante!, photo })
    } catch (erreur) {
      setErreurPhoto(
        erreur instanceof Error ? `Photo non modifiée : ${erreur.message}` : 'Photo non modifiée.',
      )
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="verdict">
      <div className="photo-hero">
        {!edition && p.existante?.photo_version ? (
          <PhotoWiki
            source="collection"
            ean={p.existante.ean}
            version={p.existante.photo_version}
            taille={34}
            legende="Pas de photo"
          />
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
          <div className="ean">{eanAffiche}</div>
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
            nouvelle={!connue}
            canettes={p.canettes}
            surNonAutorise={p.surNonAutorise}
            occupe={occupe}
            libelle={connue ? 'Enregistrer' : 'Ajouter à la collection'}
            surValider={(c) => proteger(() => p.surEnregistrer(c))}
            surSelectionFiche={setEanAffiche}
            surAnnuler={() => (connue ? setEdition(false) : p.surFermeture())}
          />
        ) : (
          <>
            <div className="meta-grille">
              <div className="meta-item">
                <span>Volume</span>
                <b>{p.existante!.volume || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Catégorie</span>
                <b>{p.existante!.categorie || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Flavor</span>
                <b>{p.existante!.flavor || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Status</span>
                <b>{p.existante!.status || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Region</span>
                <b>{p.existante!.region || '—'}</b>
              </div>
              <div className="meta-item">
                <span>État</span>
                <b>{p.existante!.etat || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Quantité</span>
                <b>{p.existante!.nb}</b>
              </div>
            </div>
            {p.existante!.notes && <p className="sous">Notes : {p.existante!.notes}</p>}

            <div className="actions">
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Choisir une nouvelle photo de la canette"
                hidden
                onChange={(e) => {
                  const input = e.currentTarget
                  const fichier = input.files?.[0]
                  input.value = ''
                  if (fichier) void remplacerPhoto(fichier)
                }}
              />
              <button
                className="btn btn-fantome"
                disabled={occupe}
                onClick={() => photoInput.current?.click()}
              >
                <ImagePlus size={18} />
                {p.existante!.photo_version ? 'Remplacer la photo' : 'Ajouter une photo'}
              </button>
              {erreurPhoto && <p className="sous" role="alert">{erreurPhoto}</p>}
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
  nouvelle,
  canettes,
  surNonAutorise,
  occupe,
  libelle,
  surValider,
  surSelectionFiche,
  surAnnuler,
}: {
  depart: Canette
  nouvelle: boolean
  canettes: Canette[]
  surNonAutorise: () => void
  occupe: boolean
  libelle: string
  surValider: (c: Canette) => void
  surSelectionFiche: (ean: string) => void
  surAnnuler: () => void
}) {
  const [c, setC] = useState<Canette>(depart)
  const [fiches, setFiches] = useState<FicheWiki[] | null>(null)
  const [erreurWiki, setErreurWiki] = useState<string | null>(null)
  const [chargementFiche, setChargementFiche] = useState<string | null>(null)
  const [erreurFiche, setErreurFiche] = useState<string | null>(null)
  const [ficheChoisie, setFicheChoisie] = useState<string | null>(null)
  const champ = <K extends keyof Canette>(k: K, v: Canette[K]) =>
    setC((prec) => ({ ...prec, [k]: v }))
  // Seule une nouvelle canette reçoit la forme canonique : une fiche existante garde son code.
  const codeCanonique = nouvelle ? (normaliserCodeBarres(c.ean) ?? c.ean) : c.ean

  const chargerWiki = useCallback(async () => {
    setErreurWiki(null)
    try {
      setFiches((await api.wiki()).fiches)
    } catch (erreur) {
      if (erreur instanceof NonAutorise) surNonAutorise()
      else setErreurWiki('Le Wiki est indisponible. Tu peux réessayer ou continuer sans suggestion.')
    }
  }, [surNonAutorise])

  useEffect(() => {
    if (nouvelle) void chargerWiki()
  }, [chargerWiki, nouvelle])

  const suggestions = useMemo(
    () => {
      const catalogue = fiches ?? []
      const parNom = suggererFiches(catalogue, c.nom)
      const parCode = trouverFicheParCodeBarres(catalogue, codeCanonique)
      return [...(parCode ? [parCode] : []), ...parNom.filter((fiche) => fiche.ean !== parCode?.ean)].slice(0, 4)
    },
    [fiches, c.nom, codeCanonique],
  )
  const ficheCodeBarres = trouverFicheParCodeBarres(fiches ?? [], codeCanonique)
  const ficheCodeDisponible =
    ficheCodeBarres && !canettes.some((canette) => canette.ean === ficheCodeBarres.ean)
      ? ficheCodeBarres
      : undefined
  const codeBarresDejaUtilise = canettes.find(
    (canette) => canette.ean === codeCanonique && canette.ean !== depart.ean,
  )
  const codeBarresLocal = nouvelle && c.ean.startsWith('LOCAL-')
  // À sa création, une canette sans code-barres reçoit un code tiré de son nom et rejoint le Wiki,
  // qui porte ces champs descriptifs ; une ancienne canette LOCAL- reste hors du Wiki.
  const champsWiki = codeBarresLocal || !c.ean.startsWith('LOCAL-')
  // Le Wiki garde la première valeur saisie : un champ déjà rempli ne se modifie pas depuis une collection.
  const valeursWiki = nouvelle ? fiches?.find((fiche) => fiche.ean === ficheChoisie) : depart
  const verrouille = (k: 'categorie' | 'flavor' | 'status' | 'region') => !!valeursWiki?.[k]
  const champsVerrouilles = (['categorie', 'flavor', 'status', 'region'] as const).some(verrouille)
  // Le code n'est contrôlé qu'à la création : une fiche existante reste toujours modifiable.
  const codeBarresValide = !nouvelle || codeBarresLocal || normaliserCodeBarres(c.ean) !== null
  const codeBarresInvalide = nouvelle && !!c.ean && !codeBarresValide
  const quantiteInvalide = !Number.isInteger(c.nb) || c.nb < 1 || c.nb > 9999
  const choixFicheRequis =
    nouvelle && !!ficheCodeDisponible && ficheChoisie !== ficheCodeDisponible.ean
  const rechercheActive = c.nom.trim().length >= 2 || (c.ean.trim().length >= 2 && !c.ean.startsWith('LOCAL-'))
  const wikiEnChargement = nouvelle && rechercheActive && fiches === null && !erreurWiki

  const choisirFiche = async (fiche: FicheWiki) => {
    if (canettes.some((canette) => canette.ean === fiche.ean)) return
    setChargementFiche(fiche.ean)
    setErreurFiche(null)
    try {
      const photo = fiche.photo ? await api.wikiPhotoData(fiche.ean, fiche.photo) : null
      setC((prec) => ({
        ...prec,
        ean: fiche.ean,
        nom: fiche.nom,
        edition: fiche.edition,
        volume: fiche.volume,
        categorie: fiche.categorie,
        flavor: fiche.flavor,
        status: fiche.status,
        region: fiche.region,
        photo,
      }))
      setFicheChoisie(fiche.ean)
      surSelectionFiche(fiche.ean)
    } catch (erreur) {
      if (erreur instanceof NonAutorise) surNonAutorise()
      else setErreurFiche(
        erreur instanceof Error ? `Impossible de reprendre cette fiche : ${erreur.message}` : 'Impossible de reprendre cette fiche.',
      )
    } finally {
      setChargementFiche(null)
    }
  }

  return (
    <>
      <div className="champs">
        <div>
          <label htmlFor="f-code-barres">Code-barres</label>
          <input
            id="f-code-barres"
            value={c.ean}
            readOnly={!nouvelle}
            inputMode="numeric"
            maxLength={64}
            aria-label="Code-barres de la canette"
            onChange={(e) => {
              const ean = e.target.value.trim()
              champ('ean', ean)
              setFicheChoisie(null)
              surSelectionFiche(ean)
            }}
          />
        </div>
        <div>
          <label htmlFor="f-nom">Nom</label>
          <input
            id="f-nom"
            value={c.nom}
            placeholder="Monster Mango Loco"
            onChange={(e) => champ('nom', e.target.value)}
          />
        </div>
        {nouvelle && rechercheActive && (
          <div className="suggestions-wiki" aria-live="polite">
            <div className="suggestions-wiki-titre">
              <BookOpen size={17} />
              Fiches existantes dans le Wiki
            </div>
            {erreurWiki ? (
              <div className="suggestions-wiki-etat" role="alert">
                {erreurWiki}
                <button className="btn btn-fantome" type="button" onClick={() => void chargerWiki()}>
                  Réessayer
                </button>
              </div>
            ) : fiches === null ? (
              <p className="suggestions-wiki-etat">Recherche dans le Wiki…</p>
            ) : suggestions.length ? (
              <div className="suggestions-wiki-liste">
                {suggestions.map((fiche) => {
                  const dejaAjoutee = canettes.some((canette) => canette.ean === fiche.ean)
                  const enCours = chargementFiche === fiche.ean
                  return (
                    <div className="suggestion-wiki" key={fiche.ean}>
                      <span>
                        <b>{fiche.nom}</b>
                        {fiche.volume && <small>{fiche.volume}</small>}
                      </span>
                      <button
                        className="btn btn-fantome"
                        type="button"
                        disabled={dejaAjoutee || chargementFiche !== null}
                        onClick={() => void choisirFiche(fiche)}
                      >
                        {dejaAjoutee ? 'Déjà ajoutée' : enCours ? 'Chargement…' : 'Utiliser cette fiche'}
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="suggestions-wiki-etat">Aucune fiche correspondante.</p>
            )}
            {erreurFiche && <p className="suggestions-wiki-erreur" role="alert">{erreurFiche}</p>}
          </div>
        )}
        <div>
          <label htmlFor="f-volume">Volume</label>
          <input
            id="f-volume"
            value={c.volume}
            placeholder="500 ml"
            onChange={(e) => champ('volume', e.target.value)}
          />
        </div>
        {champsWiki && (
          <>
            {champsVerrouilles && (
              <p className="sous">
                Catégorie, saveur, statut et région viennent du Wiki partagé : seuls les champs encore vides
                peuvent être complétés ici.
              </p>
            )}
            <div>
              <label htmlFor="f-categorie">Catégorie</label>
              <select
                id="f-categorie"
                value={c.categorie}
                disabled={verrouille('categorie')}
                onChange={(e) => champ('categorie', e.target.value)}
              >
                <option value="">Non renseignée</option>
                {CATEGORIES.map((categorie) => (
                  <option key={categorie} value={categorie}>{categorie}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-flavor">Flavor</label>
              <input
                id="f-flavor"
                value={c.flavor}
                disabled={verrouille('flavor')}
                maxLength={200}
                onChange={(e) => champ('flavor', e.target.value)}
              />
            </div>
            <div className="duo">
              <div>
                <label htmlFor="f-status">Status</label>
                <select id="f-status" value={c.status} disabled={verrouille('status')} onChange={(e) => champ('status', e.target.value)}>
                  <option value="">Non renseigné</option>
                  {/* Une Nouveauté déjà validée reste affichée, mais ne se choisit pas ici. */}
                  {[...STATUTS_COLLECTION, ...(c.status === 'Nouveauté' ? ['Nouveauté'] : [])].map((status) => (
                    <option key={status} value={status}>{libelleStatut(status)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-region">Region</label>
                <select id="f-region" value={c.region} disabled={verrouille('region')} onChange={(e) => champ('region', e.target.value)}>
                  <option value="">Non renseignée</option>
                  {REGIONS.map((region) => (
                    <option key={region} value={region}>{region}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
        {!nouvelle && (
          <div className="duo">
            <div>
              <label htmlFor="f-etat">État</label>
              <select id="f-etat" value={c.etat} onChange={(e) => champ('etat', e.target.value)}>
                {ETATS.map((etat) => (
                  <option key={etat} value={etat}>{etat}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-nb">Quantité</label>
              <input
                id="f-nb"
                type="number"
                min={1}
                max={9999}
                value={c.nb}
                onChange={(e) => champ('nb', Number(e.target.value))}
              />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="f-notes">Notes</label>
          <textarea
            id="f-notes"
            rows={3}
            maxLength={4000}
            value={c.notes}
            onChange={(e) => champ('notes', e.target.value)}
          />
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
      {codeBarresInvalide && (
        <p className="suggestions-wiki-erreur" role="alert">
          Code-barres invalide : il doit compter 8, 12 ou 13 chiffres, clé de contrôle comprise.
        </p>
      )}
      {quantiteInvalide && (
        <p className="suggestions-wiki-erreur" role="alert">
          La quantité doit être comprise entre 1 et 9999.
        </p>
      )}
      {codeBarresDejaUtilise && (
        <p className="suggestions-wiki-erreur" role="alert">
          Ce code-barres est déjà utilisé par « {codeBarresDejaUtilise.nom || 'une autre canette'} » dans ta collection.
        </p>
      )}
      {choixFicheRequis && (
        <p className="suggestions-wiki-erreur" role="alert">
          Choisis la fiche existante du Wiki avant l’ajout pour éviter un doublon.
        </p>
      )}
      <div className="actions">
        <button
          className="btn btn-primaire actions-principal"
          disabled={
            occupe || !c.ean.trim() || !codeBarresValide || !!codeBarresDejaUtilise ||
            choixFicheRequis || wikiEnChargement || quantiteInvalide
          }
          onClick={() => surValider({ ...c, ean: codeCanonique })}
        >
          {occupe ? 'Enregistrement…' : libelle}
        </button>
        <button className="btn btn-fantome" onClick={surAnnuler}>
          Annuler
        </button>
      </div>
    </>
  )
}
