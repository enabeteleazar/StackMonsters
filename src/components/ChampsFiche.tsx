import { useEffect, useId, useState } from 'react'
import { api } from '../api'
import { SAVEUR_MAX, VARIANTES, VOLUMES_COURANTS, volumeEnMl } from '../categories'

/* Champs normalisés d'une fiche (issue #5), partagés par les formulaires du Wiki, des propositions et de la
   collection : volume en ml, saveur courte avec suggestions, variante prise dans une liste. */

type Champ = { id: string; valeur: string; surChange: (v: string) => void; desactive?: boolean }

/** Volume : liste des formats courants, ou « Autre » avec un nombre de ml. Renvoie « 500 ml » (ou ""). */
export function ChampVolume({ id, valeur, surChange, desactive }: Champ) {
  const ml = volumeEnMl(valeur)
  const courant = ml !== null && (VOLUMES_COURANTS as readonly number[]).includes(ml)
  const [autre, setAutre] = useState(!!valeur && !courant)
  // Ancienne valeur illisible (« un grand ») : montrée pour être corrigée, jamais effacée sans action.
  const ancienne = valeur && ml === null ? valeur : null

  return (
    <div className="champ-volume">
      <select
        id={id}
        value={autre ? 'autre' : courant ? String(ml) : ''}
        disabled={desactive}
        onChange={(e) => {
          const v = e.target.value
          setAutre(v === 'autre')
          if (v !== 'autre') surChange(v ? `${v} ml` : '')
        }}
      >
        <option value="">Non renseigné</option>
        {VOLUMES_COURANTS.map((v) => (
          <option key={v} value={v}>{v} ml</option>
        ))}
        <option value="autre">Autre…</option>
      </select>
      {autre && (
        <input
          type="number"
          inputMode="numeric"
          min={50}
          max={3000}
          aria-label="Volume en ml"
          placeholder="ml"
          disabled={desactive}
          value={ml ?? ''}
          onChange={(e) => surChange(e.target.value ? `${e.target.value} ml` : '')}
        />
      )}
      {ancienne && <small className="champ-aide">Ancienne valeur à corriger : « {ancienne} »</small>}
    </div>
  )
}

let saveursConnues: Promise<string[]> | null = null

/** Saveur courte, avec les saveurs déjà connues en suggestion. */
export function ChampSaveur({ id, valeur, surChange, desactive }: Champ) {
  const liste = useId()
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    saveursConnues ??= api.wikiSaveurs().catch(() => {
      saveursConnues = null // hors ligne : nouvel essai au prochain formulaire
      return []
    })
    let actif = true
    void saveursConnues.then((s) => actif && setSuggestions(s))
    return () => {
      actif = false
    }
  }, [])
  const tropLongue = valeur.length > SAVEUR_MAX
  return (
    <>
      <input
        id={id}
        list={liste}
        value={valeur}
        disabled={desactive}
        placeholder="Ex. : Mangue, Vanille"
        aria-invalid={tropLongue}
        onChange={(e) => surChange(e.target.value)}
      />
      <datalist id={liste}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {tropLongue && (
        <small className="champ-aide" role="alert">
          {valeur.length}/{SAVEUR_MAX} caractères : garde le parfum ici et mets les détails dans la description.
        </small>
      )}
    </>
  )
}

/** Variante prise dans la liste contrôlée. */
export function ChampVariante({ id, valeur, surChange, desactive }: Champ) {
  return (
    <select id={id} value={valeur} disabled={desactive} onChange={(e) => surChange(e.target.value)}>
      <option value="">Non renseignée</option>
      {VARIANTES.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  )
}
