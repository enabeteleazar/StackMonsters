import { Instagram } from 'lucide-react'

// Adresse du compte Instagram, définie au build (Vercel → Environment Variables, ou .env.local).
const URL_INSTAGRAM = (import.meta.env.VITE_INSTAGRAM_URL as string | undefined)?.trim()

/** Lien vers le compte Instagram du projet, avec sa phrase d'accroche ; rien tant que l'adresse n'est pas définie. */
export default function LienInstagram() {
  if (!URL_INSTAGRAM) return null
  return (
    <footer className="pied-instagram">
      <a href={URL_INSTAGRAM} target="_blank" rel="noreferrer" aria-label="StackMonster sur Instagram">
        <Instagram size={26} />
      </a>
      <p>
        Rejoins la communauté sur{' '}
        <a href={URL_INSTAGRAM} target="_blank" rel="noreferrer">
          Instagram
        </a>{' '}
        pour découvrir les coulisses du projet et ne rien manquer des nouveautés.
      </p>
    </footer>
  )
}
