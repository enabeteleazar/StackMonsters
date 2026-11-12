import { Zap } from 'lucide-react'
import LienInstagram from './LienInstagram'

/** Pied de page de l'accueil public : signature, lien Instagram, mentions et crédit de la photo. */
export default function PiedPublic() {
  return (
    <footer className="accueil-public-pied">
      <p className="accueil-public-signature">
        <Zap size={22} />
        <b>StackMonster</b>
        <span>—{' '}Ta collection Monster, au même endroit.</span>
      </p>
      <LienInstagram />
      <p className="accueil-public-independance">
        StackMonster est un projet indépendant, non affilié à Monster Energy et non édité par la marque.
        Photo (détourée) :{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Monster_Energy_Mega_can.jpg" target="_blank" rel="noreferrer">
          DYVER
        </a>
        ,{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>
        . <a href="#confidentialite">Confidentialité</a>
      </p>
    </footer>
  )
}
