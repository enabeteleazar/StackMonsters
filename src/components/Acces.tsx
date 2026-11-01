import { useState } from 'react'
import { jeton } from '../api'

type Props = {
  /** Appelé après enregistrement du jeton : le parent recharge la collection. */
  surValider: () => void
  refuse: boolean
}

export default function Acces({ surValider, refuse }: Props) {
  const [saisie, setSaisie] = useState('')

  const valider = () => {
    const v = saisie.trim()
    if (!v) return
    jeton.ecrire(v)
    setSaisie('')
    surValider()
  }

  return (
    <section className="tableau-bord">
      <span className="eyebrow">StackMonster</span>
      <h1 className="tb-titre">
        Accès
        <span>privé</span>
      </h1>
      <p className="sous">
        {refuse
          ? 'Jeton refusé. Vérifie-le et réessaie.'
          : 'Entre le jeton d\u2019accès de ta collection. Il reste sur cet appareil.'}
      </p>
      <div className="champs">
        <div>
          <label htmlFor="f-jeton">Jeton</label>
          <input
            id="f-jeton"
            name="jeton"
            type="password"
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valider()}
          />
        </div>
      </div>
      <div className="actions">
        <button className="btn btn-primaire actions-principal" onClick={valider}>
          Entrer
        </button>
      </div>
    </section>
  )
}
