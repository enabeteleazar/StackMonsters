import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import Camera from './components/Camera'
import Collection from './components/Collection'
import Verdict from './components/Verdict'
import { moteurNatif } from './scanner'
import type { Canette } from './types'

type Vue = 'scan' | 'collec'

export default function App() {
  const [canettes, setCanettes] = useState<Canette[]>([])
  const [vue, setVue] = useState<Vue>('scan')
  const [camera, setCamera] = useState(false)
  const [ean, setEan] = useState<string | null>(null)
  const [saisie, setSaisie] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [joignable, setJoignable] = useState(true)

  const toast = useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage(null), 2400)
  }, [])

  const recharger = useCallback(async () => {
    try {
      setCanettes(await api.liste())
      setJoignable(true)
    } catch {
      setJoignable(false)
    }
  }, [])

  useEffect(() => {
    recharger()
  }, [recharger])

  const total = canettes.reduce((n, c) => n + c.nb, 0)
  const existante = ean ? (canettes.find((c) => c.ean === ean) ?? null) : null

  const enregistrer = async (c: Canette) => {
    try {
      await api.enregistrer(c)
      await recharger()
      toast('Fiche enregistrée')
      setEan(null)
    } catch (e) {
      toast(`Enregistrement refusé — ${(e as Error).message}`)
    }
  }

  const incrementer = async (e: string, delta: number) => {
    try {
      const c = await api.incrementer(e, delta)
      await recharger()
      toast(`${c.nom || 'Canette'} : ${c.nb} exemplaires`)
      setEan(null)
    } catch (err) {
      toast(`Service injoignable — ${(err as Error).message}`)
    }
  }

  const supprimer = async (e: string) => {
    try {
      await api.supprimer(e)
      await recharger()
      toast('Retirée de la collection')
      setEan(null)
    } catch (err) {
      toast(`Suppression refusée — ${(err as Error).message}`)
    }
  }

  const rayures = Array.from({ length: 46 }, (_, i) => {
    const src = ean ?? '4006391110'
    const d = Number(src[i % src.length]) || 1
    return <i key={i} style={{ width: 1 + (d % 4), opacity: 0.35 + (d % 5) / 10 }} />
  })

  return (
    <>
      <header>
        <div className="marque">
          Can<em>Stack</em>
        </div>
        <div className={`compteur ${joignable ? '' : 'hors-ligne'}`}>
          {joignable ? `${canettes.length} réf · ${total} canettes` : 'service injoignable'}
        </div>
      </header>

      <main>
        {vue === 'scan' ? (
          <section>
            <div className="zebre" aria-hidden="true">
              {rayures}
            </div>
            <h1 className="accroche">
              Déjà dans<span>la collection ?</span>
            </h1>
            <p className="sous">
              Vise le code-barres de la canette. La collection vit sur Homebox, pas dans ce
              téléphone.
            </p>

            <button className="bouton-scan" onClick={() => setCamera(true)}>
              ◉ Scanner une canette
            </button>
            <button
              className="secondaire"
              onClick={() => setEan('LOCAL-' + Date.now().toString(36).toUpperCase())}
            >
              Ajouter sans code-barres
            </button>

            <div className="manuel">
              <input
                value={saisie}
                inputMode="numeric"
                placeholder="Code saisi à la main"
                aria-label="Code saisi à la main"
                onChange={(e) => setSaisie(e.target.value)}
              />
              <button
                onClick={() => {
                  const v = saisie.trim()
                  if (!v) return toast('Entre un code')
                  setSaisie('')
                  setEan(v)
                }}
              >
                OK
              </button>
            </div>

            {!joignable && (
              <p className="sous" style={{ marginTop: 18 }}>
                Le service ne répond pas. Vérifie que Tailscale est actif sur ce téléphone, puis
                recharge la page.
              </p>
            )}
            {!moteurNatif() && (
              <p className="sous" style={{ marginTop: 18 }}>
                Lecteur ZXing chargé au premier scan, depuis Homebox.
              </p>
            )}
          </section>
        ) : (
          <Collection canettes={canettes} surOuvrir={setEan} />
        )}
      </main>

      <nav>
        <button aria-current={vue === 'scan'} onClick={() => setVue('scan')}>
          Scanner
        </button>
        <button
          aria-current={vue === 'collec'}
          onClick={() => {
            setVue('collec')
            recharger()
          }}
        >
          Collection
        </button>
      </nav>

      {camera && (
        <Camera
          surCode={(code) => {
            setCamera(false)
            setEan(code)
          }}
          surFermeture={() => setCamera(false)}
          surErreur={toast}
        />
      )}

      {ean && (
        <Verdict
          ean={ean}
          existante={existante}
          surEnregistrer={enregistrer}
          surIncrementer={incrementer}
          surSupprimer={supprimer}
          surFermeture={() => setEan(null)}
        />
      )}

      {message && <div className="toast">{message}</div>}
    </>
  )
}
