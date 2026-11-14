import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Home, LayoutGrid, ScanLine, Settings2 } from 'lucide-react'
import { api, jeton, NonAutorise, renouvelerJeton } from './api'
import AccueilPublic from './components/AccueilPublic'
import Acces from './components/Acces'
import HorsLigne from './components/HorsLigne'
import Camera from './components/Camera'
import Collection from './components/Collection'
import Confidentialite from './components/Confidentialite'
import Dashboard from './components/Dashboard'
import ResultatScan from './components/ResultatScan'
import { viderPhotos } from './components/PhotoWiki'
import Settings from './components/Settings'
import Stats from './components/Stats'
import Verdict from './components/Verdict'
import Wiki from './components/Wiki'
import { suivre } from './suivi'
import type { Canette } from './types'

type Vue = 'accueil' | 'collec' | 'wiki' | 'reglages' | 'stats'
type EtatAcces = 'verification' | 'accueil' | 'connexion' | 'prive'

export default function App() {
  const [canettes, setCanettes] = useState<Canette[]>([])
  const [nomUtilisateur, setNomUtilisateur] = useState('')
  const [emailUtilisateur, setEmailUtilisateur] = useState('')
  const [vue, setVue] = useState<Vue>('accueil')
  const [camera, setCamera] = useState(false)
  const [ean, setEan] = useState<string | null>(null)
  // Un code venu du scanner (ou saisi à la main) ouvre le résultat de scan ; une carte de la collection, la fiche.
  const [depuisScan, setDepuisScan] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [joignable, setJoignable] = useState(true)
  const [etatAcces, setEtatAcces] = useState<EtatAcces>(() =>
    jeton.lire() ? 'verification' : 'accueil',
  )
  const [refuse, setRefuse] = useState(false)
  const [serviceIndisponible, setServiceIndisponible] = useState(false)
  const [confidentialite, setConfidentialite] = useState(() => window.location.hash === '#confidentialite')

  useEffect(() => {
    const maj = () => setConfidentialite(window.location.hash === '#confidentialite')
    window.addEventListener('hashchange', maj)
    return () => window.removeEventListener('hashchange', maj)
  }, [])

  const toast = useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage(null), 2400)
  }, [])

  // Retour à l'écran d'accès. « refuse » distingue un jeton rejeté d'un jeton absent.
  const verrouiller = useCallback(() => {
    const sessionExistante = jeton.lire() !== ''
    if (sessionExistante) jeton.effacer()
    viderPhotos()
    setRefuse(sessionExistante)
    setNomUtilisateur('')
    setEmailUtilisateur('')
    setEtatAcces('accueil')
  }, [])

  const recharger = useCallback(async () => {
    try {
      setCanettes(await api.liste())
      setJoignable(true)
    } catch (e) {
      if (e instanceof NonAutorise) verrouiller()
      else setJoignable(false)
    }
  }, [verrouiller])

  const apresConnexion = useCallback((email: string) => {
    setEmailUtilisateur(email)
    setNomUtilisateur(email.split('@', 1)[0])
    setVue('accueil')
    setCamera(false)
    setEan(null)
    setRefuse(false)
    setServiceIndisponible(false)
    setEtatAcces('prive')
    void recharger()
  }, [recharger])

  useEffect(() => {
    if (etatAcces !== 'verification') return

    let active = true
    const verifierSession = async () => {
      try {
        const utilisateur = await api.moi()
        if (!active) return
        void renouvelerJeton()
        setEmailUtilisateur(utilisateur.email)
        setNomUtilisateur(utilisateur.email.split('@', 1)[0])
        const collection = await api.liste()
        if (!active) return
        setCanettes(collection)
        setJoignable(true)
        setEtatAcces('prive')
      } catch (e) {
        if (!active) return
        if (e instanceof NonAutorise) {
          verrouiller()
          return
        }

        if (e instanceof TypeError) {
          try {
            const collection = await api.liste()
            if (!active) return
            setCanettes(collection)
            setJoignable(false)
            setEtatAcces('prive')
            return
          } catch (erreurHorsLigne) {
            if (!active) return
            if (erreurHorsLigne instanceof NonAutorise) {
              verrouiller()
              return
            }
          }
        }

        setJoignable(false)
        setServiceIndisponible(true)
        setEtatAcces('accueil')
      }
    }

    void verifierSession()
    return () => {
      active = false
    }
  }, [etatAcces, verrouiller])

  // Application restée ouverte plusieurs jours (PWA) : rotation du jeton à chaque retour au premier plan.
  useEffect(() => {
    if (etatAcces !== 'prive') return
    const auRetour = () => {
      if (document.visibilityState === 'visible') void renouvelerJeton()
    }
    document.addEventListener('visibilitychange', auRetour)
    return () => document.removeEventListener('visibilitychange', auRetour)
  }, [etatAcces])

  const ouvrirConnexion = () => {
    setServiceIndisponible(false)
    setEtatAcces('connexion')
  }

  const existante = ean ? (canettes.find((c) => c.ean === ean) ?? null) : null

  const enregistrer = async (c: Canette) => {
    const nouvelle = !canettes.some((x) => x.ean === c.ean)
    try {
      await api.enregistrer(c)
      if (nouvelle) suivre('can_added')
      await recharger()
      toast('Fiche enregistrée')
      setEan(null)
    } catch (e) {
      if (e instanceof NonAutorise) verrouiller()
      else toast(`Enregistrement refusé — ${(e as Error).message}`)
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

  const ajouterSansCode = () => {
    setDepuisScan(false)
    setEan('LOCAL-' + Date.now().toString(36).toUpperCase())
  }
  const ouvrirScan = (code: string) => {
    setDepuisScan(true)
    setEan(code)
  }
  const ouvrirFiche = (code: string) => {
    setDepuisScan(false)
    setEan(code)
  }

  if (confidentialite) return <Confidentialite />

  if (etatAcces === 'verification') {
    return (
      <>
        <header>
          <div className="logo">
            <span className="accueil-public-marque">
              <img src="/favicon.svg" alt="" />
            </span>
            <div className="logo-marque">
              Stack<em>Monsters</em>
            </div>
          </div>
        </header>
        <main className="attente-session" aria-live="polite">
          Vérification de la session…
        </main>
      </>
    )
  }

  if (etatAcces === 'accueil') {
    return (
      <AccueilPublic
        surConnexion={ouvrirConnexion}
        serviceIndisponible={serviceIndisponible}
      />
    )
  }

  if (etatAcces === 'connexion') {
    return (
      <Acces
        refuse={refuse}
        surValider={apresConnexion}
        surRetour={() => setEtatAcces('accueil')}
      />
    )
  }

  return (
    <>
      <header>
        <div className="logo">
          <span className="accueil-public-marque">
            <img src="/favicon.svg" alt="" />
          </span>
          <div className="logo-marque">
            Stack<em>Monsters</em>
          </div>
        </div>
      </header>

      <main className={vue === 'collec' || vue === 'wiki' ? 'large' : ''}>
        <HorsLigne />
        {vue === 'accueil' && (
          <Dashboard
            canettes={canettes}
            nomUtilisateur={nomUtilisateur}
            surScanner={() => setCamera(true)}
            surAjouter={ajouterSansCode}
            surOuvrir={ouvrirFiche}
          />
        )}
        {vue === 'collec' && <Collection canettes={canettes} surOuvrir={ouvrirFiche} />}
        {vue === 'wiki' && <Wiki surNonAutorise={verrouiller} />}
        {vue === 'reglages' && (
          <Settings
            emailUtilisateur={emailUtilisateur}
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
        </button>
        <button aria-current={vue === 'wiki'} onClick={() => setVue('wiki')}>
          <BookOpen size={19} />
          Wiki
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
            ouvrirScan(code)
          }}
          surFermeture={() => setCamera(false)}
          surErreur={toast}
        />
      )}

      {ean && depuisScan && (
        <ResultatScan
          key={ean}
          ean={ean}
          existante={existante}
          surCollectionChangee={recharger}
          surFicheComplete={() => setDepuisScan(false)}
          surScanner={() => {
            setEan(null)
            setCamera(true)
          }}
          surTermine={(m) => {
            toast(m)
            setEan(null)
          }}
          surFermeture={() => setEan(null)}
          surNonAutorise={verrouiller}
        />
      )}

      {ean && !depuisScan && (
        <Verdict
          ean={ean}
          existante={existante}
          canettes={canettes}
          surNonAutorise={verrouiller}
          surEnregistrer={enregistrer}
          surSupprimer={supprimer}
          surFermeture={() => setEan(null)}
        />
      )}

      {message && <div className="toast">{message}</div>}
    </>
  )
}
