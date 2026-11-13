// Adresse du compte Instagram, définie au build (Vercel → Environment Variables, ou .env.local).
const URL_INSTAGRAM = (import.meta.env.VITE_INSTAGRAM_URL as string | undefined)?.trim()

/** Phrase d'accroche avec le lien vers le compte Instagram du projet ; rien tant que l'adresse n'est pas définie. */
export default function LienInstagram() {
  if (!URL_INSTAGRAM) return null
  return (
    <footer className="pied-instagram">
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
