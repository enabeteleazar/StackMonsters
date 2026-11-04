import { useCallback, useEffect, useState } from 'react'
import { Home, LayoutGrid, PlusCircle, ScanLine, Settings2 } from 'lucide-react'
import { api, jeton, NonAutorise } from './api'
import Acces from './components/Acces'
import HorsLigne from './components/HorsLigne'
import Camera from './components/Camera'
import Collection from './components/Collection'
import Dashboard from './components/Dashboard'
import Logo from './components/Logo'
import Settings from './components/Settings'
import Stats from './components/Stats'
import Verdict from './components/Verdict'
import { moteurNatif } from './scanner'
import type { Canette } from './types'

type Vue = 'accueil' | 'collec' | 'reglages' | 'stats'

export default function App() {
  const [canettes, setCanettes] = useState<Canette[]>([])
  const [vue, setVue] = useState<Vue>('accueil')
  const [camera, setCamera] = useState(false)
  const [ean, setEan] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [joignable, setJoignable] = useState(true)
  const [autorise, setAutorise] = useState(true)
  const [refuse, setRefuse] = useState(false)

  const toast = useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage(null), 2400)
  }, [])

  // Retour à l'écran d'accès. « refuse » distingue un jeton rejeté d'un jeton absent.
  const verrouiller = useCallback(() => {
    setRefuse(jeton.lire() !== '')
    setAutorise(false)
  }, [])

  const recharger = useCallback(async () => {
    try {
      setCanettes(await api.liste())
      setJoignable(true)
      setAutorise(true)
    } catch (e) {
      if (e instanceof NonAutorise) verrouiller()
      else setJoignable(false)
    }
  }, [verrouiller])

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
      if (e instanceof NonAutorise) verrouiller()
      else toast(`Enregistrement refusé — ${(e as Error).message}`)
    }
  }

  const incrementer = async (e: string, delta: number) => {
    try {
      const c = await api.incrementer(e, delta)
      await recharger()
      toast(`${c.nom || 'Canette'} : ${c.nb} exemplaires`)
      setEan(null)
    } catch (err) {
      if (err instanceof NonAutorise) verrouiller()
      else toast(`Service injoignable — ${(err as Error).message}`)
    }
  }

  const supprimer = async (e: string) => {
    try {
      await api.supprimer(e)
      await recharger()
      toast('Retirée de la collection')
      setEan(null)
    } catch (err) {
      if (err instanceof NonAutorise) verrouiller()
      else toast(`Suppression refusée — ${(err as Error).message}`)
    }
  }

  const ajouterSansCode = () => setEan('LOCAL-' + Date.now().toString(36).toUpperCase())

  if (!autorise) {
    return (
      <>
        <header>
          <div className="logo">
            <Logo />
            <div className="logo-marque">
              Stack<em>Monster</em>
            </div>
          </div>
        </header>
        <main>
          <Acces refuse={refuse} surValider={recharger} />
        </main>
      </>
    )
  }

  return (
    <>
      <header>
        <div className="logo">
          <Logo />
          <div className="logo-marque">
            Stack<em>Monster</em>
          </div>
        </div>
        <div className={`compteur ${joignable ? '' : 'hors-ligne'}`}>
          <span className="point" />
          {joignable ? `${canettes.length} réf · ${total} canettes` : 'service injoignable'}
        </div>
      </header>

      <main className={vue === 'collec' ? 'large' : ''}>
        <HorsLigne />
        {vue === 'accueil' && (
          <Dashboard
            canettes={canettes}
            surScanner={() => setCamera(true)}
            surAjouter={ajouterSansCode}
            surOuvrir={setEan}
            surReglages={() => setVue('reglages')}
            surCodeManuel={setEan}
            toast={toast}
          />
        )}
        {vue === 'collec' && <Collection canettes={canettes} surOuvrir={setEan} />}
        {vue === 'reglages' && (
          <Settings
            canettes={canettes}
            joignable={joignable}
            surVerrouiller={verrouiller}
            surStats={() => setVue('stats')}
          />
        )}
        {vue === 'stats' && <Stats surRetour={() => setVue('reglages')} />}

        {!joignable && vue === 'accueil' && (
          <p className="sous" style={{ marginTop: 18 }}>
            Le service ne répond pas. Vérifie ta connexion, puis recharge la page.
          </p>
        )}
        {!moteurNatif() && vue === 'accueil' && (
          <p className="sous" style={{ marginTop: 18 }}>
            Lecteur ZXing chargé au premier scan.
          </p>
        )}
      </main>

      <nav className="nav-bas">
        <button aria-current={vue === 'accueil'} onClick={() => setVue('accueil')}>
          <Home size={19} />
          Accueil
        </button>
        <button
          aria-current={vue === 'collec'}
          onClick={() => {
            setVue('collec')
            recharger()
          }}
        >
          <LayoutGrid size={19} />
          Collection
        </button>
        <button className="nav-scan" onClick={() => setCamera(true)} aria-label="Scanner une canette">
          <span className="nav-scan-rond">
            <ScanLine size={22} strokeWidth={2.4} />
          </span>
          Scan
        </button>
        <button onClick={ajouterSansCode}>
          <PlusCircle size={19} />
          Ajouter
        </button>
        <button aria-current={vue === 'reglages' || vue === 'stats'} onClick={() => setVue('reglages')}>
          <Settings2 size={19} />
          Réglages
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
