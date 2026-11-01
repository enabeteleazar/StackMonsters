import { useEffect, useState } from 'react'

/** Bandeau affiché sans réseau : la dernière collection reste lisible, rien ne s'enregistre. */
export default function HorsLigne() {
  const [enLigne, setEnLigne] = useState(navigator.onLine)

  useEffect(() => {
    const maj = () => setEnLigne(navigator.onLine)
    window.addEventListener('online', maj)
    window.addEventListener('offline', maj)
    return () => {
      window.removeEventListener('online', maj)
      window.removeEventListener('offline', maj)
    }
  }, [])

  if (enLigne) return null
  return (
    <p className="sous" role="status">
      Hors ligne — dernière collection connue affichée. Les ajouts et modifications ne
      passeront qu\u2019avec le réseau.
    </p>
  )
}
