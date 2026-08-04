import { useMemo, useState } from 'react'
import type { Canette } from '../types'

type Props = {
  canettes: Canette[]
  surOuvrir: (ean: string) => void
}

export default function Collection({ canettes, surOuvrir }: Props) {
  const [q, setQ] = useState('')
  const [edition, setEdition] = useState('')

  const editions = useMemo(() => {
    const m = new Map<string, number>()
    canettes.forEach((c) => {
      const e = c.edition || '—'
      m.set(e, (m.get(e) ?? 0) + c.nb)
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [canettes])

  const vues = useMemo(() => {
    const t = q.trim().toLowerCase()
    return canettes
      .filter((c) => !t || c.nom.toLowerCase().includes(t) || c.ean.includes(t))
      .filter((c) => !edition || (c.edition || '—') === edition)
      .sort((a, b) => b.ajout.localeCompare(a.ajout))
  }, [canettes, q, edition])

  const total = canettes.reduce((n, c) => n + c.nb, 0)

  const telecharger = (nom: string, contenu: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([contenu], { type }))
    a.download = nom
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportCsv = () => {
    const cols: (keyof Canette)[] = ['ean', 'nom', 'edition', 'volume', 'etat', 'nb', 'notes', 'ajout']
    const csv = [cols.join(';')]
      .concat(
        canettes.map((c) =>
          cols.map((k) => `"${String(c[k] ?? '').replace(/"/g, '""')}"`).join(';'),
        ),
      )
      .join('\n')
    telecharger('canstack.csv', '\ufeff' + csv, 'text/csv')
  }

  return (
    <section>
      <div className="stats">
        <div className="stat">
          <b>{canettes.length}</b>
          <span>Références</span>
        </div>
        <div className="stat">
          <b>{total}</b>
          <span>Canettes</span>
        </div>
        <div className="stat">
          <b>{editions[0]?.[0] ?? '—'}</b>
          <span>Édition n°1</span>
        </div>
      </div>

      <div className="filtres">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un nom"
          aria-label="Chercher un nom"
        />
        <select
          value={edition}
          onChange={(e) => setEdition(e.target.value)}
          aria-label="Filtrer par édition"
        >
          <option value="">Toutes éditions</option>
          {editions.map(([e]) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      {vues.length ? (
        <ul className="liste">
          {vues.map((c) => (
            <li key={c.ean}>
              <button onClick={() => surOuvrir(c.ean)}>
                {c.photo ? <img src={c.photo} alt="" /> : <img alt="" />}
                <span>
                  <span className="nom">{c.nom || 'Sans nom'}</span>
                  <span className="meta" style={{ display: 'block' }}>
                    {c.ean} · {c.edition || '—'} · {c.volume || '—'}
                  </span>
                </span>
                <span className="nb">×{c.nb}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vide">Rien ici pour l'instant. Scanne ta première canette.</p>
      )}

      <div className="outils">
        <button
          onClick={() =>
            telecharger(
              `canstack-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(canettes, null, 2),
              'application/json',
            )
          }
        >
          Sauvegarde JSON
        </button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>
    </section>
  )
}
